import { isEmpty } from 'lodash';
import { VM, VMScript } from 'vm2';

const vm = new VM();

export class ScriptFilterHelper {

    private expression?: string;
    private keys: string[];

    private filter?: (args: object) => boolean;

    constructor(keys: string[], expression?: string) {
        if (expression) {
            this.filter = this.isBooleanExpression(expression) ?
                vm.run(`(args) => ${expression}`) :
                null;
            this.keys = keys;
        }
    }

    isFiltered(): boolean {
        return !isEmpty(this.keys);
    }

    filters(keyVerifier: (key) => boolean): boolean {
        const args = this.filter ? this._createArgs(keyVerifier) : null;
        return this._createFilter(keyVerifier)(args);
    }

    private _createArgs(keyVerifier: (key) => boolean): object {
        const args = {};
        if (this.keys) {
            this.keys.forEach((key) =>
                args[key] = keyVerifier(key));
        }
        return args;
    }

    private _createFilter(keyVerifier: (key) => boolean): (args: object) => boolean {
        if (this.filter) {
           return this.filter;
        } else {
            return () => this.keys.
                some((key) => keyVerifier(key));
        }
    }

    private isBooleanExpression(expr: string): boolean {
        return !expr.match(/^[_a-z0-9\s]+$/g);
    }
}
