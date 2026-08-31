import { ArrayIndex } from '../path/operator/ArrayIndex';
import { ChildNode } from '../path/operator/ChildNode';
import { PathOperator } from '../path/PathOperator';
import { YAJSPath } from '../path/YAJSPath';

export class StreamPosition extends YAJSPath {

    private rootIndex = 0;
    private hasOnlyArrayIndex = true;

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
    }

    updateObjectEntry(key: string) {
        (this.peek() as ChildNode).key = key;
    }

    stepOutObject() {
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
    }

    stepOutArray() {
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
            (peek as any).index = 0;
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
}
