import { FilterExpressionContext, FilterExpressionTermContext } from './YAJSParser';

export function extractKeys(ctx: FilterExpressionContext): string[] {
    // Use a null-prototype object so that a key named "__proto__" becomes a
    // real own property instead of being routed through Object.prototype's
    // inherited __proto__ setter (which would silently mutate the object's
    // prototype chain instead of registering the key).
    const result = Object.create(null);
    ctx.filterExpressionTerm().forEach((c: FilterExpressionTermContext) => doExtractKeys(c, result));
    return Object.keys(result);
}

function doExtractKeys(ctx: FilterExpressionTermContext, keys: any): void {
    if (ctx._key && ctx._key.text) {
        keys[ctx._key.text] = true;
    } else if (ctx._expr) {
        // Parenthesized group (`LP expr=filterExpression RP`): recurse into
        // every term of the nested expression so keys inside parens are
        // captured too - previously silently dropped, since neither this
        // function nor buildArgsExpression's helper ever looked at `_expr`
        // (issue #26).
        ctx._expr.filterExpressionTerm().forEach((c: FilterExpressionTermContext) => doExtractKeys(c, keys));
    } else if (ctx._term) {
        // AND/OR/NOT-prefixed term (`op=(AND|OR|NOT) term=filterExpressionTerm`):
        // recurse into the single wrapped term.
        doExtractKeys(ctx._term, keys);
    }
}

export function buildArgsExpression(ctx: FilterExpressionContext): string {
    return buildTermsExpression(ctx.filterExpressionTerm());
}

// Joins a sibling list of filterExpressionTerm nodes - either the top-level
// filterExpression's own terms, or the contents of a parenthesized group -
// into a single JS boolean expression.
//
// The grammar (`filterExpression : filterExpressionTerm+`) lets any number
// of terms sit next to each other, and only the AND/OR/NOT alternatives
// carry their own operator token; a bare key term or a bare parenthesized
// group carries none. So besides rendering each term, this is also where
// two issue #26 bugs get fixed:
//   - a term with no explicit &&/|| joining it to the previous term (e.g.
//     `[a b]`, `{prop1 prop2}` - the README's "keys filter" style, and
//     `[a !b]`) defaults to `&&` instead of just concatenating with nothing
//     between them.
//   - a leading &&/|| on the very first term (e.g. `[&&x]`) has no left
//     operand to bind to, so it's dropped instead of emitted as invalid
//     leading-operator JS.
function buildTermsExpression(terms: FilterExpressionTermContext[]): string {
    return terms.
        map((term, index) => renderListTerm(term, index === 0)).
        join('');
}

function renderListTerm(ctx: FilterExpressionTermContext, isFirst: boolean): string {
    const op = ctx._op && ctx._op.text;
    const isConjunction = op === '&&' || op === '||';
    const body = doBuildArgsExpression(ctx);
    if (isConjunction) {
        return isFirst ? body : `${op}${body}`;
    }
    // A bare key/paren-group term, or a NOT-prefixed term, doesn't supply
    // its own joiner - default to `&&` unless it's the first term in the
    // list (nothing to its left to join with).
    return isFirst ? body : `&&${body}`;
}

function doBuildArgsExpression(ctx: FilterExpressionTermContext): string {
    if (ctx._key && ctx._key.text) {
        // JSON.stringify (not manual `'${...}'` wrapping) so a key
        // containing a quote, backslash, or control character produces a
        // correctly-escaped string literal instead of breaking out of it -
        // this string is compiled as real JavaScript via vm.runInContext
        // in ScriptFilterHelper, so unescaped interpolation here is exactly
        // the kind of bug that leads to code injection (issue #17).
        return `args[${JSON.stringify(ctx._key.text)}]`;
    }
    if (ctx._expr) {
        // Parenthesized group: recurse into the nested filterExpression's
        // own term list and wrap the result, so the grouping/precedence
        // implied by the source parens survives in the generated JS
        // (previously the parens were emitted around nothing - issue #26).
        return `(${buildTermsExpression(ctx._expr.filterExpressionTerm())})`;
    }
    if (ctx._term) {
        // AND/OR/NOT-prefixed term: the operator itself is emitted by the
        // caller (renderListTerm, for AND/OR - it needs to know this
        // term's position in its sibling list to decide whether to keep or
        // drop it) except for NOT, which is a unary prefix that never needs
        // a left operand and so is always kept here.
        const inner = doBuildArgsExpression(ctx._term);
        return ctx._op && ctx._op.text === '!' ? `!${inner}` : inner;
    }
    return '';
}
