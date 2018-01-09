import { VM } from 'vm2';
import { PathOperator } from '../PathOperator';

export abstract class AbstractFilteredOperator extends PathOperator {

    protected filterExpression?: string;
    private filterKeys?: string[];

    constructor(filterExpression?: string, filterKeys?: string[]) {
        super();
        this.filterExpression = filterExpression;
        this.filterKeys = filterKeys;
    }

    protected matchFilter(operator: PathOperator): boolean {
        if (!this.filterExpression) {
            throw new Error('Filter not defined');
        }

        const sandbox = this._createSandbox(operator);
        const filter = this._createFilterScript(sandbox);

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

    private _createFilterScript(sandbox: any) {
        return new VM({ sandbox }).
            run(`() => ${this.filterExpression}`);
    }
}
