import { isEmpty } from 'lodash';
import { ObjectDispatcher } from '../dispatcher/ObjectDispatcher';
import { PathOperator } from '../path/PathOperator';
import { YAJSPath } from '../path/YAJSPath';
import { StreamPosition } from './StreamPosition';

export class StreamContext {

    private position: StreamPosition;
    private readonly path: YAJSPath;

    private dispatchers: ObjectDispatcher[] = [];
    private dispatcher: ObjectDispatcher;

    private readonly onMatchListener: (value?: any) => void;
    private readonly onValueListener: (value: any) => any;

    constructor(path: YAJSPath, onMatch: (path: string[], value?: any) => void) {
        this.path = path;

        this.onMatchListener = (value?: any) =>
            onMatch(this.position.path(), value);

        this.onValueListener = isEmpty(path.projectExpression) ?
            (value) => this.doOnValue(value) : (value) => value;
    }

    reset(): void {
        this.position = new StreamPosition();
        this.match();
    }

    startObject(): void {
        if (this.isInRoot()) {
            this.reset();
        }
        this.doOnValue();
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
        this.onValueListener(value);
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

                    if (this.dispatchers.length) {
                        this.dispatchers.push(dispatcher);
                    } else if (this.dispatcher) {
                        this.dispatchers.push(this.dispatcher);
                        this.dispatchers.push(dispatcher);
                        this.dispatcher = null;
                    } else {
                        this.dispatcher = dispatcher;
                    }
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

    private dispatch(visitor: (dispatcher: ObjectDispatcher) => boolean): void {
        if (this.dispatcher && visitor(this.dispatcher)) {
            this.dispatcher = null;
        } else {
            const dispatchers = this.dispatchers;
            for (let i = dispatchers.length - 1; i >= 0; i--) {
                const d = dispatchers[i];
                if (visitor(d)) {
                    dispatchers.splice(i);
                }
            }
        }
    }
}
