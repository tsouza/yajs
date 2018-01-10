import { PathOperator } from '../PathOperator';
import { AbstractFilteredOperator } from './AbstractFilteredOperator';

export class Wildcard extends AbstractFilteredOperator {

    constructor(filterExpression?: string, filterKeys?: string[]) {
        super(filterExpression, filterKeys);
    }

    match(operator: PathOperator): boolean {
        if (this.filterKeys) {
            return this.matchFilter(operator);
        }
        return true;
    }

    getType(): PathOperator.Type {
        return PathOperator.Type.WILDCARD;
    }

    toString(): string {
        return '*';
    }
}
