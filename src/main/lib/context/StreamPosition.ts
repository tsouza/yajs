import { ArrayIndex } from '../path/operator/ArrayIndex';
import { ChildNode } from '../path/operator/ChildNode';
import { PathOperator } from '../path/PathOperator';
import { YAJSPath } from '../path/YAJSPath';

export class StreamPosition extends YAJSPath {

    private rootIndex = 0;
    private hasOnlyArrayIndex = true;

    // Issue #34: incremental cache backing nearestAncestorIndex(), so a
    // '..'-containing path's backward ancestor scan (see YAJSPath.match())
    // doesn't have to walk the full position stack from scratch on every
    // single match attempt - which, since a '..' path is never `definite`
    // and so is attempted at *every* depth as the document streams in,
    // compounds an O(depth) scan into O(depth^2) for a uniformly deep
    // document.
    //
    // mAncestorKeys[i] is the key currently "settled" (via
    // updateObjectEntry()) at position-stack index i, or undefined if index
    // i isn't currently a keyed ChildNode (e.g. it's an ArrayIndex, or an
    // object whose first key hasn't arrived yet). mKeyDepthStacks maps each
    // such key to the (strictly increasing, since deeper indices are always
    // recorded later) indices where it's *currently* the settled key -
    // i.e. a real, presently-open ancestor, not a stale leftover from a
    // since-closed/reused slot; see clearAncestorKeyAt(). "Nearest ancestor
    // with key K at or before index F" is then just "largest recorded
    // index <= F", found by binary search instead of a linear walk.
    //
    // trackAncestorKeys gates all of this bookkeeping off entirely (a plain
    // no-op on every call) whenever the path being matched has no '..' at
    // all: nearestAncestorIndex() is only ever consulted from match()'s
    // DESCENDANT branch, so a path without one would otherwise pay this
    // cache's upkeep cost on every single object key with nothing to show
    // for it - the exact "don't fix one path's quadratic blowup by
    // regressing every other path's common-case performance" pitfall this
    // fix's own task explicitly calls out. StreamContext passes
    // `!path.definite` (true iff the path contains a DESCENDANT - see the
    // YAJSPath constructor) when constructing a StreamPosition.
    private readonly trackAncestorKeys: boolean;
    private mAncestorKeys: string[] = [];
    private mKeyDepthStacks: Map<string, number[]> = new Map();

    // Issue #44: incremental cache backing path(), so a match doesn't have
    // to re-walk and re-filter the *entire* position stack from scratch
    // every single time - which, since path() is called on every successful
    // match (not just '..' ones), compounds an O(depth) rebuild into
    // O(matches * depth) overall, i.e. O(depth^2) for a selector like
    // '$..a' that matches at every depth of a uniformly deep document (the
    // same shape of blowup issue #34 fixed for the separate backward-scan
    // mechanism, but this one hits ALL matches, not just '..' ones).
    //
    // mSegments is kept as an already-filtered, contiguous (no gaps for
    // ARRAY/transparent entries) list of the *contributing* path segments
    // for whatever the position stack currently looks like - i.e. it is
    // always exactly what YAJSPath.path()'s O(depth) scan-and-filter loop
    // would currently produce, maintained incrementally instead of
    // recomputed - so path() itself becomes a single O(k) copy
    // (mSegments.slice()) of just the k real segments, with no
    // re-scanning of the (potentially much larger) full stack, including
    // ARRAY levels that never contribute anything unless
    // pathIncludeArrayIndex is set.
    //
    // mSegmentBaseline[i] is "how many segments mSegments held from
    // shallower levels alone, right when position-stack index i was most
    // recently entered" - i.e. the length to truncate mSegments back to
    // once index i (or anything it's currently holding) needs to be
    // retired, undone, or replaced. Recorded on every stepIntoObject()/
    // stepIntoArray() (mirroring mAncestorKeys' per-index bookkeeping), and
    // relied on by updateObjectEntry()/increaseArrayIndex() (replacing
    // whatever index i currently contributes) and stepOutObject()/
    // stepOutArray() (removing it entirely).
    //
    // Unlike trackAncestorKeys, this bookkeeping is NOT gated off for
    // "ordinary" (non-'..') paths: path() is invoked for every match
    // regardless of selector shape, so every path needs its segments kept
    // current, not just descendant ones. What IS gated is the "index
    // in op" side of the standard `if (op.key) ... else if (includeArrayIndex
    // && 'index' in op) ...` else-if in YAJSPath.path() - preserved here
    // as `pathIncludeArrayIndex`, fixed for the lifetime of this position
    // (StreamContext always constructs it from the same option that would
    // otherwise be passed into every path() call), which mirrors the
    // original else-if's short-circuit: an ArrayIndex level only ever
    // contributes when this is on, exactly as before.
    private readonly pathIncludeArrayIndex: boolean;
    private mSegments: Array<string | number> = [];
    private mSegmentBaseline: number[] = [];

