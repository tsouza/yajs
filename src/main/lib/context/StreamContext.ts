import { ObjectDispatcher } from '../dispatcher/ObjectDispatcher';
import { PathOperator } from '../path/PathOperator';
import { YAJSPath } from '../path/YAJSPath';
import { StreamPosition } from './StreamPosition';

export class StreamContext {

    private position: StreamPosition;
    private readonly path: YAJSPath;
    // Issue #44: saved (rather than only living in onMatchListener's own
    // closure, as before) because it must also be threaded into every
    // `new StreamPosition(...)` call below - StreamPosition now bakes this
    // flag in at construction time instead of taking it per path() call
    // (see StreamPosition's own field comment for why).
    private readonly pathIncludeArrayIndex: boolean;

    // this.dispatcher is the currently *active* dispatcher (the one that
    // receives every forwarded startObject/startArray/startObjectEntry/
    // onValue/endObject/endArray call). this.dispatchers is a LIFO stack of
    // *suspended* ancestor dispatchers: when a new candidate value starts
    // while one is already active (e.g. a nested array/object that itself
    // matches the path, or - see StreamPosition - a fresh top-level-array
    // element), the current dispatcher is pushed here and parked until the
    // newer one completes, at which point it is popped back into
    // this.dispatcher and resumes receiving events.
    //
    // Only the active dispatcher ever receives events (see dispatch()) -
    // suspended ones are inert. This keeps both memory and per-event work
    // O(depth) instead of the O(depth^2) that resulted from forwarding every
    // event to *every* dispatcher ever created: a long run of consecutive
    // array/object opens (e.g. thousands of unclosed `[`) used to leave all
    // of them simultaneously "active", so each subsequent open re-dispatched
    // startArray() to every previously-accumulated dispatcher, each of which
    // independently rebuilt its own copy of everything nested below it.
    private dispatchers: ObjectDispatcher[] = [];
    private dispatcher: ObjectDispatcher;

    // Completed dispatchers, reset and parked for reuse by a later match.
    // Every dispatcher this context ever hands out is configured identically
    // (same listener/projection/dropKeys, all derived from the one selector),
    // so a cleanly completed one - resetForReuse() returns it to its
    // just-constructed state - is indistinguishable from a fresh allocation.
    // Dispatchers abandoned mid-build by resyncAfterError() are simply
    // dropped, never pooled, so the pool only ever holds clean instances.
    private dispatcherPool: ObjectDispatcher[] = [];

    private readonly onMatchListener: (value?: any) => void;
    private readonly onErrorListener: (err: Error) => void;

    // Set once a structural error (e.g. a closing bracket with nothing open
    // to close) has been reported through onErrorListener. Mirrors
    // JsonSaxParser's ERROR terminal state: once a structural error is
    // reported, further tokens are ignored instead of being interpreted
    // against corrupted/absent position state, and the error is reported
    // exactly once.
    private errored = false;

    // Number of object/array containers currently open, tracked completely
    // independently of `position`'s own depth. endObject()/endArray() use
    // this - not position.pathDepth() - to decide whether there is
    // anything to close: `position` gets wholesale replaced by reset() every
    // time a fresh top-level-ish candidate begins (see StreamPosition's
    // hasOnlyArrayIndex), which for a run of consecutive array opens keeps
    // resetting it back to a shallow depth rather than growing with true
    // nesting - so position.pathDepth() does not reliably reflect how many
    // containers are actually open. A plain open/close counter has no such
    // blind spot: every startObject()/startArray() call is exactly one
    // container opening and every successful endObject()/endArray() is
    // exactly one closing, regardless of what reset() does to `position` in
    // between.
    private openContainers = 0;

    constructor(path: YAJSPath, onMatch: (path: string[], value?: any) => void,
                pathIncludeArrayIndex: boolean, onError: (err: Error) => void = (err) => { throw err; }) {
        this.path = path;
        this.onErrorListener = onError;
        this.pathIncludeArrayIndex = pathIncludeArrayIndex;

        this.onMatchListener = (value?: any) =>
            onMatch(this.position.path(pathIncludeArrayIndex), value);
    }

    reset(value?: any): void {
        this.freshPosition();
        this.match(value);
    }

