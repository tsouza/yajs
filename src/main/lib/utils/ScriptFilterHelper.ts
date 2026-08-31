import { isEmpty } from 'lodash';
import { createContext, runInContext } from 'vm';

const context = createContext();

export class ScriptFilterHelper {

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
        // Use a null-prototype object so that a key named "__proto__" becomes a
        // real own property instead of being routed through Object.prototype's
        // inherited __proto__ setter, which would otherwise silently mutate this
        // object's prototype chain instead of storing the key's verification
        // result (and cause a bracket-notation read of args['__proto__'] to
        // always return a truthy prototype object regardless of keyVerifier).
        const args = Object.create(null);
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
