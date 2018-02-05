import { ChildNode } from './operator/ChildNode';
import { PathOperator } from './PathOperator';

export class PathParent {

    private operator: PathOperator;

    constructor(operator: PathOperator) {
        this.operator = operator;
    }

    contains(key: string): boolean | undefined {
        return (this.operator.getType() === PathOperator.Type.OBJECT &&
                (this.operator as ChildNode).key === key) ||
            this.operator && this.operator.referencedBy(key);
    }
}
