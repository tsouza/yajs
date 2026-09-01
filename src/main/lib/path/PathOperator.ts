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

    // Issue #96: companion to referencedBy() above, collecting every key
    // name traversed along the ancestor chain instead of testing a single
    // one - the set the regex filter primitive tests its pattern against
    // (see AbstractFilteredOperator's use of this).
    collectAncestorKeys(into: string[]): void {
        if (this.parent) {
            this.parent.collectKeys(into);
        }
    }

    onValue(delegateOnMatch: () => void): void {
        delegateOnMatch();
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
