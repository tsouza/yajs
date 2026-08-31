import { isEmpty } from 'lodash';
import { ObjectDispatcher } from '../dispatcher/ObjectDispatcher';
import { PathOperator } from '../path/PathOperator';
import { YAJSPath } from '../path/YAJSPath';
import { StreamPosition } from './StreamPosition';

export class StreamContext {

    private position: StreamPosition;
    private readonly path: YAJSPath;

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

    private readonly onMatchListener: (value?: any) => void;
    private readonly onValueListener: (value: any) => any;
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

        this.onMatchListener = (value?: any) =>
            onMatch(this.position.path(pathIncludeArrayIndex), value);

        this.onValueListener = isEmpty(path.projectExpression) ?
            (value) => this.doOnValue(value) : (value) => value;
    }

    reset(value?: any): void {
        this.position = new StreamPosition();
        this.match(value);
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
        this.dispatch((dispatcher) => {
            dispatcher.startObject();
            return false;
        });
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
        this.dispatch((dispatcher) => dispatcher.endObject());
    }

    startObjectEntry(key: string): void {
        if (this.errored) { return; }
        if (this.position === undefined) {
            this.reportError(new Error(
                'Unexpected object key: no object was opened'));
            return;
        }
        this.position.updateObjectEntry(key);
        this.dispatch((dispatcher) => {
            dispatcher.startObjectEntry(key);
            return false;
        });
    }

    startArray(): void {
       if (this.errored) { return; }
       if (this.position === undefined || this.position.peek().getType() === PathOperator.Type.ROOT) {
            // A genuinely fresh boundary (document start, or back at bare
            // root between NDJSON documents): replace position, but - unlike
            // startObject() - do NOT match here. Per issue #14 a matched
            // array is never captured as one whole value; only its elements
            // are (see the ARRAY branch below), so matching against the
            // array's own container position must never succeed.
            this.position = new StreamPosition();
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
       this.dispatch((dispatcher) => {
            dispatcher.startArray();
            return false;
        });
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
        this.dispatch((dispatcher) => dispatcher.endArray());
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
            this.onValueListener(value);
        }
        this.dispatch((dispatcher) => {
            dispatcher.onValue(value);
            return false;
        });
    }

    doOnValue(value?: any): void {
        this.position.peek().
            onValue(() => this.match(value));
    }

    private match(value?: any): boolean {
        const currentDepth = this.position.pathDepth();
        if (this.path.definite || this.path.minimumDepth <= currentDepth) {
            if (this.path.match(this.position)) {
                if (value !== undefined) {
                    this.onMatchListener(value);
                } else {
                    const dispatcher = new ObjectDispatcher(this.onMatchListener,
                        this.path.projectExpression,
                        this.path.projectKeys);

                    dispatcher.dropKeys = this.path.dropKeys;

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

    private dispatch(visitor: (dispatcher: ObjectDispatcher) => boolean): void {
        if (this.dispatcher && visitor(this.dispatcher)) {
            // The active dispatcher just completed - resume whichever
            // ancestor (if any) is waiting beneath it.
            this.dispatcher = this.dispatchers.pop() || null;
        }
    }
}
