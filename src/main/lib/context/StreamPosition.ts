import { ArrayIndex } from '../path/operator/ArrayIndex';
import { ChildNode } from '../path/operator/ChildNode';
import { PathOperator } from '../path/PathOperator';
import { YAJSPath } from '../path/YAJSPath';

export class StreamPosition extends YAJSPath {

    private rootIndex = 0;
    private hasOnlyArrayIndex = true;

    stepIntoObject() {
        if (this.operators.length > this.size) {
            const next = this.operators[this.size];
            if (next instanceof ChildNode) {
                this.size++;
                (next as ChildNode).key = undefined;
                return;
            }
        }
        this.push(new ChildNode());
    }

    updateObjectEntry(key: string) {
        (this.peek() as ChildNode).key = key;
    }

    stepOutObject() {
        this.pop();
    }

    stepIntoArray() {
        if (this.operators.length > this.size) {
            const next = this.operators[this.size];
            if (next instanceof ArrayIndex) {
                this.size++;
                (next as ArrayIndex).reset();
                return;
            }
        }
        this.push(new ArrayIndex());
    }

    accumulateArrayIndex() {
        const top = this.peek();
        if (top.getType() === PathOperator.Type.ARRAY) {
            (top as ArrayIndex).arrayIndex++;
            return true;
        }
        return false;
    }

    stepOutArray() {
        this.pop();
    }

    isInRoot(): boolean {
        return this.hasOnlyArrayIndex ||
            this.peek().getType() === PathOperator.Type.ROOT;
    }

    protected push(operator: PathOperator): void {
        if (operator.getType() !== PathOperator.Type.ARRAY) {
            this.hasOnlyArrayIndex = false;
        } else if (this.hasOnlyArrayIndex) {
            this.rootIndex = this.pathDepth();
        }
        super.push(operator);
    }

    protected pop(): void {
        super.pop();
        if (this.pathDepth() <= this.rootIndex) {
            this.hasOnlyArrayIndex = true;
            this.rootIndex = this.pathDepth();
        }
    }
}