    constructor(pathIncludeArrayIndex: boolean = false, trackAncestorKeys: boolean = true) {
        super();
        this.pathIncludeArrayIndex = pathIncludeArrayIndex;
        this.trackAncestorKeys = trackAncestorKeys;
    }

    // Depth (this.pathDepth(), taken right before the push) of the
    // innermost array currently establishing "hasOnlyArrayIndex" mode -
    // i.e. the array whose immediate elements should each be evaluated as
    // fresh match candidates (see isInRoot()). Undefined until the first
    // array is pushed since the last reset/full pop-out. A SECOND
    // consecutive array push while this is already set (no object push in
    // between) is past that array's own elements slot - it IS one of those
    // elements, and per issue #14 an element that's itself an array must be
    // captured as one whole value, not treated as yet another flattening
    // boundary - so hasOnlyArrayIndex switches off for it, exactly like
    // pushing an object already does.
    private arrayIndexDepth: number | undefined;

    stepIntoObject() {
        this.increaseArrayIndex();
        const previous = this.stepInto(PathOperator.Type.OBJECT);
        if (previous) {
            (previous as ChildNode).key = undefined;
        } else {
            this.push(new ChildNode());
        }
        const idx = this.pathDepth() - 1;
        // Issue #44: record where mSegments stood, from shallower levels
        // alone, right as this (possibly reused) slot is (re-)entered -
        // see mSegmentBaseline's field comment. Safe to record unconditionally
        // (no gate, unlike trackAncestorKeys below): a fresh/reused ChildNode
        // is keyless until updateObjectEntry() below, so it hasn't
        // contributed anything yet, and mSegments.length is already exactly
        // this baseline at this point (stepOutObject()/updateObjectEntry()
        // truncate it back down on every prior exit/replace of this same
        // idx) - this just caches that value for stepOutObject()/
        // updateObjectEntry() to truncate back to later.
        this.mSegmentBaseline[idx] = this.mSegments.length;
        if (this.trackAncestorKeys) {
            // A reused slot (the `previous` branch above) may still carry a
            // stale cache entry from whatever key last occupied it - clear
            // it now (before any match attempt can see it) rather than only
            // ever clearing lazily inside updateObjectEntry(), since this
            // new object is genuinely keyless until its first key arrives.
            this.clearAncestorKeyAt(idx);
        }
    }

    updateObjectEntry(key: string) {
        const idx = this.pathDepth() - 1;
        if (this.trackAncestorKeys) {
            // A single object with multiple keys reuses this exact same
            // ChildNode slot/index once per key (issue #34's cache tracks
            // keys by position-stack index, so each earlier key recorded
            // here must be retired before the new one is recorded, same as
            // the slot-reuse case in stepIntoObject()).
            this.clearAncestorKeyAt(idx);
            this.mAncestorKeys[idx] = key;
            let depths = this.mKeyDepthStacks.get(key);
            if (!depths) {
                depths = [];
                this.mKeyDepthStacks.set(key, depths);
            }
            depths.push(idx);
        }
        (this.peek() as ChildNode).key = key;
        // Issue #44: a later key on the same still-open object (or a reused
        // slot's new key) replaces whatever this idx last contributed to
        // mSegments, exactly the same slot-reuse concern updateObjectEntry()
        // already handles for mAncestorKeys above - truncate back to the
        // baseline recorded when idx was entered, then push the new segment.
        // Guarded by `if (key)`, not `key !== undefined`, to match
        // YAJSPath.path()'s own pre-existing `if (op.key)` truthiness check
        // (an empty-string key is - like there - not included).
        this.mSegments.length = this.mSegmentBaseline[idx];
        if (key) {
            this.mSegments.push(key);
        }
    }

    stepOutObject() {
        this.truncateSegmentsAt(this.pathDepth() - 1);
        this.pop();
    }

