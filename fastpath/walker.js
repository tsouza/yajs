// Fast-path prototype: evaluate a compiled YAJSPath against a fully
// materialized (JSON.parse'd) value, emitting {path, value} matches that
// are intended to be byte-identical (content AND order) with the real
// streaming engine's output for the same document.
//
// Two evaluators:
//  - GenericWalker: reuses the real YAJSPath.match() + StreamPosition
//    machinery, replicating StreamContext's match-attempt placement.
//    Correct by construction wrt the pattern matcher; used as the
//    general-case evaluator and as the reference for the chain evaluator.
//  - ChainEvaluator: compiled fast path for "definite pure-key chains"
//    ($.k1.k2....kn, no wildcards/descendants/ancestor-filters), the
//    NDJSON hot case. O(selector length) per document.
'use strict';

const { YAJSPath } = require('../dist/main/lib/path/YAJSPath.js');
const { StreamPosition } = require('../dist/main/lib/context/StreamPosition.js');
const { PathOperator } = require('../dist/main/lib/path/PathOperator.js');
const { ScriptFilterHelper } = require('../dist/main/lib/utils/ScriptFilterHelper.js');

function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Generic walker
// ---------------------------------------------------------------------------

class GenericWalker {
    // emit: (pathArray, value) => void
    constructor(yajsPath, options, emit) {
        this.path = yajsPath;
        this.includeIdx = !!(options && options.pathIncludeArrayIndex);
        this.emitCb = emit;
        this.dropKeys = yajsPath.dropKeys || [];
        this.hasDrop = this.dropKeys.length > 0;
        this.dropSet = new Set(this.dropKeys);
        this.projectHelper = new ScriptFilterHelper(
            yajsPath.projectKeys, yajsPath.projectExpression);
        this.hasProject = this.projectHelper.isFiltered();
        // node -> built (drop-stripped) value, for nested-match
        // substitution (mirrors dispatcher value injection, issue #38).
        this.builtByNode = this.hasDrop ? new Map() : null;
    }

    // One top-level document (one NDJSON line).
    walkDocument(value) {
        this.position = new StreamPosition(this.includeIdx, !this.path.definite);
        if (this.hasDrop) { this.builtByNode.clear(); }
        if (isPlainObject(value)) {
            // StreamContext.startObject at a fresh boundary: reset() ->
            // match(undefined) with position [Root]; Root.onValue is a
            // no-op so no second attempt.
            const matched = this.tryMatch();
            this.enterObject(value, matched);
        } else if (Array.isArray(value)) {
            // StreamContext.startArray at a fresh boundary: no match for
            // the array itself (issue #14) - elements only.
            this.walkRootArrayOpen();
            for (let i = 0; i < value.length; i++) { this.element(value[i]); }
            this.walkRootArrayClose();
        } else {
            // bare scalar at root: onValue -> isInRoot -> match(value)
            if (this.tryMatch()) { this.emitScalar(value); }
        }
    }

    // Exposed separately so the top-level-array fast path can stream
    // elements one at a time (parse each element text, call element()).
    walkRootArrayOpen() {
        if (!this.position) {
            this.position = new StreamPosition(this.includeIdx, !this.path.definite);
        }
        this.position.stepIntoArray();
    }
    walkRootArrayClose() {
        this.position.stepOutArray();
    }

    // A value in an already-established slot (object key slot or array
    // elements slot). Mirrors StreamContext's startObject/startArray/
    // onValue dispatch for non-fresh positions.
    element(v) {
        if (isPlainObject(v)) {
            // startObject, peek not ROOT: doOnValue -> match at current
            // position (before stepping in).
            const matched = this.tryMatchViaPeek();
            this.enterObject(v, matched);
        } else if (Array.isArray(v)) {
            // startArray: peek ARRAY -> match attempt (array-as-element);
            // peek ChildNode/Wildcard -> no attempt (array-as-key-value).
            let matched = false;
            if (this.position.peek().getType() === PathOperator.Type.ARRAY) {
                matched = this.tryMatchViaPeek();
            }
            this.position.stepIntoArray();
            for (let i = 0; i < v.length; i++) { this.element(v[i]); }
            this.position.stepOutArray();
            if (matched) { this.emitNonScalar(v); }
        } else {
            // scalar: onValue non-root branch: increaseArrayIndex, then
            // doOnValue -> peek().onValue -> match(value).
            this.position.increaseArrayIndex();
            if (this.tryMatchViaPeek(true)) { this.emitScalar(v); }
        }
    }