    // Both callers need "a position in its just-constructed state at a
    // genuinely fresh document boundary": reuse the existing instance
    // (reinitialize() - it is already back at bare root whenever this is
    // reached with a position at all, see the callers' ROOT checks) rather
    // than allocating a new StreamPosition per document, which for NDJSON
    // meant a full Stack/Root/Map/arrays construction per record and threw
    // away the operator-slot reuse the stack had built up. A genuinely
    // fresh construction only happens on the very first document and after
    // resyncAfterError() (which nulls the position precisely because its
    // mid-record state - including the incremental caches - can't be
    // trusted).
    //
    // Only a '..'-containing path (path.definite false - see the
    // YAJSPath constructor) ever consults nearestAncestorIndex(), so
    // only such a path needs StreamPosition to pay its incremental
    // upkeep cost (issue #34) - everything else gets the cache as a
    // pure no-op, keeping ordinary (non-descendant) matching exactly as
    // cheap as before this fix.
    private freshPosition(): void {
        if (this.position !== undefined) {
            this.position.reinitialize();
        } else {
            this.position = new StreamPosition(this.pathIncludeArrayIndex, !this.path.definite);
        }
    }

    // Counterpart to JsonSaxParser's own resyncAfterError() (see its
    // JsonSaxParser.ts field/method comments) - invoked via the parser's
    // onResync callback once it recovers from its terminal ERROR state at
    // an NDJSON newline boundary and starts tokenizing a fresh top-level
    // document. reset() alone is not enough here: reset() only replaces
    // `position`, on the assumption that whatever container was open
    // before it closed normally - exactly the assumption that does NOT
    // hold for the record the parser just abandoned mid-parse. Without
    // also unwinding `openContainers`/`dispatcher`/`dispatchers`/`errored`,
    // startObject()/startArray()/onValue() for the next record would still
    // see a non-ROOT `position` (left mid-way through the abandoned
    // record's nesting) and wrongly treat it as a descendant of that dead
    // record instead of a fresh document - silently losing every match
    // from then on, exactly the bug this method exists to prevent.
    // Resetting `position` to undefined (rather than a fresh
    // StreamPosition, as reset() does) mirrors the constructor's own
    // initial state and is what every startObject()/startArray()/onValue()
    // call already treats as "no document in flight yet" - the same
    // ROOT-equivalent check they already handle for the very first
    // document.
    resyncAfterError(): void {
        this.position = undefined;
        this.openContainers = 0;
        this.dispatcher = null;
        this.dispatchers = [];
        this.errored = false;
    }

    startObject(): void {
        if (this.errored) { return; }
        if (this.position === undefined || this.position.peek().getType() === PathOperator.Type.ROOT) {
            // Genuinely fresh boundary only (not merely "hasOnlyArrayIndex" -
            // see startArray()'s matching check): replacing position here
            // whenever hasOnlyArrayIndex was still true - even for an object
            // that's actually a sibling deep in an already-open matched
            // array - would throw away that array's own tracking, breaking
            // a LATER array-typed sibling's ability to recognize itself as
            // one of that same array's elements (issue #14). Leaving
            // position untouched for a mid-array object is safe: the
            // doOnValue() call below matches it correctly regardless
            // (Root/ChildNode's array transparency reaches through to it
            // exactly as it does for the top-level-fresh case).
            this.reset();
        }
        this.doOnValue();
        this.position.stepIntoObject();
        this.openContainers++;
        if (this.dispatcher) { this.dispatcher.startObject(); }
    }

    endObject(): void {
        if (this.errored) { return; }
        if (!this.canStepOut()) {
            this.reportError(new Error(
                'Unexpected end of object: no matching object was opened'));
            return;
        }
        this.openContainers--;
        this.position.stepOutObject();
        if (this.dispatcher && this.dispatcher.endObject()) { this.completeDispatcher(); }
    }

    startObjectEntry(key: string): void {
        if (this.errored) { return; }
        if (this.position === undefined) {
            this.reportError(new Error(
                'Unexpected object key: no object was opened'));
            return;
        }
        this.position.updateObjectEntry(key);
        if (this.dispatcher) { this.dispatcher.startObjectEntry(key); }
    }

