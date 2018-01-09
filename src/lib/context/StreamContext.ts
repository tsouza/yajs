import { isEmpty } from 'lodash';
import { JsonDispatcher } from '../dispatcher/ObjectDispatcher';
import { PathOperator } from '../path/PathOperator';
import { YAJSPath } from '../path/YAJSPath';
import { StreamPosition } from './StreamPosition';

export class StreamContext {

    private position: StreamPosition;
    private path: YAJSPath;
    private listener: (value?: any) => void;

    private dispatchers: JsonDispatcher[] = [];

    private stackIndex = 0;

    constructor(path: YAJSPath, listener: (path: string[], value?: any) => void) {
        this.path = path;
        this.listener = (value?: any) =>
            listener(this.position.path(), value);
    }

    reset(): void {
        this.position = new StreamPosition();
        this.match();
    }

    startObject(): void {
        if (this.isInRoot()) {
            this.reset();
        }
        this.stackIndex++;
        const currentNode = this.position.peek();
        switch (currentNode.getType()) {
            case PathOperator.Type.OBJECT:
            case PathOperator.Type.ARRAY:
                this.match();
                break;
            case PathOperator.Type.ROOT:
                break;
            default:
                throw new Error();
        }
        this.position.stepIntoObject();
        this.dispatch((dispatcher) => {
            dispatcher.startObject();
            return false;
        });
    }

    endObject(): void {
        this.stackIndex--;
        this.position.stepOutObject();
        this.dispatch((dispatcher) => dispatcher.endObject());
    }

    startObjectEntry(key: string): void {
        this.position.updateObjectEntry(key);
        this.dispatch((dispatcher) => {
            dispatcher.startObjectEntry(key);
            return false;
        });
    }

    startArray(): void {
       if (this.isInRoot()) {
            this.reset();
       }
        /*this.stackIndex++;
        let currentNode = this.position.peek();
        switch (currentNode.getType()) {
            case PathOperator.Type.OBJECT:
            case PathOperator.Type.ARRAY:
                this.match();
                break;
            case PathOperator.Type.ROOT:
                break;
            default:
                throw new Error();
        }
        let arrayIndex = this.position.pathDepth();
        //this.workingPath.insertAt(arrayIndex, new ArrayIndex());*/
       this.position.stepIntoArray();
       this.dispatch((dispatcher) => {
            dispatcher.startArray();
            return false;
        });
    }

    endArray(): void {
        // this.stackIndex--;
        this.position.stepOutArray();
        // this.workingPath.pop();
        this.dispatch((dispatcher) => dispatcher.endArray());
    }

    onValue(value: any): void {
        if (isEmpty(this.path.projectExpression)) {
            const currentNode = this.position.peek();
            switch (currentNode.getType()) {
                case PathOperator.Type.OBJECT:
                case PathOperator.Type.ARRAY:
                    this.match(value);
                    break;
                case PathOperator.Type.ROOT:
                    break;
                default:
                    throw new Error();
            }
        }
        this.dispatch((dispatcher) => {
            dispatcher.onValue(value);
            return false;
        });
    }

    private match(value?: any): void {
        const currentDepth = this.position.pathDepth();
        if (this.path.definite || this.path.minimumDepth <= currentDepth) {
            if (this.path.match(this.position)) {
                if (value !== undefined) {
                    this.listener(value);
                } else {
                    this.dispatchers.push(new JsonDispatcher(this.listener,
                        this.path.projectExpression,
                        this.path.projectKeys));
                }
            }
        }
    }

    private isInRoot(): boolean {
        return this.position === undefined ||
            this.position.isInRoot();
    }

    private dispatch(visitor: (dispatcher: JsonDispatcher) => boolean): void {
        this.dispatchers = this.dispatchers.filter((d) => !visitor(d));
    }
}
