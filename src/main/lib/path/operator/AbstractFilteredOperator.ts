import { ScriptFilterHelper } from '../../utils/ScriptFilterHelper';
import { PathOperator } from '../PathOperator';

export abstract class AbstractFilteredOperator extends PathOperator {

    protected filterHelper: ScriptFilterHelper;

    private matchFilterDelegate: (matches: boolean, operator: PathOperator) => boolean;

    constructor(filterExpression?: string, filterKeys?: string[]) {
        super();
        this.filterHelper = new ScriptFilterHelper(filterKeys, filterExpression);
        this.matchFilterDelegate = this.filterHelper.isFiltered() ?
            (matches: boolean, operator: PathOperator) => matches && this.filterHelper.
                filters((key) => operator.referencedBy(key)) :
            (matches: boolean, _operator: PathOperator) => matches;
    }

    protected matchFilter(matches: boolean, operator: PathOperator): boolean {
        return this.matchFilterDelegate(matches, operator);
    }

    // Whether this operator actually carries an attached [filter] that
    // match() will evaluate - defined as exactly the same
    // filterHelper.isFiltered() test the constructor uses to pick
    // matchFilterDelegate, so "filtered here" and "match() enforces a
    // filter" can never disagree. Callers that would otherwise treat this
    // operator's match() as unconditional/key-only (the descendant-collapse
    // and ancestor-cache shortcuts in YAJSPath/StreamPosition) must check
    // this first.
    get filtered(): boolean {
        return this.filterHelper.isFiltered();
    }
}