    startArray(): void {
       if (this.errored) { return; }
       if (this.position === undefined || this.position.peek().getType() === PathOperator.Type.ROOT) {
            // A genuinely fresh boundary (document start, or back at bare
            // root between NDJSON documents): refresh position, but - unlike
            // startObject() - do NOT match here. Per issue #14 a matched
            // array is never captured as one whole value; only its elements
            // are (see the ARRAY branch below), so matching against the
            // array's own container position must never succeed.
            this.freshPosition();
       } else if (this.position.peek().getType() === PathOperator.Type.ARRAY) {
            // Still within an already-open array's elements slot (see
            // StreamPosition's arrayIndexDepth): this array-open IS one of
            // that array's elements. Attempt a match/dispatcher spawn for it
            // here - exactly like startObject() already does for every
            // object it opens - instead of treating it as another fresh
            // top-level candidate (issue #14's flattening bug). Checked
            // structurally (not via isInRoot()) so this also fires for a
            // named-key path like $.a reaching into a's array value, where
            // hasOnlyArrayIndex is already false because of the object(s)
            // above "a".
            this.doOnValue();
       }
       // Any other peek() (ChildNode/Wildcard: we've just entered a key and
       // are about to see its value, which happens to open with '[') is
       // neither of the above - the array's own container position, not one
       // of an already-open array's elements - so nothing matches here.
       this.position.stepIntoArray();
       this.openContainers++;
       if (this.dispatcher) { this.dispatcher.startArray(); }
    }

    endArray(): void {
        if (this.errored) { return; }
        if (!this.canStepOut()) {
            this.reportError(new Error(
                'Unexpected end of array: no matching array was opened'));
            return;
        }
        this.openContainers--;
        this.position.stepOutArray();
        if (this.dispatcher && this.dispatcher.endArray()) { this.completeDispatcher(); }
    }

    onValue(value: any): void {
        if (this.errored) { return; }
        // A bare scalar (number/string/boolean/null) at the document root fires
        // onValue() directly - unlike objects/arrays, no startObject()/startArray()
        // ever runs first to initialize the position, so it must be handled here.
        if (this.isInRoot()) {
            if (this.position === undefined) {
                this.reset(value);
            } else {
                // Unlike the position===undefined case, do NOT replace
                // position here: it may already be tracking an open array's
                // elements slot (StreamPosition's arrayIndexDepth), and a
                // later sibling element that turns out to be an array (see
                // startArray()) needs that tracking to still be there -
                // wiping it via reset() would make that sibling look like a
                // fresh top-level candidate instead of one of this array's
                // own elements (issue #14). Matching directly against the
                // untouched position gives the same result for the truly
                // fresh case too (peek() there is already Root, exactly what
                // a fresh position would produce).
                //
                // increaseArrayIndex() first, mirroring startObject()'s/
                // startArray()'s own leading call before their doOnValue():
                // a scalar sitting directly in an already-open array's
                // elements slot is exactly as much one of that array's
                // indexed elements as an object or array sibling is - the
                // matched-array bugfix above already covers stepIntoArray(),
                // but this scalar path was still missing it, leaving
                // pathIncludeArrayIndex's output at -1 for the scalar itself
                // AND permanently desynced for every later sibling (since
                // the increment this position was relying on other siblings
                // to eventually provide never happened). Safe to call
                // unconditionally: on a genuinely fresh Root-only position
                // (e.g. a bare scalar at the document root), peek() has no
                // `index` field, so increaseArrayIndex() is a no-op, exactly
                // like it already is at the top of stepIntoObject().
                this.position.increaseArrayIndex();
                this.match(value);
            }
        } else {
            this.position.increaseArrayIndex();
            // Issue #46: this used to be gated on `isEmpty(path.projectExpression)`
            // - i.e. it only ever attempted a match for a scalar at all when the
            // path had no `{...}` project clause, on the (incorrect) assumption
            // that a projected path's match target is always an object (there's
            // nothing to project keys out of a scalar, but that doesn't mean a
            // scalar can never BE the matched value at a projected path - e.g.
            // "$.a{x}" against {"a":5}, where "a" is genuinely the whole match).
            // That assumption silently dropped exactly that case: the value
            // simply vanished, with no match attempted and nothing emitted.
            // doOnValue() below always attempts the match unconditionally; when
            // it succeeds for a scalar, match() (see its own `value !== undefined`
            // branch) delivers the scalar straight to onMatchListener(), bypassing
            // ObjectDispatcher/the project-keys filter entirely - which is exactly
            // the right behavior here, since "project properties out of an
            // object" has no defined meaning for a scalar value in the first
            // place.
            this.doOnValue(value);
        }
        if (this.dispatcher) { this.dispatcher.onValue(value); }
    }

    doOnValue(value?: any): void {
        // Root is the only operator overriding PathOperator.onValue() (with a
        // no-op) - every other operator's onValue() just invokes the delegate
        // immediately. Branching on the type here, instead of the previous
        // `peek().onValue(() => this.match(value))`, avoids allocating a
        // fresh capturing closure per structural event on the hot path.
        if (this.position.peek().getType() !== PathOperator.Type.ROOT) {
            this.match(value);
        }
    }

