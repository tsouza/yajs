import { ANTLRErrorListener, ANTLRInputStream, CommonTokenStream, RecognitionException, Recognizer } from 'antlr4ts';
import { AbstractParseTreeVisitor } from 'antlr4ts/tree';
import { Stack } from '../utils/Stack';
import { ChildNode } from './operator/ChildNode';
import { Descendant } from './operator/Descendant';
import { Root } from './operator/Root';
import { Wildcard } from './operator/Wildcard';
import { assertFlatKeyExpression, buildArgsExpression, extractKeys } from './parser/utils';
import { YAJSLexer } from './parser/YAJSLexer';
import { ActionDropKeysContext, ActionProjectContext,
    PathStepContext, YAJSParser } from './parser/YAJSParser';
import { PathOperator } from './PathOperator';
import { PathParent } from './PathParent';

export class YAJSPath {

    private mProjectExpr: string;
    private mProjectKeys: string[];
    private mDropKeys: string[];

    private mDefinite = true;
    private mMinimumDepth = 0;

    private mStack = new Stack<PathOperator>();

    constructor(operators: PathOperator[] = [], projectExpression: string = '', projectKeys: string[] = [],
                dropKeys: string[] = []) {
        this.mProjectExpr = projectExpression;
        this.mProjectKeys = projectKeys;
        this.mDropKeys = dropKeys;

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

        const lastPattern = this.stack[pointer1];
        const lastPosition = jsonPath.stack[pointer2];
        // An array is a transparent pass-through for its parent key/root
        // here specifically - i.e. only for '$' itself (the sole case where
        // Root can be the pattern's own last/only operator) reaching an
        // array's immediate elements, mirroring the transparency ChildNode
        // already has via its own match()/matches(). This is deliberately
        // NOT done by overriding Root.match() itself: Root.match() is also
        // used, polymorphically, by the '..' scan below as a *strict*
        // "have we scanned all the way back to the true document root"
        // check, and giving it array-transparency there would let a '..'
        // scan stop early at an unrelated *intermediate* array it merely
        // passes through, rather than continuing back to the real root.
        const rootThroughArray = lastPattern.getType() === PathOperator.Type.ROOT &&
            lastPosition.getType() === PathOperator.Type.ARRAY;
        if (!rootThroughArray && !lastPattern.match(lastPosition)) {
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
                // An intervening ARRAY position must always be treated as
                // transparent scaffolding for this backward "how far back
                // does '..' need to reach" scan - it can never itself be
                // the ancestor prevScan is looking for, no matter what
                // prevScan is. ChildNode.match()/Wildcard.match() both
                // return true unconditionally against an ARRAY-typed
                // operand (see their own match()/matches()), which is
                // correct for the single-hop "array is transparent for its
                // parent key" transparency used elsewhere in this method,
                // but WRONG here: it used to let the scan stop at the
                // first array it met, even when the real key prevScan is
                // looking for lies further back, past that array (a false
                // negative - issue #27's `$.a..b` repro), or let it stop
                // and accept an ancestor that doesn't actually establish
                // what the scan is looking for, letting an unrelated array
                // masquerade as a match for a key that's never actually
                // present anywhere (a false positive - issue #27's
                // `$..x..y` repro). Skipping every ARRAY level here,
                // unconditionally, and only ever testing prevScan.match()
                // against a real (non-ARRAY) ancestor position fixes both:
                // the scan keeps walking back through as many arrays as
                // necessary until it either finds a genuine match or runs
                // out of position stack.
                while (pointer2 >= 0 && (o2.getType() === PathOperator.Type.ARRAY || !prevScan.match(o2))) {
                    o2 = jsonPath.stack[pointer2--];
                }
            } else if (o2.getType() === PathOperator.Type.ARRAY) {
                // A matched array is transparent for its parent key/root, so
                // this array level doesn't consume a pattern operator - but
                // only ONE level: a matched array streams its immediate
                // elements one at a time rather than being flattened
                // (issue #14), so a SECOND consecutive array right beneath
                // it belongs to one of those elements' own subtree, not to
                // this key's path, and must not also be skipped transparently.
                if (pointer2 >= 0 && jsonPath.stack[pointer2].getType() === PathOperator.Type.ARRAY) {
                    return false;
                }
                // Retrying the SAME pattern operator (o1) against whatever
                // lies beneath the array is how Root and ChildNode reach
                // their real, still-pending comparison: Root.match() is
                // deliberately strict (see the comment above) so it must
                // retry to find the genuine Root beneath; ChildNode.match()
                // treats an immediate Array as a provisional pass (see
                // ChildNode.matches()) pending the real key check beneath.
                // Wildcard is different: its match() is UNCONDITIONALLY
                // true (issue #20) - matching this array already IS its
                // final, fully-resolved verdict, with no more specific
                // check deferred to beneath it. Retrying it anyway would
                // let that unconditional "true" also silently swallow
                // whatever position level sits just beneath the array -
                // most critically the document's own Root, which the
                // pattern's OWN trailing Root operator still separately
                // needs to pair against (that pairing is what a bare '$'
                // relies on to close out the match one iteration later) -
                // e.g. for '$.*' against a bare top-level array ([1,2,3]),
                // retrying Wildcard would have it also "match" Root,
                // leaving pattern's Root with nothing left in the position
                // stack to pair against and the whole match falsely failing.
                if (o1Type !== PathOperator.Type.WILDCARD) {
                    pointer1++;
                }
            } else if (o1Type === PathOperator.Type.WILDCARD &&
                pointer2 >= 0 && jsonPath.stack[pointer2].getType() === PathOperator.Type.ARRAY &&
                pointer1 >= 0 && this.stack[pointer1].getType() !== PathOperator.Type.WILDCARD &&
                this.stack[pointer1].getType() !== PathOperator.Type.DESCENDANT) {
                // o2 here is NOT itself ARRAY-typed (that's the branch
                // above), so this Wildcard is being asked to directly match
                // some ordinary object-key position. Wildcard.match() is
                // unconditionally true regardless of its operand (issue
                // #20), so - unlike ChildNode, which can reject a wrong key
                // via matches() - Wildcard itself has no way to notice when
                // o2 is actually nested ONE level INSIDE an array (i.e. o2
                // is a property of one of the array's elements) rather than
                // being a direct child of whatever precedes this Wildcard in
                // the pattern. That distinction is only visible here, one
                // level up the position stack: if what's immediately above
                // o2 is itself an ARRAY, then o2 belongs to one of that
                // array's elements, and matching it here would let '$.*'
                // silently reach past the array's elements into their own
                // properties (issue #28) - spurious extra matches at best,
                // and at worst a second concurrent match on the same
                // object's subtree racing/corrupting the real element match
                // (issue #28's `{"x":{"deep":1}}` repro).
                //
                // BUT this must only reject when the pattern operator that
                // will next take responsibility for that array (this.stack
                // at the now-decremented pointer1 - i.e. whatever precedes
                // this Wildcard in the pattern) is Root or ChildNode: those
                // only ever expect to consume exactly one array this way
                // (their own direct parent array, per the branch above), so
                // an array showing up one level further in than that is a
                // genuine overshoot. A WILDCARD or DESCENDANT immediately
                // preceding this one, by contrast, is *designed* to tolerate
                // exactly this - a run of consecutive Wildcards each resolve
                // one hop at a time down to the array (e.g. '$.*.*' reaching
                // a property inside an array's element, where the first
                // Wildcard is what will legitimately consume the array on
                // the very next iteration), and Descendant explicitly allows
                // unbounded intervening depth by design (e.g. '$..*' must
                // still reach a property nested inside an array's element,
                // not just the array's own elements - the Descendant's own
                // backward scan above is what actually re-validates the
                // full ancestor chain, including that array). Rejecting
                // those too would silently drop real matches instead of
                // just excess ones.
                return false;
            } else if (!o1.match(o2)) {
                return false;
            }
        }

