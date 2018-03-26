import { ANTLRInputStream, CommonTokenStream } from 'antlr4ts';
import { AbstractParseTreeVisitor } from 'antlr4ts/tree';
import { Stack } from '../utils/Stack';
import { ChildNode } from './operator/ChildNode';
import { Descendant } from './operator/Descendant';
import { Root } from './operator/Root';
import { Wildcard } from './operator/Wildcard';
import { buildArgsExpression, extractKeys } from './parser/utils';
import { YAJSLexer } from './parser/YAJSLexer';
import { ActionProjectContext, PathStepContext, YAJSParser } from './parser/YAJSParser';
import { PathOperator } from './PathOperator';
import { PathParent } from './PathParent';

export class YAJSPath {

    private mProjectExpr: string;
    private mProjectKeys: string[];

    private mDefinite = true;
    private mMinimumDepth = 0;

    private mStack = new Stack<PathOperator>();

    constructor(operators: PathOperator[] = [], projectExpression: string = '', projectKeys: string[] = []) {
        this.mProjectExpr = projectExpression;
        this.mProjectKeys = projectKeys;

        [ new Root() ].concat(operators).
            forEach((op) => this.push(op));

        if (this.peek().getType() === PathOperator.Type.DESCENDANT) {
            throw new Error('Descendant shouldn\'t be the last operator.');
        }

        this.stack.forEach((operator) => {
            if (operator.getType() !== PathOperator.Type.DESCENDANT) {
                this.mMinimumDepth++;
            } else {
                this.mDefinite = false;
            }
        });
    }

    protected get size(): number {
        return this.mStack.size;
    }

    protected set size(size: number) {
        this.mStack.size = size;
    }

    protected set top(operator: PathOperator) {
        this.mStack.top = operator;
    }
    protected get stack(): PathOperator[] {
        return this.mStack.stack;
    }

    peek(): PathOperator {
        return this.mStack.peek();
    }

    push(operator: PathOperator): void {
        if (this.size) {
            operator.parent = new PathParent(this.peek());
        }
        this.mStack.push(operator);
    }

    pop(): void {
        this.mStack.pop();
    }

    previousPeek(): PathOperator {
        return this.mStack.previousPeek();
    }

    hasPreviousPeek(): boolean {
        return this.mStack.hasPreviousPeek();
    }

    match(jsonPath: YAJSPath): boolean {
        let pointer1 = this.size - 1;
        let pointer2 = jsonPath.size - 1;

        if (!this.stack[pointer1].match(jsonPath.stack[pointer2])) {
            return false;
        }

        while (pointer1 >= 0) {
            if (pointer2 < 0) {
                return false;
            }

            const o1 = this.stack[pointer1--];
            const o1Type = o1.getType();
            let o2 = jsonPath.stack[pointer2--];

            if (o1Type === PathOperator.Type.DESCENDANT) {
                const prevScan = this.stack[pointer1--];
                while (!prevScan.match(o2) && pointer2 >= 0) {
                    o2 = jsonPath.stack[pointer2--];
                }
            } else if (o2.getType() === PathOperator.Type.ARRAY) {
                pointer1++;
            } else if (!o1.match(o2)) {
                return false;
            }
        }

        return pointer2 < 0;
    }

    pathDepth(): number {
        return this.size;
    }

    path(): string[] {
        const result = [];
        for (let i = 0; i < this.size; i++) {
            const op: any = this.stack[i];
            if (op.key) {
                result.push(op.key);
            }
        }
        return result;
    }

    get definite(): boolean {
        return this.mDefinite;
    }

    get minimumDepth(): number {
        return this.mDefinite ?
            this.size :
            this.mMinimumDepth;
    }

    get projectExpression(): string {
        return this.mProjectExpr;
    }

    get projectKeys(): string[] {
        return this.mProjectKeys;
    }
}

export namespace YAJSPath {

    // tslint:disable-next-line:max-classes-per-file
    export class Builder {

        private operators: PathOperator[] = [];

        private projectExpression: string;
        private projectKeys: string[];

        addChild(key: string, filterExpression?: string, filterKeys?: string[]): Builder {
            this.operators.push(new ChildNode(key, filterExpression, filterKeys));
            return this;
        }

        addWildcard(filterExpression?: string, filterKeys?: string[]): Builder {
            this.operators.push(new Wildcard(filterExpression, filterKeys));
            return this;
        }

        addDescendant(): Builder {
            const last = this.operators[this.operators.length - 1];
            if (!last || last.getType() !== PathOperator.Type.DESCENDANT) {
                this.operators.push(new Descendant());
            }
            return this;
        }

        setProjection(projectExpression: string, projectKeys: string[]): Builder {
            this.projectExpression = projectExpression;
            this.projectKeys = projectKeys;
            return this;
        }

        build(): YAJSPath {
            const operators = this.operators;
            this.operators = [];
            return new YAJSPath(operators, this.projectExpression, this.projectKeys);
        }
    }

    export function parse(path: string): YAJSPath {

        const inputStream = new ANTLRInputStream(path);
        const lexer = new YAJSLexer(inputStream);
        const tokenStream = new CommonTokenStream(lexer);
        const parser = new YAJSParser(tokenStream);

        return new Visitor().
            visit(parser.path()).
            build();
    }

    // tslint:disable-next-line:max-classes-per-file
    class Visitor extends AbstractParseTreeVisitor<YAJSPath.Builder> {

        private readonly builder = new YAJSPath.Builder();

        visitPathStep(ctx: PathStepContext): YAJSPath.Builder {
            if (ctx.DOT().length === 2) {
                this.builder.addDescendant();
            }

            const fieldName = ctx.actionField()._key.text;
            if (!fieldName) {
                throw new Error('Unexpected empty fieldname');
            }

            const actionFilter = ctx.actionFilter();
            let filterExpression;
            let filterKeys;

            if (actionFilter) {
                filterExpression = buildArgsExpression(actionFilter.filterExpression());
                filterKeys = extractKeys(actionFilter.filterExpression());
            }

            if ('*' === fieldName) {
                this.builder.addWildcard(filterExpression, filterKeys);
            } else {
                this.builder.addChild(fieldName, filterExpression, filterKeys);
            }

            return this.builder;
        }

        visitActionProject(ctx: ActionProjectContext): YAJSPath.Builder {
            this.builder.setProjection(
                buildArgsExpression(ctx.filterExpression()),
                extractKeys(ctx.filterExpression()));
            return this.builder;
        }

        protected defaultResult(): YAJSPath.Builder {
            return this.builder;
        }
    }
}
