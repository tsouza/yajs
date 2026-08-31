import { FilterExpressionContext, FilterExpressionTermContext } from './YAJSParser';

// -----------------------------------------------------------------------
// Grammar shape reminder (see YAJS.g4):
//
//   filterExpression
//     : filterExpressionTerm+
//     ;
//
//   filterExpressionTerm
//     : op=(AND | OR) term=filterExpressionTerm   // ctx._op (&&/||) + ctx._term
//     | op=NOT term=filterExpressionTerm          // ctx._op (!)     + ctx._term
//     | LP expr=filterExpression RP               // ctx._expr (a FilterExpressionContext, NOT a term!)
//     | key=FilterExpressionTerm                  // ctx._key
//     ;
//
// A FilterExpressionContext is therefore a flat *list* of sibling
// filterExpressionTerm nodes with no separator token between them - any
// AND/OR connector between two siblings is parsed as part of the SECOND
// sibling's own `_op`/`_term` fields, not as a token sitting "between" two
// list entries. A bare key list like `{key1 key2}` (the README's
// documented "keys filter" style) is therefore two siblings with no `_op`
// on the second one at all.
//
// Both extractKeys() and buildArgsExpression() below walk this same shape;
// keep them in sync when interpreting `_key`/`_expr`/`_op`+`_term`.
// -----------------------------------------------------------------------

// -----------------------------------------------------------------------
// Iterative tree-walk (issue #35)
//
// Every level of paren/AND/OR/NOT nesting in a filterExpression corresponds
// to one level of this tree. The walk used to be plain JS recursion (one
// call frame per level), which ties the maximum supported nesting depth to
// the JS call stack - and for this particular walk, that overflows
// (uncaught RangeError) at a nesting depth of roughly 2,000, LOWER than the
// depth the ANTLR-generated parser itself can already build a tree for
// (~4,000). A pathological but not otherwise-invalid selector string could
// therefore crash the process via this code specifically, before the
// selector was even rejected as invalid - inconsistent with the "malformed
// selectors fail cleanly" principle established by issues #18/#19/#23.
//
// Both walks below (key extraction and expression rendering) instead use
// an explicit array-based stack in place of the JS call stack, so the
// nesting depth they support is bounded only by available heap memory
// rather than by V8's comparatively small, non-configurable-from-userland
// call stack. In practice this removes the ceiling entirely for any
// nesting depth the ANTLR parser itself is still able to produce a tree
// for - i.e. this walk is no longer the weakest link in the pipeline.
// -----------------------------------------------------------------------

export function extractKeys(ctx: FilterExpressionContext): string[] {
    // Use a null-prototype object so that a key named "__proto__" becomes a
    // real own property instead of being routed through Object.prototype's
    // inherited __proto__ setter (which would silently mutate the object's
    // prototype chain instead of registering the key).
    const result = Object.create(null);
    doExtractKeysFromExpression(ctx, result);
    return Object.keys(result);
}

// Work-list entry for the iterative key-extraction walk: either a whole
// sibling list (a FilterExpressionContext, e.g. a parenthesized group's
// body) or a single term to inspect.
type KeyWorkItem =
    | { kind: 'expr'; ctx: FilterExpressionContext }
    | { kind: 'term'; ctx: FilterExpressionTermContext };

function doExtractKeysFromExpression(ctx: FilterExpressionContext, keys: any): void {
    // Explicit LIFO stack standing in for the call stack it replaces.
    // Siblings/children are pushed in reverse order so they're popped
    // (visited) left-to-right, and a term's own children are always pushed
    // - and therefore fully drained - before its next sibling is reached,
    // exactly reproducing the original recursion's depth-first,
    // left-to-right visitation order (extractKeys()'s returned key order
    // matches selector source order, which callers/tests rely on).
    const stack: KeyWorkItem[] = [{ kind: 'expr', ctx }];
    while (stack.length > 0) {
        const item = stack.pop() as KeyWorkItem;
        if (item.kind === 'expr') {
            const terms = item.ctx.filterExpressionTerm();
            for (let i = terms.length - 1; i >= 0; i--) {
                stack.push({ kind: 'term', ctx: terms[i] });
            }
        } else {
            doExtractKeys(item.ctx, keys, stack);
        }
    }
}

