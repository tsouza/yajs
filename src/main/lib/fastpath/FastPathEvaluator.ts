// NDJSON fast-path evaluators: given a top-level value already produced by
// native `JSON.parse` (rather than tokenized byte-by-byte), walk it against
// a compiled YAJSPath selector and report the same {path, value} matches -
// in the same order - the real streaming engine (StreamContext +
// JsonSaxParser) would have produced for the same document. See #78 for the
// full design writeup and the ~40,000-case differential comparison this was
// validated against; see NdjsonFastPath.ts for how a document ends up here
// and what happens to input this can't safely handle.
//
// Two evaluators, chosen per-selector by compileFastPathEvaluator():
//
//  - GenericWalker: reuses the real matcher (YAJSPath.match() +
//    StreamPosition), replicating StreamContext's own match-attempt
//    placement (see walkDocument()/element()/enterObject() below - each
//    mirrors one of StreamContext's startObject()/startArray()/onValue()
//    branches). Correct by construction with respect to the pattern
//    matcher for every selector shape (wildcards, '..', filters,
//    project/drop) - this is the fallback for anything the specialized
//    ChainEvaluator below can't compile.
//  - ChainEvaluator: a compiled fast path for "definite pure-key chains"
//    ($.k1.k2....kn - no wildcards/descendants/ancestor-filters), the
//    common NDJSON case (e.g. `$.field2.nested`). O(selector length) per
//    document instead of a full match() attempt at every node.
//
// Two divergences from the real engine are inherent to using JSON.parse
// and are accepted, documented behavior for opt-in fastPath mode (see
// YAJSOptions.fastPath in yajs.ts and the README):
//  1. Duplicate keys in one object: the streaming engine emits a match per
//     occurrence; JSON.parse keeps only the last.
//  2. Integer-like key ordering: when raw text order differs from JS's
//     own-property enumeration order for integer-like keys (Object.keys()),
//     sibling match *emission order* can differ (values/paths unaffected).
'use strict';

import { StreamPosition } from '../context/StreamPosition';
import { ChildNode } from '../path/operator/ChildNode';
import { PathOperator } from '../path/PathOperator';
import { YAJSPath } from '../path/YAJSPath';
import { ScriptFilterHelper } from '../utils/ScriptFilterHelper';

/** Minimal option surface the fast path evaluators need from YAJSOptions. */
export interface FastPathOptions {
    pathIncludeArrayIndex?: boolean;
}

export type EmitFn = (path: Array<string | number>, value: any) => void;

