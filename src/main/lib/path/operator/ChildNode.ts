import { PathOperator } from '../PathOperator';
import { AbstractFilteredOperator } from './AbstractFilteredOperator';

export class ChildNode extends AbstractFilteredOperator {

    key?: string;

    constructor(key?: string, filterExpression?: string, filterKeys?: string[]) {
        super(filterExpression, filterKeys);
        this.key = key;
    }

    match(operator: PathOperator): boolean {
        if (operator.getType() === PathOperator.Type.ARRAY) {
            return true;
        }
        const matched = super.match(operator) && this.key === (operator as ChildNode).key;
        if (matched && this.filterHelper.isFiltered()) {
            return this.matchFilter(operator);
        }
        return matched;
    }

    getType(): PathOperator.Type {
        return PathOperator.Type.OBJECT;
    }

    toString(): string {
        return `.${this.key}`;
    }
}