function doExtractKeys(ctx: FilterExpressionTermContext, keys: any, stack: KeyWorkItem[]): void {
    if (ctx._key && ctx._key.text) {
        keys[ctx._key.text] = true;
    } else if (ctx._expr) {
        // Parenthesized group: `(expr)` - ctx._expr is a FilterExpressionContext
        // (a nested term list), not a FilterExpressionTermContext, so it needs
        // its own list-walk rather than a single-term recursion. Push it back
        // onto the shared stack instead of recursing.
        stack.push({ kind: 'expr', ctx: ctx._expr });
    } else if (ctx._term) {
        // AND/OR/NOT-prefixed term (`&&x`, `||x`, `!x`) - the key(s) live in
        // the nested `_term`. Push it back onto the shared stack instead of
        // recursing.
        stack.push({ kind: 'term', ctx: ctx._term });
    }
}

// A single filterExpressionTerm, rendered into valid JS.
//
// `op` is non-null only when this term itself carried an explicit AND/OR
// prefix (`&&x` / `||x`) - i.e. it's the connector this term wants to use to
// join onto whatever precedes it. It is null for a bare key, a NOT-prefixed
// term (NOT is folded into `text` as a unary `!(...)`, not exposed as a
// connector) and a parenthesized group.
interface RenderedTerm {
    op: string | null;
    text: string;
}

// Drop-keys (`<...>`) shares the same `filterExpression` grammar rule as
// project (`{...}`) and filter (`[...]`), so `&&`/`||`/`!`/parens all parse
// without error there too - but Visitor.visitActionDropKeys only ever calls
// extractKeys(), which just flattens every leaf key token into a plain list,
// discarding the boolean structure entirely. That silently turned e.g.
// `<key1 && key2>` and `<!key1>` into the exact same "drop every named key
// unconditionally" behavior as a plain `<key1 key2>` list, with no error or
// indication that the operators the user wrote had no effect (issue #29).
// Drop-keys' flat "these keys are always dropped" semantics don't have an
// unambiguous meaning for AND/OR/NOT/parens in the first place (unlike
// project/filter, which evaluate the whole expression once to a single
// true/false gate - dropping is inherently per-key, so it's not clear what
// "drop key1 || key2" or "drop !key1" would even mean), so - consistent
// with how issues #18/#19 made other malformed-selector cases fail cleanly
// at parse time instead of silently misbehaving - this rejects any
// drop-keys expression that isn't a flat, space-separated list of bare key
// names, rather than quietly discarding the operators the user wrote.
export function assertFlatKeyExpression(ctx: FilterExpressionContext): void {
    const isBareKeyTerm = (term: FilterExpressionTermContext) => !!(term._key && term._key.text);
    if (!ctx.filterExpressionTerm().every(isBareKeyTerm)) {
        throw new Error('Drop-keys (<...>) doesn\'t support boolean operators ' +
            '(&&, ||, !) or parentheses - it only accepts a flat, ' +
            'space-separated list of key names to always drop, e.g. <key1 key2>.');
    }
}

// Issue #52: pathLeaf's own grammar rule (`pathLeaf: actionProject |
// actionDropKeys` - see YAJS.g4) already makes project (`{...}`) and
// drop-keys (`<...>`) mutually exclusive: a selector may end in at most one
// of them. But when a selector nevertheless writes both (e.g. `$.a{x}<y>`),
// there's no grammar rule for "this specific illegal combination" - pathLeaf
// just matches whichever one comes first (here, actionProject), leaving the
// second one as unconsumed trailing input that only fails once the parser
// reaches EOF and finds it still there. That surfaces as a raw, internal
// ANTLR message ("mismatched input '<' expecting <EOF>") that never says
// WHY the selector is invalid - unlike the purpose-built message issue #29
// added for drop-keys' own boolean-operator restriction (see
// assertFlatKeyExpression above). This is the equivalent purpose-built check
// for the project/drop-keys combination.
//
// `{`, `}`, `<`, `>` are reserved structural characters excluded from both
// Identifier's and FilterExpressionTerm's character classes (see YAJS.g4),
// so they can only ever appear as actionProject/actionDropKeys' own LB/RB/
// LT/GT delimiters - never inside a key name, a filter value, or anywhere
// else a selector's own content can legitimately place them. That makes a
// plain substring check on the raw, unparsed selector safe: if both a `{`
// and a `<` appear anywhere in it, the selector necessarily attempts to use
// both project and drop-keys, and it's rejected here - before parsing -
// with a message that names the actual constraint instead of an internal
// ANTLR token diff.
export function assertProjectAndDropKeysNotCombined(path: string): void {
    if (path.indexOf('{') !== -1 && path.indexOf('<') !== -1) {
        throw new Error(
            'A selector can\'t combine project ({...}) and drop-keys (<...>) - ' +
            'they are mutually exclusive; use only one of them.');
    }
}

