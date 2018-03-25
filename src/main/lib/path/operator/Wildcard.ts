import { PathOperator } from '../PathOperator';
import { AbstractFilteredOperator } from './AbstractFilteredOperator';

export class Wildcard extends AbstractFilteredOperator {

    constructor(filterExpression?: string, filterKeys?: string[]) {
        super(filterExpression, filterKeys);
    }

    match(operator: PathOperator): boolean {
        return this.matchFilter(true, operator);
    }

    getType(): PathOperator.Type {
        return PathOperator.Type.WILDCARD;
    }
}
