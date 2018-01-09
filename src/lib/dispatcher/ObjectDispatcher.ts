import { isEmpty, pick } from 'lodash';
import { VM } from 'vm2';
import { AbstractObjectBuilder } from './AbstractObjectBuilder';

export class JsonDispatcher extends AbstractObjectBuilder {

    private listener?: (value?: any) => void;
    private projectExpression: string;
    private projectKeys: string[];

    constructor(listener: (value?: any) => void, projectExpression: string = '', projectKeys: string[] = []) {
        super();
        this.listener = listener;
        this.projectExpression = projectExpression;
        this.projectKeys = projectKeys;
    }

    endObject(): boolean {
        this.doEndObject();
        if (this.isInRoot()) {
            const result: any = this.peek().value;
            if (this.listener) {
                if (!isEmpty(this.projectExpression)) {
                    const sandbox = this._createSandbox(result);
                    const filter = this._createFilterScript(sandbox);
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

    private _createFilterScript(sandbox: object): () => boolean {
        return new VM({ sandbox }).
            run(`() => ${this.projectExpression}`);
    }
}
