import { PathOperator } from '../PathOperator';

export class Descendant extends PathOperator {

    match(operator: PathOperator): boolean {
        return true;
    }

    getType(): PathOperator.Type {
        return PathOperator.Type.DESCENDANT;
    }

    toString(): string {
        return '..';
    }
}