export function buildArgsExpression(ctx: FilterExpressionContext): string {
    return renderExpression(ctx);
}

// Instruction set for the iterative expression-rendering walk. Each
// instruction corresponds to one "half" of what used to be a recursive
// call: RENDER_* instructions push work to do (mirroring entering a
// function), and COMBINE_* instructions consume already-computed child
// result(s) from `values` and push a combined result back (mirroring using
// a recursive call's return value after it returns). Children are always
// pushed in reverse order immediately below their own COMBINE_* instruction,
// so - since this is a plain LIFO stack - they are popped and fully
// resolved, left-to-right, strictly before that COMBINE_* instruction runs;
// this reproduces exactly the same depth-first, left-to-right,
// combine-on-the-way-back-up evaluation order as the original recursion.
type RenderInstr =
    | { op: 'RENDER_EXPR'; ctx: FilterExpressionContext }
    | { op: 'COMBINE_EXPR'; terms: FilterExpressionTermContext[] }
    | { op: 'RENDER_TERM'; ctx: FilterExpressionTermContext }
    | { op: 'COMBINE_PAREN' }
    | { op: 'COMBINE_TRANSPARENT_GROUP'; innerCtx: FilterExpressionTermContext }
    | { op: 'COMBINE_NOT'; termCtx: FilterExpressionTermContext }
    | { op: 'COMBINE_OP_PREFIX'; opText: string; termCtx: FilterExpressionTermContext };

