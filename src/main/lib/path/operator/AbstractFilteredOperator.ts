import { ScriptFilterHelper } from '../../utils/ScriptFilterHelper';
import { PathOperator } from '../PathOperator';

export abstract class AbstractFilteredOperator extends PathOperator {

    protected filterHelper: ScriptFilterHelper;

    private matchFilterDelegate: (matches: boolean, operator: PathOperator) => boolean;

    constructor(filterExpression?: string, filterKeys?: string[]) {
        super();
        this.filterHelper = new ScriptFilterHelper(filterKeys, filterExpression);
        this.matchFilterDelegate = this.filterHelper.isFiltered() ?
            (_matches: boolean, operator: PathOperator) => this.filterHelper.
                filters((key) => operator.referencedBy(key)) :
            (matches: boolean, _operator: PathOperator) => matches;
    }

    protected matchFilter(matches: boolean, operator: PathOperator): boolean {
        return this.matchFilterDelegate(matches, operator);
    }
}
