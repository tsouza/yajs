import { VM, VMScript } from 'vm2';
import { PathOperator } from '../PathOperator';

export abstract class AbstractFilteredOperator extends PathOperator {

    protected filterKeys?: string[];
    private script?: any;

    constructor(filterExpression?: string, filterKeys?: string[]) {
        super();
        if (filterExpression) {
            this.script = this.isBooleanExpression(filterExpression) ?
                new VMScript(`() => ${filterExpression}`, '') :
                null;
            this.filterKeys = filterKeys;
        }
    }

    protected matchFilter(operator: PathOperator): boolean {
        if (!this.filterKeys) {
            throw new Error('Filter not defined');
        }

        const filter = this._createFilter(operator);

        return filter();
    }

    private _createSandbox(operator: PathOperator): any {
        const result: any = {};
        if (this.filterKeys) {
            this.filterKeys.forEach((key) =>
                result[key] = operator.referencedBy(key));
        }
        return result;
    }

    private _createFilter(operator: PathOperator): () => boolean {
        if (this.script) {
            const sandbox = this._createSandbox(operator);
            return new VM({ sandbox }).
                run(this.script);
        } else {
            return () => this.filterKeys.
                every((key) => operator.referencedBy(key));
        }
    }

    private isBooleanExpression(expr: string): boolean {
        return /[a-zA-Z0-9\s]+/.exec(expr) === null;
    }
}