// Renders a full sibling list (the body of a filterExpression, whether at
// the top level or inside a parenthesized group) into one valid JS boolean
// expression.
//
// Per the README's documented "keys filter" semantics (`<key>{keys filter}`
// emits when ANY listed key is present) a plain space-separated key list
// with no explicit connector - `{key1 key2}` - is joined with an implicit
// `||`, matching the OR/`.some()` semantics the rest of the filter machinery
// already documents for that style.
function renderExpression(rootCtx: FilterExpressionContext): string {
    const instrStack: RenderInstr[] = [{ op: 'RENDER_EXPR', ctx: rootCtx }];
    // Holds intermediate results as the walk proceeds: a RenderedTerm for a
    // single rendered term, or a string for a fully-joined sibling list
    // (either still awaiting COMBINE_PAREN to wrap it in `(...)`, or - once
    // the stack empties - the final rendered expression).
    const values: Array<RenderedTerm | string> = [];

    while (instrStack.length > 0) {
        const instr = instrStack.pop() as RenderInstr;
        switch (instr.op) {
            case 'RENDER_EXPR': {
                const terms = instr.ctx.filterExpressionTerm();
                instrStack.push({ op: 'COMBINE_EXPR', terms });
                for (let i = terms.length - 1; i >= 0; i--) {
                    instrStack.push({ op: 'RENDER_TERM', ctx: terms[i] });
                }
                break;
            }
            case 'COMBINE_EXPR': {
                const count = instr.terms.length;
                const rendered = values.splice(values.length - count, count) as RenderedTerm[];
                let result = '';
                rendered.forEach((rendered_, index) => {
                    if (index === 0) {
                        if (rendered_.op) {
                            // The very first term in a list has nothing to its
                            // left, so an explicit `&&`/`||` prefix here (e.g.
                            // `[&&x]`) is meaningless - fail cleanly at parse
                            // time (see issue #26, consistent with how issues
                            // #18/#19 made other malformed selectors fail
                            // cleanly) instead of emitting `&&args["x"]`, which
                            // would only surface as an opaque raw
                            // vm.runInContext SyntaxError far away from the
                            // actual selector string.
                            throw leadingOperatorError(instr.terms[0]);
                        }
                        result = rendered_.text;
                    } else {
                        result += (rendered_.op || '||') + rendered_.text;
                    }
                });
                values.push(result);
                break;
            }
            case 'RENDER_TERM': {
                const ctx = instr.ctx;
                if (ctx._key && ctx._key.text) {
                    // JSON.stringify (not manual `'${...}'` wrapping) so a key
                    // containing a quote, backslash, or control character
                    // produces a correctly-escaped string literal instead of
                    // breaking out of it - this string is compiled as real
                    // JavaScript via vm.runInContext in ScriptFilterHelper, so
                    // unescaped interpolation here is exactly the kind of bug
                    // that leads to code injection (issue #17).
                    const rendered: RenderedTerm = { op: null, text: `args[${JSON.stringify(ctx._key.text)}]` };
                    values.push(rendered);
                } else if (ctx._expr) {
                    // Parenthesized group: `(expr)`. ctx._expr is the nested
                    // FilterExpressionContext holding the group's own term
                    // list - render it (via the shared stack) and wrap the
                    // result in real parens once it's ready.
                    //
                    // Exception: a group containing exactly one term (no
                    // `&&`/`||` join happening inside it) never needs real
                    // parens around it - a lone term always renders to
                    // something already atomic enough (a bare `args[...]`, a
                    // unary `!(...)`, or an already-parenthesized nested
                    // multi-term group) that wrapping it again can't change
                    // how it combines with whatever operator surrounds it.
                    // Rendering it "transparently" (no extra parens) instead
                    // of always wrapping matters for more than just tidiness:
                    // a long chain of single-term groups (`((((key1))))`)
                    // would otherwise still produce real nested parens in the
                    // compiled JS matching the selector's nesting depth -
                    // and *that* string then gets compiled via `new
                    // vm.Script()` in ScriptFilterHelper, which has its own,
                    // separately recursive JS-source parser (V8's, entirely
                    // outside this codebase's control) that overflows on
                    // deeply nested real parens at roughly the same low
                    // depth this tree-walk itself used to (issue #35) - so
                    // making only this walk iterative isn't sufficient on
                    // its own to fix the reported crash end-to-end.
                    const innerTerms = ctx._expr.filterExpressionTerm();
                    if (innerTerms.length === 1) {
                        instrStack.push({ op: 'COMBINE_TRANSPARENT_GROUP', innerCtx: innerTerms[0] });
                        instrStack.push({ op: 'RENDER_TERM', ctx: innerTerms[0] });
                    } else {
                        instrStack.push({ op: 'COMBINE_PAREN' });
                        instrStack.push({ op: 'RENDER_EXPR', ctx: ctx._expr });
                    }
                } else if (ctx._op && ctx._term) {
                    // AND/OR/NOT-prefixed term: render the operand (`ctx._term`)
                    // first via the shared stack, then combine once it's ready.
                    // A leading AND/OR (or a not-yet-resolved AND/OR) found on
                    // that operand has no left-hand side available - the same
                    // "no left operand" problem as a leading operator at the
                    // start of a sibling list - so it's rejected the same way,
                    // in the COMBINE_* step below.
                    if (ctx._op.text === '!') {
                        instrStack.push({ op: 'COMBINE_NOT', termCtx: ctx._term });
                    } else {
                        instrStack.push({ op: 'COMBINE_OP_PREFIX', opText: ctx._op.text, termCtx: ctx._term });
                    }
                    instrStack.push({ op: 'RENDER_TERM', ctx: ctx._term });
                } else {
                    /* istanbul ignore next -- exhaustive per grammar; defensive only */
                    throw new Error('Unrecognized filter expression term');
                }
                break;
            }
            case 'COMBINE_PAREN': {
                const inner = values.pop() as string;
                const rendered: RenderedTerm = { op: null, text: `(${inner})` };
                values.push(rendered);
                break;
            }
            case 'COMBINE_TRANSPARENT_GROUP': {
                // Single-term group (see RENDER_TERM's ctx._expr branch above)
                // - pass the inner term's rendering straight through with no
                // extra parens. Still has to run the same leading-operator
                // check a normal (multi-term) group would have applied via
                // COMBINE_EXPR, since this is standing in for that path.
                const inner = values.pop() as RenderedTerm;
                if (inner.op) {
                    throw leadingOperatorError(instr.innerCtx);
                }
                values.push(inner);
                break;
            }
            case 'COMBINE_NOT': {
                const operand = values.pop() as RenderedTerm;
                if (operand.op) {
                    throw leadingOperatorError(instr.termCtx);
                }
                const rendered: RenderedTerm = { op: null, text: `!(${operand.text})` };
                values.push(rendered);
                break;
            }
            case 'COMBINE_OP_PREFIX': {
                const operand = values.pop() as RenderedTerm;
                if (operand.op) {
                    throw leadingOperatorError(instr.termCtx);
                }
                const rendered: RenderedTerm = { op: instr.opText, text: operand.text };
                values.push(rendered);
                break;
            }
        }
    }

    return values.pop() as string;
}

function leadingOperatorError(ctx: FilterExpressionTermContext): Error {
    const op = ctx._op ? ctx._op.text : '?';
    const line = ctx.start ? ctx.start.line : undefined;
    const col = ctx.start ? ctx.start.charPositionInLine : undefined;
    const at = line !== undefined ? ` at line ${line}:${col}` : '';
    return new Error(
        `Invalid filter expression${at}: '${op}' has no left-hand operand`);
}
