import { FilterExpressionContext, FilterExpressionTermContext } from './YAJSParser';

export function extractKeys(ctx: FilterExpressionContext): string[] {
    const result = {};
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

export function buildArgsExpression(ctx: FilterExpressionContext): string {
    const result = [];
    ctx.filterExpressionTerm().forEach((c: FilterExpressionTermContext) => doBuildArgsExpression(c, result));
    return result.join('');
}

function doBuildArgsExpression(ctx: FilterExpressionTermContext, terms: string[]): void {
    if (ctx._key && ctx._key.text) {
        terms.push(`args['${ctx._key.text}']`);
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
