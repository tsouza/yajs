import { PathOperator } from './PathOperator';

export class PathParent {

    private operator: PathOperator;

    constructor(operator: PathOperator) {
        this.operator = operator;
    }

    contains(key: string): boolean | undefined {
        return ((this.operator as any).key === key) ||
            this.operator && this.operator.referencedBy(key);
    }

    // Issue #96: the regex filter primitive's existential match needs the
    // WHOLE set of keys traversed along the descent path (to test the
    // pattern against each one), not a single membership test - so this is
    // contains()'s own recursive walk, collecting instead of comparing
    // against one target key.
    collectKeys(into: string[]): void {
        const key = (this.operator as any).key;
        if (typeof key === 'string') {
            into.push(key);
        }
        if (this.operator) {
            this.operator.collectAncestorKeys(into);
        }
    }
}
