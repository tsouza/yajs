import { isEmpty, pick } from 'lodash';
import { VM, VMScript } from 'vm2';
import { AbstractObjectBuilder } from './AbstractObjectBuilder';

export class JsonDispatcher extends AbstractObjectBuilder {

    private listener?: (value?: any) => void;

    private script?: any;
    private projectKeys: string[];

    constructor(listener: (value?: any) => void, projectExpression: string = '', projectKeys: string[] = []) {
        super();
        this.listener = listener;
        if (projectExpression) {
            this.script = this.isBooleanExpression(projectExpression) ?
                new VMScript(`() => ${projectExpression}`, '') :
                null;
            this.projectKeys = projectKeys;
        }
    }

    endObject(): boolean {
        this.doEndObject();
        if (this.isInRoot()) {
            const result: any = this.peek().value;
            if (this.listener) {
                if (!isEmpty(this.projectKeys)) {
                    const filter = this._createFilter(result);
                    if (filter()) {
                        this.listener(result);
                    }
                } else {
                    this.listener(result);
                }
            }
            this.clear();
            return true;
        }
        return false;
    }

    endArray(): boolean {
        this.doEndArray();
        if (this.isInRoot()) {
            /*let result: any = this.peek().value;
            if (this.listener)
                this.listener(result);*/
            this.clear();
            return true;
        }
        return false;
    }

    clear(): void {
        super.clear();
        this.listener = undefined;
    }

    private _createSandbox(object: object): object {
        const result = {};
        this.projectKeys.forEach((k) => result[k] = k in object);
        return result;
    }

    private _createFilter(result: object): () => boolean {
        if (this.script) {
            const sandbox = this._createSandbox(result);
            return new VM({ sandbox }).
                run(this.script);
        } else {
            return () => this.projectKeys.
                every((key) => key in result);
        }
    }

    private isBooleanExpression(expr: string): boolean {
        return /[a-zA-Z0-9\s]+/.exec(expr) === null;
    }
}
