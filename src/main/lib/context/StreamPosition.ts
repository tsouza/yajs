import { ArrayIndex } from '../path/operator/ArrayIndex';
import { ChildNode } from '../path/operator/ChildNode';
import { PathOperator } from '../path/PathOperator';
import { YAJSPath } from '../path/YAJSPath';

export class StreamPosition extends YAJSPath {

    private rootIndex = 0;
    private hasOnlyArrayIndex = true;

    stepIntoObject() {
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
        } else if (this.hasOnlyArrayIndex) {
            this.rootIndex = this.pathDepth();
        }
        super.push(operator);
    }

    pop(): void {
        super.pop();
        const pathDepth = this.pathDepth();
        if (pathDepth <= this.rootIndex) {
            this.hasOnlyArrayIndex = true;
            this.rootIndex = pathDepth;
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
