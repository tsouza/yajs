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
