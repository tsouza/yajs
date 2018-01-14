import { isEmpty } from 'lodash';
import { createContext, runInContext } from 'vm';

const context = createContext();

export class ScriptFilterHelper {

    private expression?: string;
    private keys: string[];

    private filter?: (args: object) => boolean;

    constructor(keys: string[], expression?: string) {
        if (expression) {
            this.filter = this.isBooleanExpression(expression) ?
                runInContext(`(args) => ${expression}`, context) :
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