        return pointer2 < 0;
    }

    pathDepth(): number {
        return this.size;
    }

    path(includeArrayIndex): string[] {
        const result = [];
        for (let i = 0; i < this.size; i++) {
            const op: any = this.stack[i];
            if (op.key) {
                result.push(op.key);
            } else if (includeArrayIndex && 'index' in op) {
                result.push(op.index);
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

    get dropKeys(): string[] {
        return this.mDropKeys;
    }
}

export namespace YAJSPath {

    // tslint:disable-next-line:max-classes-per-file
    export class Builder {

        private operators: PathOperator[] = [];

        private projectExpression: string;
        private projectKeys: string[];
        private dropKeys: string[];

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

        setDropKeys(dropKeys: string[]) {
            this.dropKeys = dropKeys;
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
            return new YAJSPath(operators, this.projectExpression, this.projectKeys, this.dropKeys);
        }
    }

    export function parse(path: string): YAJSPath {

        const inputStream = new ANTLRInputStream(path);
        const lexer = new YAJSLexer(inputStream);
        lexer.removeErrorListeners();
        lexer.addErrorListener(new ThrowingErrorListener());
        const tokenStream = new CommonTokenStream(lexer);
        const parser = new YAJSParser(tokenStream);
        parser.removeErrorListeners();
        parser.addErrorListener(new ThrowingErrorListener());

        return new Visitor().
            visit(parser.path()).
            build();
    }

    // ANTLR's default ConsoleErrorListener only logs a syntax error to
    // stderr - it does not stop parsing or throw, so ANTLR's own
    // best-effort error recovery takes over and can produce a badly wrong
    // (or, for some inputs, visitor-crashing) parse tree instead of a
    // clean, catchable failure (issue #18). Replacing the default listener
    // with one that throws makes parse() fail fast and predictably on the
    // FIRST syntax error, for both the lexer and the parser.
    // tslint:disable-next-line:max-classes-per-file
    class ThrowingErrorListener implements ANTLRErrorListener<any> {
        syntaxError<T>(_recognizer: Recognizer<T, any>, _offendingSymbol: T, line: number,
                        charPositionInLine: number, msg: string, _e: RecognitionException): void {
            throw new Error(`Invalid selector syntax at line ${line}:${charPositionInLine}: ${msg}`);
        }
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

        visitActionDropKeys(ctx: ActionDropKeysContext): YAJSPath.Builder {
            assertFlatKeyExpression(ctx.filterExpression());
            this.builder.setDropKeys(extractKeys(ctx.filterExpression()));
            return this.builder;
        }

        protected defaultResult(): YAJSPath.Builder {
            return this.builder;
        }
    }
}
