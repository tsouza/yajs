import { PathOperator } from '../PathOperator';

export class Root extends PathOperator {

    getType(): PathOperator.Type {
        return PathOperator.Type.ROOT;
    }

    // tslint:disable-next-line:no-empty
    onValue(delegateOnMatch: () => void): void {
    }
}
