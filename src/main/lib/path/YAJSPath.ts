import { ANTLRErrorListener, ANTLRInputStream, CommonTokenStream, RecognitionException, Recognizer } from 'antlr4ts';
import { AbstractParseTreeVisitor } from 'antlr4ts/tree';
import { Stack } from '../utils/Stack';
import { ChildNode } from './operator/ChildNode';
import { Descendant } from './operator/Descendant';
import { Root } from './operator/Root';
import { Wildcard } from './operator/Wildcard';
import { assertFlatKeyExpression, assertProjectAndDropKeysCombinable,
    buildArgsExpression, extractKeys } from './parser/utils';
import { YAJSLexer } from './parser/YAJSLexer';
import { ActionDropKeysContext, ActionProjectContext,
    PathLeafContext, PathStepContext, YAJSParser } from './parser/YAJSParser';
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
        const pointer1 = this.size - 1;
        const pointer2 = jsonPath.size - 1;

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

        return this.matchFrom(jsonPath, pointer1, pointer2);
    }

    // The bulk of match()'s own former loop body, factored out so the
    // DESCENDANT branch below (issue #45) can recurse into it: verifying
    // the pattern operators still remaining (above pointer1) against the
    // position stack still remaining (above pointer2). match() itself just
    // seeds the initial pointers after its own leading last-operator check.
    private matchFrom(jsonPath: YAJSPath, pointer1: number, pointer2: number): boolean {
        while (pointer1 >= 0) {
            if (pointer2 < 0) {
                return false;
            }

            const o1 = this.stack[pointer1--];
            const o1Type = o1.getType();
            const o2 = jsonPath.stack[pointer2--];

            if (o1Type === PathOperator.Type.DESCENDANT) {
                let prevScan = this.stack[pointer1--];
                // Issue #39: a BARE Wildcard's match() and Descendant's
                // match() are both unconditionally true (see their own
                // match()), so neither one ever actually constrains "how
                // far back" this scan needs to reach - the scan below stops
                // at the very first candidate it examines once prevScan is
                // satisfied, which for a non-selective prevScan is *always*
                // the very next position level, silently capping '..' at
                // exactly one hop whenever it's immediately preceded by a
                // bare wildcard or another descendant (`$.*..*` repro),
                // unlike every other '..' composition, which reaches
                // arbitrary depth. The operator that actually constrains
                // the scan is always the next SELECTIVE one further back in
                // the pattern - a real key, a FILTERED wildcard ('[x]*',
                // whose match() is NOT unconditional: it evaluates its
                // filter against the candidate, so collapsing it as if bare
                // would silently discard the filter - see its `filtered`
                // check below), or Root itself, and Root is always
                // eventually reached this way since pattern[0] is always
                // Root (the YAJSPath constructor guarantees it) - so
                // collapse through every non-selective operator first and
                // scan for that instead. ('$.*..*' and '$..*..*' both
                // reduce to "scan for Root" this way, exactly like a plain
                // '$..a' already does.)
                //
                // Each collapsed WILDCARD, unlike DESCENDANT, still owes its
                // OWN single mandatory hop of real position depth (Wildcard
                // means "exactly one of anything", not "zero or more" -
                // that's what the still-separate wildcard-into-array-
                // overshoot branch further below, and the DESCENDANT branch
                // itself, already guard for every OTHER wildcard in
                // match()). Collapsing must not silently forgive that and
                // let e.g. '$.*..*' match a position only one level deep in
                // total (the trailing wildcard's own hop, with nothing left
                // for the leading one) - mandatoryHops counts how many such
                // hops still need to fit before the ultimate selective
                // target, and is subtracted from the scan's search ceiling
                // below.
                let mandatoryHops = 0;
                while (pointer1 >= 0 &&
                    ((prevScan.getType() === PathOperator.Type.WILDCARD &&
                        !(prevScan as Wildcard).filtered) ||
                        prevScan.getType() === PathOperator.Type.DESCENDANT)) {
                    if (prevScan.getType() === PathOperator.Type.WILDCARD) {
                        mandatoryHops++;
                    }
                    prevScan = this.stack[pointer1--];
                }
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
                // `$..x..y` repro). Skipping every ARRAY level, and only
                // ever testing prevScan.match() against a real (non-ARRAY)
                // ancestor position, fixes both.
                //
                // Delegated to jsonPath.nearestAncestorIndex() (issue #34):
                // walking the position stack back one level at a time here,
                // on every single match() attempt, is O(depth) work per
                // attempt - and since a '..'-containing path is never
                // `definite` (see the constructor), a match is attempted at
                // *every* depth as the document streams in, compounding to
                // O(depth^2) for a uniformly deep document. StreamPosition
                // overrides nearestAncestorIndex() with an incrementally
                // maintained index that answers this same query in
                // O(log depth) as the position grows/shrinks, instead of
                // rescanning the full ancestor chain from scratch each time
                // (the base implementation here - a plain linear scan - stays
                // the fallback for any non-streaming YAJSPath position, e.g.
                // one built directly via Builder in tests).
                //
                // Issue #45: the NEAREST ancestor satisfying prevScan isn't
                // necessarily the right one - the pattern operators still
                // remaining ABOVE prevScan (e.g. the Root that must sit
                // directly above a top-level key preceding '..') still have
                // to match whatever lies above whichever candidate is
                // chosen here, and the nearest candidate can fail that while
                // a farther one succeeds (repro: '$.a..x' against
                // {"a":{"c":{"a":{"x":1}}}} - "x"'s nearest "a" ancestor is
                // the INNER one, but nothing of the pattern's is left to
                // match against what's above THAT "a" except Root, and
                // Root only actually sits above the OUTER "a"). So this
                // can't just commit to the nearest candidate and let the
                // loop continue on regardless (a false negative - a real,
                // in-document match silently missed) - each candidate,
                // nearest first, has to be tried by recursively verifying
                // the remaining pattern against it, backtracking to the
                // next-farthest candidate on failure, until one works or
                // none are left.
                let searchCeiling = pointer2 + 1 - mandatoryHops;
                for (;;) {
                    const foundIndex = jsonPath.nearestAncestorIndex(prevScan, searchCeiling);
                    if (foundIndex < 0) {
                        // Unlike a ChildNode/Root prevScan that's simply never
                        // found (already handled correctly by the outer loop's
                        // own pointer2 < 0 checks - see below), a collapsed
                        // WILDCARD's still-outstanding mandatoryHops can push
                        // the search ceiling itself negative even when prevScan
                        // (Root) is trivially "found" at every other position -
                        // failing fast here, rather than falling through to
                        // pointer2's own sign, keeps that unrelated success case
                        // from masking this one. Exhausting every candidate
                        // during backtracking lands here too.
                        return false;
                    }
                    if (this.matchFrom(jsonPath, pointer1, foundIndex - 1)) {
                        return true;
                    }
                    searchCeiling = foundIndex - 1;
                }
            } else if (o2.getType() === PathOperator.Type.ARRAY) {
                // A matched array is transparent for its parent key/root, so
                // this array level doesn't consume a pattern operator - but
                // only ONE level: a matched array streams its immediate
                // elements one at a time rather than being flattened
                // (issue #14), so a SECOND consecutive array right beneath
                // it belongs to one of those elements' own subtree, not to
                // this key's path, and must not also be skipped transparently
                // - UNLESS the pattern operator that precedes this Wildcard
                // (this.stack at the now-decremented pointer1) is itself a
                // WILDCARD or DESCENDANT, which - exactly like the
                // wildcard-into-array-overshoot branch further below -
                // is specifically designed to tolerate unbounded
                // intervening depth (issue #38's `$..*` vs `{"m":[[{"a":1}]]}`
                // repro: the {"a":1} object, two array levels deep, must
                // still be reachable as its own independent match).
                const tolerateConsecutiveArrays = o1Type === PathOperator.Type.WILDCARD &&
                    pointer1 >= 0 &&
                    (this.stack[pointer1].getType() === PathOperator.Type.WILDCARD ||
                        this.stack[pointer1].getType() === PathOperator.Type.DESCENDANT);
                if (!tolerateConsecutiveArrays &&
                    pointer2 >= 0 && jsonPath.stack[pointer2].getType() === PathOperator.Type.ARRAY) {
                    return false;
                }
                // Retrying the SAME pattern operator (o1) against whatever
                // lies beneath the array is how Root and ChildNode reach
                // their real, still-pending comparison: Root.match() is
                // deliberately strict (see the comment above) so it must
                // retry to find the genuine Root beneath; ChildNode.match()
                // treats an immediate Array as a provisional pass (see
                // ChildNode.matches()) pending the real key check beneath.
                //
                // Wildcard is genuinely AMBIGUOUS here, and needs to try
                // BOTH readings (backtracking via recursion, cheapest/most
                // common first), because either one can be the only correct
                // pairing depending on what the pattern above must line up
                // with:
                //
                //  (a) CONSUME: the array level itself is the wildcard's
                //      one hop - the "elements of" position. This is how
                //      '$.*' matches a bare top-level array's elements
                //      ([1,2,3] - issue #20; the wildcard MUST stop here,
                //      because the level beneath is the document's own
                //      Root, which the pattern's trailing Root operator
                //      still separately needs to pair against), and how
                //      '$.arr.*' reaches {"arr":[1,2,3]}'s elements. The
                //      o1.match(o2) guard is the wildcard's filter check
                //      (a bare wildcard's match() is unconditionally true,
                //      so this only ever rejects for a '[x]*' whose filter
                //      fails against the array's ancestors) - without it, a
                //      filtered wildcard consuming an array level was the
                //      one pairing where its filter was never evaluated at
                //      all, making filter enforcement depend on the matched
                //      value's container type.
                //
                //  (b) RETRY: the array is transparent scaffolding for the
                //      key above it - exactly ChildNode's own rule - and
                //      the wildcard's real hop is that key beneath. This is
                //      how '$.*' reaches an array-valued key's elements at
                //      all ({"a":[{"x":1}]}: the element's position is
                //      Root->a->ARRAY, so consuming the ARRAY as the hop
                //      (a) leaves the pattern's Root mispaired against the
                //      key "a" and the whole match falsely failing - the
                //      key vanished from '$.*' output entirely), mirroring
                //      how '$.a' (array transparency) and '$..*'/'$.*.*'
                //      already reach those same elements.
                //
                // Trying (a) alone (as this branch once did, reasoning only
                // about the bare-top-level-array case) silently dropped
                // every (b)-shaped match; trying (b) alone would break (a)'s
                // bare-array case. Note the consecutive-array guard above
                // already returned false before this point when the array
                // run is deeper than one level (issue #14's whole-element
                // capture) - neither alternative may reach past it.
                if (o1Type === PathOperator.Type.WILDCARD) {
                    if (o1.match(o2) && this.matchFrom(jsonPath, pointer1, pointer2)) {
                        return true;
                    }
                    return this.matchFrom(jsonPath, pointer1 + 1, pointer2);
                }
                pointer1++;
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

    // Finds the largest position-stack index <= fromIndex whose operator
    // satisfies `target` (an ARRAY-typed position is always transparent
    // scaffolding here, never itself a valid match, regardless of what
    // target.match() would otherwise say about it - see the '..' scan's own
    // comment in match()), or -1 if none exists anywhere down to the root.
    //
    // This is the '..' backward-scan's full O(depth) fallback. It stays
    // correct on its own for any plain YAJSPath position - e.g. one built
    // directly via Builder in tests - which never accumulates the
    // incremental cache StreamPosition overrides this with for real
    // streaming (issue #34's O(log depth) fix - see StreamPosition's
    // override for the full reasoning).
    nearestAncestorIndex(target: PathOperator, fromIndex: number): number {
        for (let i = fromIndex; i >= 0; i--) {
            const candidate = this.stack[i];
            if (candidate.getType() !== PathOperator.Type.ARRAY && target.match(candidate)) {
                return i;
            }
        }
        return -1;
    }

    pathDepth(): number {
        return this.size;
    }

    // The compiled operator stack (Root, followed by each parsed step),
    // exposed read-only for callers that need to inspect a selector's shape
    // without reimplementing the parser - namely the NDJSON fast path's
    // chain compiler (src/main/lib/fastpath/FastPathEvaluator.ts), which
    // needs to recognize "definite pure-key chain" selectors ($.a.b.c, no
    // wildcards/descendants/filters) to pick its specialized evaluator.
    // Returns the live internal array - treat it as read-only.
    operators(): PathOperator[] {
        return this.stack;
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

        // Issue #95 (amended by #96): pathLeaf's grammar rule (see YAJS.g4)
        // now parses BOTH a project (`{...}`) and a drop-keys (`<...>`)
        // clause on the same terminal, in either written order - the
        // legality of actually combining them is enforced here, before the
        // default visitChildren() walk below applies whichever of
        // setProjection()/setDropKeys() the parsed children call.
        // "Forward order" (project written before drop-keys) is the only
        // order #95 ever proposed combining (`{key1}<key2>`); a written
        // order comparison via each child's own start token index - not
        // string content - is what tells the two apart, since a regex
        // primitive's pattern text can itself legitimately contain '{' or
        // '<' characters (see assertProjectAndDropKeysCombinable()'s own
        // comment in parser/utils.ts for why this moved off a raw substring
        // check).
        visitPathLeaf(ctx: PathLeafContext): YAJSPath.Builder {
            const projectCtx = ctx.actionProject();
            const dropKeysCtx = ctx.actionDropKeys();
            if (projectCtx && dropKeysCtx) {
                const forwardOrder = projectCtx.start.tokenIndex < dropKeysCtx.start.tokenIndex;
                assertProjectAndDropKeysCombinable(
                    projectCtx.filterExpression(), dropKeysCtx.filterExpression(), forwardOrder);
            }
            return this.visitChildren(ctx);
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