    enterObject(v, matched) {
        const pos = this.position;
        pos.stepIntoObject();
        const keys = Object.keys(v);
        for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            pos.updateObjectEntry(k);
            this.element(v[k]);
        }
        pos.stepOutObject();
        if (matched) { this.emitNonScalar(v); }
    }

    // match attempt as StreamContext.match does it. `viaPeek` mirrors
    // doOnValue(): Root.onValue is a no-op, so no attempt when the current
    // peek is Root (only reachable for root scalars, handled separately).
    tryMatch() {
        const d = this.position.pathDepth();
        if (this.path.definite || this.path.minimumDepth <= d) {
            return this.path.match(this.position);
        }
        return false;
    }
    tryMatchViaPeek() {
        if (this.position.peek().getType() === PathOperator.Type.ROOT) { return false; }
        return this.tryMatch();
    }

    emitScalar(v) {
        // scalars bypass project/drop entirely (issue #46 / dispatcher only
        // ever gates container values)
        this.emitCb(this.position.path(), v);
    }

    emitNonScalar(v) {
        const built = this.hasDrop ? this.buildWithDrop(v, true) : v;
        if (this.hasDrop) { this.builtByNode.set(v, built); }
        if (this.hasProject) {
            const ok = this.projectHelper.filters((key) =>
                Object.prototype.hasOwnProperty.call(built, key));
            if (!ok) { return; }
        }
        this.emitCb(this.position.path(), built);
    }

    // Reconstruct the value a dispatcher would have built when dropKeys are
    // in play: the match root's own top-level dropped keys are omitted, and
    // any nested matched node is replaced by ITS built value (the engine
    // injects the inner dispatcher's completed - already-stripped - value
    // into the suspended ancestor, so the ancestor's emission carries the
    // stripped inner subtree too).
    buildWithDrop(v, isMatchRoot) {
        if (v === null || typeof v !== 'object') { return v; }
        if (!isMatchRoot && this.builtByNode.has(v)) { return this.builtByNode.get(v); }
        if (Array.isArray(v)) {
            const out = new Array(v.length);
            for (let i = 0; i < v.length; i++) { out[i] = this.buildWithDrop(v[i], false); }
            return out;
        }
        const out = {};
        const keys = Object.keys(v);
        for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            if (isMatchRoot && this.dropSet.has(k)) { continue; }
            Object.defineProperty(out, k, {
                value: this.buildWithDrop(v[k], false),
                writable: true, enumerable: true, configurable: true,
            });
        }
        return out;
    }
}

// ---------------------------------------------------------------------------
// Compiled chain evaluator ($.k1.k2...kn - definite, no wildcard, no
// filters; project/drop allowed at the end). Returns null if the selector
// is not chain-compilable.
// ---------------------------------------------------------------------------

class ChainEvaluator {
    static compile(yajsPath, options, emit) {
        // Inspect the compiled operator stack: must be Root + ChildNodes
        // only, none filtered.
        const stack = yajsPath['mStack'].stack; // private access, prototype only
        const keys = [];
        for (let i = 0; i < stack.length; i++) {
            const op = stack[i];
            const t = op.getType();
            if (t === PathOperator.Type.ROOT) {
                if (i !== 0) { return null; }
                continue;
            }
            if (t !== PathOperator.Type.OBJECT) { return null; }
            if (op.filtered) { return null; }
            keys.push(op.key);
        }
        return new ChainEvaluator(yajsPath, keys, options, emit);
    }

    constructor(yajsPath, keys, options, emit) {
        this.keys = keys;
        this.includeIdx = !!(options && options.pathIncludeArrayIndex);
        this.emitCb = emit;
        this.dropKeys = yajsPath.dropKeys || [];
        this.hasDrop = this.dropKeys.length > 0;
        this.dropSet = new Set(this.dropKeys);
        this.projectHelper = new ScriptFilterHelper(
            yajsPath.projectKeys, yajsPath.projectExpression);
        this.hasProject = this.projectHelper.isFiltered();
        this.simple = !this.hasDrop && !this.hasProject && !this.includeIdx;
        // Pre-build the (constant, when !includeIdx) emission path.
        this.constPath = keys.slice();
    }

    walkDocument(value) {
        if (this.includeIdx) {
            this.step(value, 0, []);
        } else {
            this.stepNoIdx(value, 0);
        }
    }

