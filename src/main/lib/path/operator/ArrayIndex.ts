import { PathOperator } from '../PathOperator';

export class ArrayIndex extends PathOperator {

    index: number;

    constructor() {
        super();
        this.index = -1;
    }

    getType(): PathOperator.Type {
        return PathOperator.Type.ARRAY;
    }

    match(pathOperator: PathOperator): boolean {
        return true;
    }
}