export function isPlainObject(v: any): boolean {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export interface FastPathDocumentEvaluator {
    walkDocument(value: any): void;
}

// ---------------------------------------------------------------------------
// Generic walker
// ---------------------------------------------------------------------------

export class GenericWalker implements FastPathDocumentEvaluator {

    private readonly includeIdx: boolean;
    private readonly dropSet: Set<string>;
    private readonly hasDrop: boolean;
    private readonly projectHelper: ScriptFilterHelper;
    private readonly hasProject: boolean;
    // node -> built (drop-stripped) value, for nested-match substitution
    // (mirrors dispatcher value injection, issue #38).
    private readonly builtByNode: Map<any, any>;
    private position: StreamPosition;

    constructor(private readonly path: YAJSPath, options: FastPathOptions, private readonly emitCb: EmitFn) {
        this.includeIdx = !!(options && options.pathIncludeArrayIndex);
        const dropKeys = path.dropKeys || [];
        this.hasDrop = dropKeys.length > 0;
        this.dropSet = new Set(dropKeys);
        this.projectHelper = new ScriptFilterHelper(path.projectKeys, path.projectExpression);
        this.hasProject = this.projectHelper.isFiltered();
        this.builtByNode = this.hasDrop ? new Map() : null;
    }

    // One top-level document (one NDJSON record).
    walkDocument(value: any): void {
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
            this.position.stepIntoArray();
            for (let i = 0; i < value.length; i++) { this.element(value[i]); }
            this.position.stepOutArray();
        } else {
            // bare scalar at root: onValue -> isInRoot -> match(value)
            if (this.tryMatch()) { this.emitScalar(value); }
        }
    }

    // Exposed separately (beyond walkDocument()) so the array-splitter fast
    // path (ArrayFastPath.ts, issue #86) can drive a top-level array's
    // elements one at a time - each parsed independently by the structural
    // scanner + JSON.parse, rather than all at once from one already-
    // materialized array value - while still sharing exactly one
    // StreamPosition across the whole array, the same way StreamContext's
    // own single long-lived position is shared across an entire array as it
    // streams in. walkRootArrayOpen()/element()/walkRootArrayClose() below
    // are that three-call sequence factored out of walkDocument()'s own
    // Array.isArray(value) branch.
    walkRootArrayOpen(): void {
        if (!this.position) {
            this.position = new StreamPosition(this.includeIdx, !this.path.definite);
        }
        if (this.hasDrop) { this.builtByNode.clear(); }
        this.position.stepIntoArray();
    }

    walkRootArrayClose(): void {
        this.position.stepOutArray();
    }

    // A value in an already-established slot (object key slot or array
    // elements slot). Mirrors StreamContext's startObject/startArray/
    // onValue dispatch for non-fresh positions. Public: also the per-
    // element entry point walkRootArrayOpen() above exists for.
    element(v: any): void {
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
            if (this.tryMatchViaPeek()) { this.emitScalar(v); }
        }
    }

    private enterObject(v: any, matched: boolean): void {
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

    // match attempt as StreamContext.match does it. viaPeek mirrors
    // doOnValue(): Root.onValue is a no-op, so no attempt when the current
    // peek is Root (only reachable for root scalars, handled separately).
    private tryMatch(): boolean {
        const d = this.position.pathDepth();
        if (this.path.definite || this.path.minimumDepth <= d) {
            return this.path.match(this.position);
        }
        return false;
    }

    private tryMatchViaPeek(): boolean {
        if (this.position.peek().getType() === PathOperator.Type.ROOT) { return false; }
        return this.tryMatch();
    }

    private emitScalar(v: any): void {
        // scalars bypass project/drop entirely (issue #46 / dispatcher only
        // ever gates container values)
        this.emitCb(this.position.path(this.includeIdx), v);
    }

    private emitNonScalar(v: any): void {
        const built = this.hasDrop ? this.buildWithDrop(v, true) : v;
        if (this.hasDrop) { this.builtByNode.set(v, built); }
        if (this.hasProject) {
            const ok = this.projectHelper.filters((key) =>
                Object.prototype.hasOwnProperty.call(built, key));
            if (!ok) { return; }
        }
        this.emitCb(this.position.path(this.includeIdx), built);
    }

    // Reconstruct the value a dispatcher would have built when dropKeys are
    // in play: the match root's own top-level dropped keys are omitted, and
    // any nested matched node is replaced by ITS built value (the engine
    // injects the inner dispatcher's completed - already-stripped - value
    // into the suspended ancestor, so the ancestor's emission carries the
    // stripped inner subtree too).
    private buildWithDrop(v: any, isMatchRoot: boolean): any {
        if (v === null || typeof v !== 'object') { return v; }
        if (!isMatchRoot && this.builtByNode.has(v)) { return this.builtByNode.get(v); }
        if (Array.isArray(v)) {
            const out = new Array(v.length);
            for (let i = 0; i < v.length; i++) { out[i] = this.buildWithDrop(v[i], false); }
            return out;
        }
        const out: any = {};
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
// filters; project/drop allowed at the end). compile() returns null if the
// selector isn't chain-compilable, in which case compileFastPathEvaluator()
// below falls back to GenericWalker.
// ---------------------------------------------------------------------------

export class ChainEvaluator implements FastPathDocumentEvaluator {

    static compile(yajsPath: YAJSPath, options: FastPathOptions, emit: EmitFn): ChainEvaluator | null {
        const stack = yajsPath.operators();
        const keys: string[] = [];
        for (let i = 0; i < stack.length; i++) {
            const op = stack[i];
            const t = op.getType();
            if (t === PathOperator.Type.ROOT) {
                if (i !== 0) { return null; }
                continue;
            }
            if (t !== PathOperator.Type.OBJECT) { return null; }
            if ((op as ChildNode).filtered) { return null; }
            keys.push((op as ChildNode).key);
        }
        return new ChainEvaluator(yajsPath, keys, options, emit);
    }

    private readonly includeIdx: boolean;
    private readonly dropSet: Set<string>;
    private readonly hasDrop: boolean;
    private readonly projectHelper: ScriptFilterHelper;
    private readonly hasProject: boolean;
    private readonly constPath: string[];

    private constructor(yajsPath: YAJSPath, private readonly keys: string[],
                         options: FastPathOptions, private readonly emitCb: EmitFn) {
        this.includeIdx = !!(options && options.pathIncludeArrayIndex);
        const dropKeys = yajsPath.dropKeys || [];
        this.hasDrop = dropKeys.length > 0;
        this.dropSet = new Set(dropKeys);
        this.projectHelper = new ScriptFilterHelper(yajsPath.projectKeys, yajsPath.projectExpression);
        this.hasProject = this.projectHelper.isFiltered();
        // Pre-built (constant, when !includeIdx) emission path.
        this.constPath = keys.slice();
    }

    walkDocument(value: any): void {
        if (this.includeIdx) {
            this.step(value, 0, []);
        } else {
            this.stepNoIdx(value, 0);
        }
    }

    // Element of a TOP-LEVEL ARRAY (the array-splitter fast path,
    // ArrayFastPath.ts / issue #86) - NOT equivalent to walkDocument(): the
    // root array has already consumed the one level of array transparency
    // that walkDocument()'s own Array.isArray(value) branch would apply, so
    // an element that is itself an array is opaque here (never further
    // flattened - for `$` it is the emitted unit itself), and an element
    // object may start the key chain directly. `elemIdx` is used only when
    // pathIncludeArrayIndex is on (it becomes the path's leading segment -
    // see ArrayFastPath.ts's index-rebasing comment for why the caller, not
    // this class, owns that running counter).
    walkElement(el: any, elemIdx: number): void {
        const trail: Array<string | number> = this.includeIdx ? [elemIdx] : null;
        if (this.keys.length === 0) {
            // `$`: each element of the matched root array is emitted whole
            // (mirrors terminal()'s array-streaming branch one level up).
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
        // array or scalar element: dead end for a non-empty key chain -
        // exactly like a scalar/array reached mid-chain in stepNoIdx()/
        // step() above.
    }

    // Fast variant: no array indices in paths -> the emitted path is
    // constant (this.constPath), so no trail needs to be threaded through.
    private stepNoIdx(v: any, i: number): void {
        for (;;) {
            if (i === this.keys.length) { this.terminal(v, null); return; }
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
                    if (isPlainObject(el) && Object.prototype.hasOwnProperty.call(el, k)) {
                        this.stepNoIdx(el[k], i + 1);
                    }
                }
                return;
            }
            return; // scalar mid-chain: dead end
        }
    }

    // Path-tracking variant (pathIncludeArrayIndex): trail collects the
    // interleaved segments exactly as StreamPosition would - a key
    // contributes when settled, an array level contributes its element
    // index.
    private step(v: any, i: number, trail: Array<string | number>): void {
        if (i === this.keys.length) { this.terminal(v, trail); return; }
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
                if (isPlainObject(el) && Object.prototype.hasOwnProperty.call(el, k)) {
                    trail.push(j, k);
                    this.step(el[k], i + 1, trail);
                    trail.pop(); trail.pop();
                }
            }
            return;
        }
    }

    private terminal(v: any, trail: Array<string | number>): void {
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

    private emitOne(v: any, trail: Array<string | number>, idx: number): void {
        let out = v;
        if (v !== null && typeof v === 'object') {
            if (this.hasDrop && isPlainObject(v)) {
                const stripped: any = {};
                const keys = Object.keys(v);
                for (let i = 0; i < keys.length; i++) {
                    const k = keys[i];
                    if (this.dropSet.has(k)) { continue; }
                    Object.defineProperty(stripped, k, {
                        value: (v as any)[k], writable: true, enumerable: true, configurable: true,
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
        let path: Array<string | number>;
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

// A discriminated union (not just the narrower FastPathDocumentEvaluator
// interface) so a caller that needs the concrete class - the array-splitter
// fast path (ArrayFastPath.ts), which drives ChainEvaluator.walkElement()
// or GenericWalker.walkRootArrayOpen()/element()/walkRootArrayClose()
// directly instead of walkDocument() - can narrow on `kind` and get it,
// while NdjsonFastPath.ts's own `evaluator: FastPathDocumentEvaluator`
// field keeps working unchanged (both members still structurally satisfy
// that interface).
export type CompiledFastPath =
    | { evaluator: ChainEvaluator; kind: 'chain' }
    | { evaluator: GenericWalker; kind: 'generic' };

export function compileFastPathEvaluator(yajsPath: YAJSPath, options: FastPathOptions,
                                          emit: EmitFn): CompiledFastPath {
    const chain = ChainEvaluator.compile(yajsPath, options, emit);
    if (chain) { return { evaluator: chain, kind: 'chain' }; }
    return { evaluator: new GenericWalker(yajsPath, options, emit), kind: 'generic' };
}
