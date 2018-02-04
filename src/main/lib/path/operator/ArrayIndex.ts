import { PathOperator } from '../PathOperator';

export class ArrayIndex extends PathOperator {

    getType(): PathOperator.Type {
        return PathOperator.Type.ARRAY;
    }

    match(pathOperator: PathOperator): boolean {
        return true;
    }
}
