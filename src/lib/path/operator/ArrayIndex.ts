import { PathOperator } from '../PathOperator';

export class ArrayIndex extends PathOperator {

    arrayIndex = -1;

    constructor(arrayIndex?: number) {
        super();
        if (arrayIndex !== undefined) {
            this.arrayIndex = arrayIndex;
        }
    }

    getType(): PathOperator.Type {
        return PathOperator.Type.ARRAY;
    }

    reset(): void {
        this.arrayIndex = -1;
    }

    match(pathOperator: PathOperator): boolean {
        return true;
    }

    toString(): string {
        return `[${this.arrayIndex}]`;
    }
}
