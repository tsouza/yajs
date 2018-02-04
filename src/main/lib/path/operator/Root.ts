import { PathOperator } from '../PathOperator';

export class Root extends PathOperator {

    getType(): PathOperator.Type {
        return PathOperator.Type.ROOT;
    }
}