    stepIntoArray() {
        // Mirrors stepIntoObject()'s leading increaseArrayIndex() call: both
        // increment whatever ArrayIndex is currently on top of the stack -
        // the parent array's own running index - before descending into a
        // new element. Missing this (as this method did before issue #14's
        // fix made a nested array a matched value in its own right, rather
        // than always being flattened straight through to scalars) left a
        // matched nested array's own index at ArrayIndex's uninitialized -1
        // default instead of the real position within its parent array,
        // whenever pathIncludeArrayIndex is used.
        this.increaseArrayIndex();
        if (!this.stepInto(PathOperator.Type.ARRAY)) {
            this.push(new ArrayIndex());
        }
        const idx = this.pathDepth() - 1;
        // Issue #44: same reasoning as stepIntoObject() - this freshly
        // entered ArrayIndex slot hasn't contributed a segment yet (only
        // increaseArrayIndex() below does, once pathIncludeArrayIndex is on
        // and a sibling element actually arrives), so mSegments.length
        // right now already equals this idx's correct baseline; cache it
        // for stepOutArray()/increaseArrayIndex() to truncate back to.
        this.mSegmentBaseline[idx] = this.mSegments.length;
        if (this.trackAncestorKeys) {
            // Same reasoning as stepIntoObject(): a reused (or, in
            // principle, otherwise stale) slot at this index must not keep
            // masquerading as whatever key last occupied it - an ArrayIndex
            // position is never itself keyed.
            this.clearAncestorKeyAt(idx);
        }
    }

    stepOutArray() {
        this.truncateSegmentsAt(this.pathDepth() - 1);
        this.pop();
    }

    isInRoot(): boolean {
        return this.hasOnlyArrayIndex ||
            this.peek().getType() === PathOperator.Type.ROOT;
    }

    push(operator: PathOperator): void {
        if (operator.getType() !== PathOperator.Type.ARRAY) {
            this.hasOnlyArrayIndex = false;
            this.arrayIndexDepth = undefined;
        } else if (this.hasOnlyArrayIndex) {
            if (this.arrayIndexDepth === undefined) {
                // First array push since the last reset/full pop-out: this
                // is the array container itself. Its elements start one
                // level below it - remember that boundary so a further,
                // consecutive array push (see arrayIndexDepth's field
                // comment) is recognized as one of its elements, not another
                // fresh container.
                this.rootIndex = this.pathDepth();
                this.arrayIndexDepth = this.pathDepth();
            } else {
                this.hasOnlyArrayIndex = false;
            }
        }
        super.push(operator);
    }

    pop(): void {
        const peek = this.peek();
        if (peek && 'index' in peek) {
            // Issue #60: must match ArrayIndex's own constructor (-1), not 0
            // - increaseArrayIndex() always pre-increments before recording
            // a new element's index, so a fresh/recycled slot must start one
            // below the first real index (0) for that first increment to
            // land correctly. Resetting to 0 here made a reused slot's first
            // increaseArrayIndex() call go 0 -> 1 instead of -1 -> 0, so
            // every index reported for a sibling array reusing this
            // position-stack slot (yajs's slot-reuse optimization) was off
            // by one.
            (peek as any).index = -1;
        }
        super.pop();
        const pathDepth = this.pathDepth();
        if (pathDepth <= this.rootIndex) {
            this.hasOnlyArrayIndex = true;
            this.rootIndex = pathDepth;
            this.arrayIndexDepth = undefined;
        } else if (this.arrayIndexDepth !== undefined && pathDepth === this.arrayIndexDepth + 1) {
            // Back at the elements slot of the still-open array container
            // (one element - whatever it was - just closed): ready to treat
            // the next sibling element as a fresh candidate again.
            this.hasOnlyArrayIndex = true;
        }
    }

    increaseArrayIndex() {
        const peek = this.peek();
        if (peek && 'index' in peek) {
            (peek as ArrayIndex).index++;
            if (this.pathIncludeArrayIndex) {
                // Issue #44: the array currently on top of the stack just
                // advanced to a new element - its own contributed segment
                // (if pathIncludeArrayIndex is on) changes to match, exactly
                // like updateObjectEntry() replaces a ChildNode's segment on
                // a new key: truncate back to this idx's own baseline (this
                // IS the idx whose ArrayIndex was pushed, hence its own
                // recorded baseline applies), then push the new index.
                const idx = this.pathDepth() - 1;
                this.mSegments.length = this.mSegmentBaseline[idx];
                this.mSegments.push((peek as ArrayIndex).index);
            }
        }
    }

    private stepInto(type: PathOperator.Type): PathOperator {
        if (this.hasPreviousPeek()) {
            const previous = this.previousPeek();
            if (previous.getType() === type) {
                this.size++;
                this.top = undefined;
                return previous;
            }
        }
        return null;
    }

