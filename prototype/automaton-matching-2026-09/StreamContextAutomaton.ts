// End-to-end benchmark harness for issue #80: a copy of the real
// src/main/lib/context/StreamContext.ts (unmodified tokenizer wiring,
// ObjectDispatcher, PathOperator, StreamPosition - only relative import
// paths changed to reach them from this prototype directory, plus two
// import lines added for the automaton), with exactly the match decision
// swapped: `this.path.match(this.position)` (the real backward-walk)
// becomes `this.automatonMatcher.matched` (the automaton prototype).
//
// This mirrors the methodology PR #91's StreamContextSkipMatch.ts used for
// issue #89's Claim B: a near-verbatim copy of the real coordinator with
// ONE mechanism swapped, driven by the SAME real JsonSaxParser against the
// SAME real input, so an end-to-end paired benchmark (see e2e-bench.ts)
// measures the actual production-pipeline cost difference, not a synthetic
// matching-layer-only proxy.
//
// Everything else - startObject/endObject/startArray/endArray/onValue's own
// structural bookkeeping, the dispatcher suspend/resume stack, the depth
// gate, reset/resync handling - is untouched real engine logic.
//
// One deliberate extra change beyond the match-call swap: freshPosition()
// constructs StreamPosition with trackAncestorKeys ALWAYS false (never
// `!path.definite`, unlike the real StreamContext). That cache (issue #34's
// mAncestorKeys/mKeyDepthStacks) exists SOLELY to back YAJSPath's own
// nearestAncestorIndex(), which only the backward-walk's DESCENDANT branch
// ever calls - the automaton never calls it, so a real automaton-based port
// would eliminate that upkeep entirely, not just the match() call itself.
// Keeping it here would be a synthetic apples-to-apples harness bias that
// hides a genuine part of the automaton's own real-world saving.
import { ObjectDispatcher } from '../../src/main/lib/dispatcher/ObjectDispatcher';
import { PathOperator } from '../../src/main/lib/path/PathOperator';
import { YAJSPath } from '../../src/main/lib/path/YAJSPath';
import { StreamPosition } from '../../src/main/lib/context/StreamPosition';
import { AutomatonMatcher, CompiledAutomaton } from './automaton';

export class StreamContextAutomaton {

    private position: StreamPosition;
    private automatonMatcher: AutomatonMatcher;
    private readonly path: YAJSPath;
    private readonly automaton: CompiledAutomaton;
    private readonly pathIncludeArrayIndex: boolean;

    private dispatchers: ObjectDispatcher[] = [];
    private dispatcher: ObjectDispatcher;
    private dispatcherPool: ObjectDispatcher[] = [];

    private readonly onMatchListener: (value?: any) => void;
    private readonly onErrorListener: (err: Error) => void;

    private errored = false;
    private openContainers = 0;

    constructor(path: YAJSPath, automaton: CompiledAutomaton, onMatch: (path: string[], value?: any) => void,
                pathIncludeArrayIndex: boolean, onError: (err: Error) => void = (err) => { throw err; }) {
        this.path = path;
        this.automaton = automaton;
        this.onErrorListener = onError;
        this.pathIncludeArrayIndex = pathIncludeArrayIndex;

        this.onMatchListener = (value?: any) =>
            onMatch(this.position.path(pathIncludeArrayIndex), value);
    }

    reset(value?: any): void {
        this.freshPosition();
        this.match(value);
    }

    private freshPosition(): void {
        if (this.position !== undefined) {
            this.position.reinitialize();
            this.automatonMatcher.reset();
        } else {
            // trackAncestorKeys always false here - see the file header.
            this.position = new StreamPosition(this.pathIncludeArrayIndex, false);
            this.automatonMatcher = new AutomatonMatcher(this.automaton);
        }
    }

    resyncAfterError(): void {
        this.position = undefined;
        this.automatonMatcher = undefined;
        this.openContainers = 0;
        this.dispatcher = null;
        this.dispatchers = [];
        this.errored = false;
    }

    startObject(): void {
        if (this.errored) { return; }
        if (this.position === undefined || this.position.peek().getType() === PathOperator.Type.ROOT) {
            this.reset();
        }
        this.doOnValue();
        this.position.stepIntoObject();
        this.automatonMatcher.enterObjectSlot();
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
        this.automatonMatcher.exitObjectSlot();
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
        this.automatonMatcher.setKey(key);
        if (this.dispatcher) { this.dispatcher.startObjectEntry(key); }
    }

    startArray(): void {
       if (this.errored) { return; }
       if (this.position === undefined || this.position.peek().getType() === PathOperator.Type.ROOT) {
            this.freshPosition();
       } else if (this.position.peek().getType() === PathOperator.Type.ARRAY) {
            this.doOnValue();
       }
       this.position.stepIntoArray();
       this.automatonMatcher.enterArraySlot();
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
        this.automatonMatcher.exitArraySlot();
        if (this.dispatcher && this.dispatcher.endArray()) { this.completeDispatcher(); }
    }

    onValue(value: any): void {
        if (this.errored) { return; }
        if (this.isInRoot()) {
            if (this.position === undefined) {
                this.reset(value);
            } else {
                this.position.increaseArrayIndex();
                this.match(value);
            }
        } else {
            this.position.increaseArrayIndex();
            this.doOnValue(value);
        }
        if (this.dispatcher) { this.dispatcher.onValue(value); }
    }

    doOnValue(value?: any): void {
        if (this.position.peek().getType() !== PathOperator.Type.ROOT) {
            this.match(value);
        }
    }

    private match(value?: any): boolean {
        const currentDepth = this.position.pathDepth();
        // Same depth gate as the real StreamContext, kept for a fair/
        // conservative comparison (a cheap comparison either side pays -
        // see file header) even though the automaton's own `.matched` read
        // is already O(1) with or without it.
        if (this.path.minimumDepth <= currentDepth) {
            if (this.automatonMatcher.matched) {
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

    private canStepOut(): boolean {
        return this.openContainers > 0;
    }

    private reportError(err: Error): void {
        this.errored = true;
        this.onErrorListener(err);
    }

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