    private match(value?: any): boolean {
        const currentDepth = this.position.pathDepth();
        // The depth gate applies to definite paths too: minimumDepth for a
        // definite path is the full pattern size (see YAJSPath.minimumDepth),
        // and matchFrom() consumes at least one position level per pattern
        // operator (every loop iteration decrements pointer2 exactly once,
        // and pointer1 at most once), so a position shallower than the
        // pattern can never match - attempting it just walks the pattern to
        // a guaranteed failure. Skipping those attempts prunes the
        // shallow-depth match calls a streaming document generates
        // constantly (every scalar/object-open above the target depth).
        if (this.path.minimumDepth <= currentDepth) {
            if (this.path.match(this.position)) {
                if (value !== undefined) {
                    this.onMatchListener(value);
                } else {
                    let dispatcher = this.dispatcherPool.pop();
                    if (!dispatcher) {
                        dispatcher = new ObjectDispatcher(this.onMatchListener,
                            this.path.projectExpression,
                            this.path.projectKeys);
                        dispatcher.dropKeys = this.path.dropKeys;
                    }

                    // Suspend whatever dispatcher is currently active (if any)
                    // beneath the new one - see the field comment on
                    // this.dispatchers for why this must stay O(1) here.
                    if (this.dispatcher) {
                        this.dispatchers.push(this.dispatcher);
                    }
                    this.dispatcher = dispatcher;
                }
                return true;
            }
        }
        return false;
    }

    private isInRoot(): boolean {
        return this.position === undefined ||
            this.position.isInRoot();
    }

    // Whether there is a currently-open object/array for endObject()/
    // endArray() to close - see the openContainers field comment for why
    // this counter, not position.pathDepth(), is the source of truth.
    //
    // In the normal yajs() pipeline this guard (and startObjectEntry()'s
    // equivalent below) is defense in depth, not the primary line of
    // defense: JsonSaxParser's own structural-grammar layer already
    // rejects an unmatched close/colon before ever calling endObject()/
    // endArray()/startObjectEntry(), so this branch is not reachable
    // through the wired stream for input that goes through the tokenizer.
    // It stays load-bearing for any other caller that drives StreamContext
    // directly, and as a backstop against a future bug in the tokenizer's
    // own grammar tracking.
    private canStepOut(): boolean {
        return this.openContainers > 0;
    }

    private reportError(err: Error): void {
        this.errored = true;
        this.onErrorListener(err);
    }

    // Invoked when the active dispatcher's endObject()/endArray() reported
    // completion (each event site calls the dispatcher directly now - the
    // former dispatch(visitor) indirection allocated a fresh closure per
    // structural event on the hot path).
    //
    // The active dispatcher just completed - grab its own fully
    // built value (it has already popped back to its own root, so
    // peek().value holds it) before resuming whichever ancestor (if
    // any) is waiting beneath it.
    //
    // Issue #38: while this dispatcher was active, whichever
    // ancestor it suspended received NONE of the events that built
    // this dispatcher's value - including the one event
    // (startObject()/startArray()) that would otherwise have
    // attached it under the ancestor's own currently-pending key/
    // array slot (that event went only to this - the new, more
    // specific - dispatcher instead, since suspension happens
    // before it's forwarded; see match()). Left alone, the
    // ancestor's own eventual match silently comes out missing this
    // entire subtree once it resumes.
    //
    // Replaying the full buffered event stream to the ancestor
    // would fix that but cost O(subtree size) per suspend/resume
    // pair - for a uniformly nested '..'/wildcard match (many
    // concurrently-suspended ancestors, one per depth level) that's
    // the same O(depth^2) blowup issue #34 fixes elsewhere.
    // Injecting the single already-fully-built value directly - via
    // the ancestor's own onValue(), the exact same entry point a
    // live startObject()/startArray()/onValue() event would have
    // used - is O(1) instead: the ancestor doesn't need to relive
    // how the value was built, only what it ended up being.
    private completeDispatcher(): void {
        const completed = this.dispatcher;
        const completedValue = completed.peek().value;
        completed.resetForReuse();
        this.dispatcherPool.push(completed);
        this.dispatcher = this.dispatchers.pop() || null;
        if (this.dispatcher) {
            this.dispatcher.onValue(completedValue);
        }
    }
}