    // Issue #34: O(log depth) override of YAJSPath's O(depth) linear-scan
    // fallback, backed by mAncestorKeys/mKeyDepthStacks (see their field
    // comments). A '..' scan's target (YAJSPath.match()'s `prevScan`, after
    // its own collapsing through non-selective WILDCARD/DESCENDANT
    // operators - see issue #39) is always either Root or a real keyed
    // ChildNode by the time it reaches here.
    nearestAncestorIndex(target: PathOperator, fromIndex: number): number {
        if (target.getType() === PathOperator.Type.ROOT) {
            // Every position starts with exactly one Root operator, always
            // at index 0 (see the YAJSPath constructor) - no search needed,
            // regardless of trackAncestorKeys. Still bounded by fromIndex,
            // though: match()'s caller can pass a negative fromIndex (a
            // collapsed WILDCARD's own still-unaccounted-for mandatory hop
            // pushing the search ceiling below the true root itself - see
            // issue #39) specifically to signal "even Root doesn't have
            // enough room here", which must fail, not trivially "succeed".
            return fromIndex >= 0 ? 0 : -1;
        }
        // Falls back to the base class's plain linear scan whenever the
        // cache isn't being maintained (trackAncestorKeys is false - see
        // its field comment) - correct either way, just without the O(log
        // depth) speed-up, which is only actually needed for a '..'-
        // containing path in the first place.
        if (this.trackAncestorKeys && target.getType() === PathOperator.Type.OBJECT) {
            const depths = this.mKeyDepthStacks.get((target as ChildNode).key);
            return depths ? StreamPosition.largestAtMost(depths, fromIndex) : -1;
        }
        return super.nearestAncestorIndex(target, fromIndex);
    }

    // Issue #44: O(k) override of YAJSPath's O(depth) path() (k = the
    // number of segments actually in the resulting path, always <= depth,
    // often much less once ARRAY/transparent stack levels are excluded).
    // mSegments (see its field comment) is kept exactly in sync with what
    // the base class's scan-and-filter loop would currently produce, so
    // there is nothing left to do here but hand back an independent copy -
    // every match still gets its own array (still genuinely O(k), which is
    // inherent - see the field comment), but with none of the redundant
    // O(depth) re-filtering of the full stack on every single call.
    //
    // The `includeArrayIndex` parameter is intentionally unused: it is
    // baked into this.pathIncludeArrayIndex at construction time instead
    // (see the field comment), because - unlike YAJSPath.path(), which
    // recomputes from scratch and so can honor a different flag on every
    // call - mSegments is maintained incrementally and can only ever
    // reflect one fixed answer to "include array indices or not". This is
    // safe because StreamContext's only caller always passes the exact
    // same pathIncludeArrayIndex it constructed this StreamPosition with.
    path(_includeArrayIndex?: boolean): string[] {
        return this.mSegments.slice() as string[];
    }

    // Truncates mSegments back to whatever it held before position-stack
    // index idx last contributed anything - i.e. undoes idx's own
    // contribution (if it made one), without touching any shallower
    // level's. Shared by stepOutObject()/stepOutArray(), both of which call
    // this with idx still on top of the stack (before the matching pop()
    // actually removes it) so mSegmentBaseline[idx] is still valid to read.
    private truncateSegmentsAt(idx: number): void {
        this.mSegments.length = this.mSegmentBaseline[idx];
    }

    // Retires index idx's cache entry (if any) before it's about to be
    // reused for something else (a fresh/reused ChildNode or ArrayIndex
    // slot at that same position-stack depth) or overwritten with a new
    // key (a later key of the same still-open object). Must run before any
    // match attempt can observe the new occupant, otherwise a stale entry
    // would let a since-closed (or since-renamed) ancestor's key keep
    // masquerading as a currently-open one.
    private clearAncestorKeyAt(idx: number): void {
        const staleKey = this.mAncestorKeys[idx];
        if (staleKey === undefined) {
            return;
        }
        const depths = this.mKeyDepthStacks.get(staleKey);
        // LIFO invariant: position-stack indices are always recorded here
        // in strictly increasing order as we descend, and can only be
        // retired in the reverse (deepest-first) order they were recorded
        // - so idx, once it's the one being retired, is always depths'
        // topmost/last entry.
        depths.pop();
        if (depths.length === 0) {
            this.mKeyDepthStacks.delete(staleKey);
        }
        this.mAncestorKeys[idx] = undefined;
    }

    // Largest value in a strictly increasing array that is <= atMost, or
    // -1 if none exists (e.g. the array is empty, or every entry exceeds
    // atMost).
    private static largestAtMost(sorted: number[], atMost: number): number {
        let lo = 0;
        let hi = sorted.length - 1;
        let result = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (sorted[mid] <= atMost) {
                result = sorted[mid];
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }
        return result;
    }
}
