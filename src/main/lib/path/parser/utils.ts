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
    } else if (!ctx._key && ctx.children) {
        ctx.children.forEach((child) =>
            child instanceof FilterExpressionTermContext &&
            doExtractKeys(child as FilterExpressionTermContext, keys));
    }
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
    const result = [];
    ctx.filterExpressionTerm().forEach((c: FilterExpressionTermContext) => doBuildArgsExpression(c, result));
    return result.join('');
}

function doBuildArgsExpression(ctx: FilterExpressionTermContext, terms: string[]): void {
    if (ctx._key && ctx._key.text) {
        // JSON.stringify (not manual `'${...}'` wrapping) so a key
        // containing a quote, backslash, or control character produces a
        // correctly-escaped string literal instead of breaking out of it -
        // this string is compiled as real JavaScript via vm.runInContext
        // in ScriptFilterHelper, so unescaped interpolation here is exactly
        // the kind of bug that leads to code injection (issue #17).
        terms.push(`args[${JSON.stringify(ctx._key.text)}]`);
    } else if (!ctx._key && ctx.children) {
        if (ctx._op && ctx._op.text) {
            terms.push(ctx._op.text);
        }
        if (ctx._expr && ctx._expr.text) {
            terms.push('(');
        }
        ctx.children.forEach((child) =>
            child instanceof FilterExpressionTermContext &&
            doBuildArgsExpression(child as FilterExpressionTermContext, terms));
        if (ctx._expr && ctx._expr.text) {
            terms.push(')');
        }
    }
}