    // Element of a TOP-LEVEL ARRAY (the "array is comma-NDJSON" fast
    // path). NOT equivalent to walkDocument: the root array has already
    // consumed the one level of array transparency, so an element that is
    // itself an array is opaque (never further flattened, and for `$` it
    // is the emitted unit itself), and an element object may start the
    // chain directly.  elemIdx used only when pathIncludeArrayIndex.
    walkElement(el, elemIdx) {
        const trail = this.includeIdx ? [elemIdx] : null;
        if (this.keys.length === 0) {
            // `$`: each element of the matched root array is emitted whole
            this.emitOne(el, this.includeIdx ? [] : null, this.includeIdx ? elemIdx : -1);
            return;
        }
        if (isPlainObject(el)) {
            if (this.includeIdx) {
                this.step(el, 0, trail);
            } else {
                this.stepNoIdx(el, 0);
            }
        }
        // array or scalar element: dead end for a non-empty key chain
    }

    // Fast variant: no array indices in paths -> the path is constant.
    stepNoIdx(v, i) {
        for (;;) {
            if (i === this.keys.length) { return this.terminal(v, null); }
            if (isPlainObject(v)) {
                const k = this.keys[i];
                if (!Object.prototype.hasOwnProperty.call(v, k)) { return; }
                v = v[k];
                i++;
                continue;
            }
            if (Array.isArray(v)) {
                // one level of array transparency for the pending key
                const k = this.keys[i];
                for (let j = 0; j < v.length; j++) {
                    const el = v[j];
                    if (isPlainObject(el) &&
                        Object.prototype.hasOwnProperty.call(el, k)) {
                        this.stepNoIdx(el[k], i + 1);
                    }
                }
                return;
            }
            return; // scalar mid-chain: dead end
        }
    }

    // Path-tracking variant (pathIncludeArrayIndex): idxTrail collects the
    // interleaved segments (keys and indices) exactly as StreamPosition
    // would - a key contributes when settled, an array level contributes
    // its element index.
    step(v, i, trail) {
        if (i === this.keys.length) { return this.terminal(v, trail); }
        if (isPlainObject(v)) {
            const k = this.keys[i];
            if (!Object.prototype.hasOwnProperty.call(v, k)) { return; }
            trail.push(k);
            this.step(v[k], i + 1, trail);
            trail.pop();
            return;
        }
        if (Array.isArray(v)) {
            const k = this.keys[i];
            for (let j = 0; j < v.length; j++) {
                const el = v[j];
                if (isPlainObject(el) &&
                    Object.prototype.hasOwnProperty.call(el, k)) {
                    trail.push(j, k);
                    this.step(el[k], i + 1, trail);
                    trail.pop(); trail.pop();
                }
            }
            return;
        }
    }

    terminal(v, trail) {
        if (Array.isArray(v)) {
            // matched array streams its elements (issue #14), exactly one
            // level; elements that are themselves arrays/objects are
            // emitted whole.
            for (let j = 0; j < v.length; j++) {
                this.emitOne(v[j], trail, j);
            }
            return;
        }
        this.emitOne(v, trail, -1);
    }

    emitOne(v, trail, idx) {
        let out = v;
        if (v !== null && typeof v === 'object') {
            if (this.hasDrop && isPlainObject(v)) {
                const stripped = {};
                const keys = Object.keys(v);
                for (let i = 0; i < keys.length; i++) {
                    const k = keys[i];
                    if (this.dropSet.has(k)) { continue; }
                    Object.defineProperty(stripped, k, {
                        value: v[k], writable: true, enumerable: true, configurable: true,
                    });
                }
                out = stripped;
            }
            if (this.hasProject) {
                const ok = this.projectHelper.filters((key) =>
                    Object.prototype.hasOwnProperty.call(out, key));
                if (!ok) { return; }
            }
        }
        let path;
        if (!this.includeIdx) {
            path = this.constPath.slice();
        } else {
            path = trail ? trail.slice() : [];
            if (idx >= 0) { path.push(idx); }
        }
        this.emitCb(path, out);
    }
}

// ---------------------------------------------------------------------------
// Front door: compile a selector into the best evaluator.
// ---------------------------------------------------------------------------

function compileFastPath(selector, options, emit) {
    const yajsPath = YAJSPath.parse(selector);
    const chain = ChainEvaluator.compile(yajsPath, options, emit);
    if (chain) { return { evaluator: chain, kind: 'chain', yajsPath }; }
    return { evaluator: new GenericWalker(yajsPath, options, emit), kind: 'generic', yajsPath };
}

function genericOnly(selector, options, emit) {
    const yajsPath = YAJSPath.parse(selector);
    return { evaluator: new GenericWalker(yajsPath, options, emit), kind: 'generic', yajsPath };
}

module.exports = { GenericWalker, ChainEvaluator, compileFastPath, genericOnly, isPlainObject };
