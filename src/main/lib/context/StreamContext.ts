import { isEmpty } from 'lodash';
import { ObjectDispatcher } from '../dispatcher/ObjectDispatcher';
import { PathOperator } from '../path/PathOperator';
import { YAJSPath } from '../path/YAJSPath';
import { StreamPosition } from './StreamPosition';

export class StreamContext {

    private position: StreamPosition;
    private path: YAJSPath;
    private listener: (value?: any) => void;

    private dispatcher: ObjectDispatcher;

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
        const currentNode = this.position.peek();
        if (currentNode.getType() !== PathOperator.Type.ROOT) {
            this.match();
        }
        this.position.stepIntoObject();
        this.dispatch((dispatcher) => {
            dispatcher.startObject();
            return false;
        });
    }

    endObject(): void {
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
       this.position.stepIntoArray();
       this.dispatch((dispatcher) => {
            dispatcher.startArray();
            return false;
        });
    }

    endArray(): void {
        this.position.stepOutArray();
        this.dispatch((dispatcher) => dispatcher.endArray());
    }

    onValue(value: any): void {
        if (isEmpty(this.path.projectExpression)) {
            const currentNode = this.position.peek();
            if (currentNode.getType() !== PathOperator.Type.ROOT) {
                this.match(value);
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
                    this.dispatcher = new ObjectDispatcher(this.listener,
                        this.path.projectExpression,
                        this.path.projectKeys);
                    /*this.dispatchers.push(new ObjectDispatcher(this.listener,
                        this.path.projectExpression,
                        this.path.projectKeys));*/
                }
            }
        }
    }

    private isInRoot(): boolean {
        return this.position === undefined ||
            this.position.isInRoot();
    }

    private dispatch(visitor: (dispatcher: ObjectDispatcher) => boolean): void {
        if (this.dispatcher && visitor(this.dispatcher)) {
            this.dispatcher = null;
        }
    }
}
