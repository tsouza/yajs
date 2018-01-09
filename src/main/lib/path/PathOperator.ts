import { PathParent } from './PathParent';

export abstract class PathOperator {

    parent?: PathParent;

    abstract getType(): PathOperator.Type;

    match(pathOperator: PathOperator): boolean {
        return this.getType() === pathOperator.getType();
    }

    referencedBy(key: string): boolean | undefined {
        return this.parent && this.parent.contains(key);
    }
}

export namespace PathOperator {
    export enum Type {
        ROOT,
        OBJECT,
        ARRAY,
        WILDCARD,
        DESCENDANT,
    }
}
