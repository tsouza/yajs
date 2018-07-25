import { PathOperator } from '../PathOperator';
import { AbstractFilteredOperator } from './AbstractFilteredOperator';

export class ChildNode extends AbstractFilteredOperator {

    key?: string;

    constructor(key?: string, filterExpression?: string, filterKeys?: string[]) {
        super(filterExpression, filterKeys);
        this.key = key;
    }

    match(operator: PathOperator): boolean {
        return this.matchFilter(this.matches(operator), operator);
    }

    getType(): PathOperator.Type {
        return PathOperator.Type.OBJECT;
    }

    toString(): string {
        return `.${this.key}`;
    }

    private matches(operator: PathOperator): boolean {
        return (operator.getType() === PathOperator.Type.ARRAY ||
            this.key === (operator as any).key);
    }
}
