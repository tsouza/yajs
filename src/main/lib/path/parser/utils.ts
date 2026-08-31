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

export function extractKeys(ctx: FilterExpressionContext): string[] {
    // Use a null-prototype object so that a key named "__proto__" becomes a
    // real own property instead of being routed through Object.prototype's
    // inherited __proto__ setter (which would silently mutate the object's
    // prototype chain instead of registering the key).
    const result = Object.create(null);
    doExtractKeysFromExpression(ctx, result);
    return Object.keys(result);
}

function doExtractKeysFromExpression(ctx: FilterExpressionContext, keys: any): void {
    ctx.filterExpressionTerm().forEach((c: FilterExpressionTermContext) => doExtractKeys(c, keys));
}

function doExtractKeys(ctx: FilterExpressionTermContext, keys: any): void {
    if (ctx._key && ctx._key.text) {
        keys[ctx._key.text] = true;
    } else if (ctx._expr) {
        // Parenthesized group: `(expr)` - ctx._expr is a FilterExpressionContext
        // (a nested term list), not a FilterExpressionTermContext, so it needs
        // its own list-walk rather than a single-term recursion.
        doExtractKeysFromExpression(ctx._expr, keys);
    } else if (ctx._term) {
        // AND/OR/NOT-prefixed term (`&&x`, `||x`, `!x`) - the key(s) live in
        // the nested `_term`.
        doExtractKeys(ctx._term, keys);
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

export function buildArgsExpression(ctx: FilterExpressionContext): string {
    return renderExpression(ctx);
}

// Renders a full sibling list (the body of a filterExpression, whether at
// the top level or inside a parenthesized group) into one valid JS boolean
// expression.
//
// Per the README's documented "keys filter" semantics (`<key>{keys filter}`
// emits when ANY listed key is present) a plain space-separated key list
// with no explicit connector - `{key1 key2}` - is joined with an implicit
// `||`, matching the OR/`.some()` semantics the rest of the filter machinery
// already documents for that style.
function renderExpression(ctx: FilterExpressionContext): string {
    let result = '';
    ctx.filterExpressionTerm().forEach((term: FilterExpressionTermContext, index: number) => {
        const rendered = renderTerm(term);
        if (index === 0) {
            if (rendered.op) {
                // The very first term in a list has nothing to its left, so
                // an explicit `&&`/`||` prefix here (e.g. `[&&x]`) is
                // meaningless - fail cleanly at parse time (see issue #26,
                // consistent with how issues #18/#19 made other malformed
                // selectors fail cleanly) instead of emitting `&&args["x"]`,
                // which would only surface as an opaque raw vm.runInContext
                // SyntaxError far away from the actual selector string.
                throw leadingOperatorError(term);
            }
            result = rendered.text;
        } else {
            result += (rendered.op || '||') + rendered.text;
        }
    });
    return result;
}

// Renders a term used as an *operand* - i.e. in a position with no left-hand
// side available (the target of a unary `!`, or the right-hand side of an
// AND/OR connector). An unresolved AND/OR prefix found here (e.g. the inner
// term of `!&&x` or `&&&&x`) has the same "no left operand" problem as a
// leading operator at the start of a list, so it's rejected the same way.
function renderOperand(ctx: FilterExpressionTermContext): string {
    const rendered = renderTerm(ctx);
    if (rendered.op) {
        throw leadingOperatorError(ctx);
    }
    return rendered.text;
}

function renderTerm(ctx: FilterExpressionTermContext): RenderedTerm {
    if (ctx._key && ctx._key.text) {
        // JSON.stringify (not manual `'${...}'` wrapping) so a key
        // containing a quote, backslash, or control character produces a
        // correctly-escaped string literal instead of breaking out of it -
        // this string is compiled as real JavaScript via vm.runInContext
        // in ScriptFilterHelper, so unescaped interpolation here is exactly
        // the kind of bug that leads to code injection (issue #17).
        return { op: null, text: `args[${JSON.stringify(ctx._key.text)}]` };
    }

    if (ctx._expr) {
        // Parenthesized group: `(expr)`. ctx._expr is the nested
        // FilterExpressionContext holding the group's own term list -
        // render it recursively and wrap in real parens.
        return { op: null, text: `(${renderExpression(ctx._expr)})` };
    }

    if (ctx._op && ctx._term) {
        if (ctx._op.text === '!') {
            return { op: null, text: `!(${renderOperand(ctx._term)})` };
        }
        // AND/OR-prefixed term: the operator is a connector for whatever
        // precedes this term in the enclosing sibling list: the connector
        // itself isn't part of `text`.
        return { op: ctx._op.text, text: renderOperand(ctx._term) };
    }

    /* istanbul ignore next -- exhaustive per grammar; defensive only */
    throw new Error('Unrecognized filter expression term');
}

function leadingOperatorError(ctx: FilterExpressionTermContext): Error {
    const op = ctx._op ? ctx._op.text : '?';
    const line = ctx.start ? ctx.start.line : undefined;
    const col = ctx.start ? ctx.start.charPositionInLine : undefined;
    const at = line !== undefined ? ` at line ${line}:${col}` : '';
    return new Error(
        `Invalid filter expression${at}: '${op}' has no left-hand operand`);
}
