import { isEmpty } from 'lodash';
import { VM, VMScript } from 'vm2';

export class ScriptFilterHelper {

    private expression?: string;
    private keys: string[];

    private script?: VMScript;

    constructor(keys: string[], expression?: string) {
        if (expression) {
            this.script = this.isBooleanExpression(expression) ?
                new VMScript(`() => ${expression}`, '') :
                null;
            this.keys = keys;
        }
    }

    isFiltered(): boolean {
        return !isEmpty(this.keys);
    }

    filters(keyVerifier: (key) => boolean): boolean {
        return this._createFilter(keyVerifier)();
    }

    private _createSandbox(keyVerifier: (key) => boolean): object {
        const sandbox = {};
        if (this.keys) {
            this.keys.forEach((key) =>
                sandbox[key] = keyVerifier(key));
        }
        return sandbox;
    }

    private _createFilter(keyVerifier: (key) => boolean): () => boolean {
        if (this.script) {
            const sandbox = this._createSandbox(keyVerifier);
            return new VM({ sandbox }).
                run(this.script);
        } else {
            return () => this.keys.
                some((key) => keyVerifier(key));
        }
    }

    private isBooleanExpression(expr: string): boolean {
        return !expr.match(/^[_a-z0-9\s]+$/g);
    }
}
