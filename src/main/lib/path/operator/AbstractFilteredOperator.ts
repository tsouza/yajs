import { ScriptFilterHelper } from '../../utils/ScriptFilterHelper';
import { PathOperator } from '../PathOperator';

export abstract class AbstractFilteredOperator extends PathOperator {

    protected filterHelper: ScriptFilterHelper;
    private script?: any;

    constructor(filterExpression?: string, filterKeys?: string[]) {
        super();
        this.filterHelper = new ScriptFilterHelper(filterKeys, filterExpression);
    }

    protected matchFilter(operator: PathOperator): boolean {
        if (!this.filterHelper.isFiltered()) {
            throw new Error('Filter not defined');
        }

        return this.filterHelper.
            filters((key) => operator.referencedBy(key));
    }
}
