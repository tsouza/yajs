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
            if (next.getType() === PathOperator.Type.OBJECT) {
                this.size++;
                (next as ChildNode).key = undefined;
                this.top = undefined;
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
            if (next.getType() === PathOperator.Type.ARRAY) {
                this.size++;
                this.top = undefined;
                return;
            }
        }
        this.push(new ArrayIndex());
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
        const pathDepth = this.pathDepth();
        if (pathDepth <= this.rootIndex) {
            this.hasOnlyArrayIndex = true;
            this.rootIndex = pathDepth;
        }
    }
}
