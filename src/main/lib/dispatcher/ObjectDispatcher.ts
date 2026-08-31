import { ScriptFilterHelper } from '../utils/ScriptFilterHelper';
import { AbstractObjectBuilder } from './AbstractObjectBuilder';

export class ObjectDispatcher extends AbstractObjectBuilder {

    private listener?: (value?: any) => void;

    private filterHelper: ScriptFilterHelper;

    private dispatch: () => void;

    constructor(listener: (value?: any) => any, projectExpression: string = '', projectKeys: string[] = []) {
        super();
        this.listener = listener || ((value?: any) => value);
        this.filterHelper = new ScriptFilterHelper(projectKeys, projectExpression);

        this.dispatch = this.filterHelper.isFiltered() ?
            () => {
                const result: any = this.peek().value;
                // Must be an own-property check, not `key in result`: built
                // result objects deliberately keep Object.prototype (issue
                // #12's fix stores colliding keys like "__proto__" as real
                // own data properties instead of stripping the prototype),
                // so `in` - which walks the prototype chain - would report
                // every inherited member name (toString, constructor,
                // valueOf, hasOwnProperty, __proto__, ...) as present and
                // make projections like $.a{toString} match objects that
                // don't actually carry that key.
                if (this.filterHelper.filters((key) =>
                        Object.prototype.hasOwnProperty.call(result, key))) {
                    this.listener(result);
                }
            } : () => this.listener(this.peek().value);
    }

    endObject(): boolean {
        this.doEndObject();
        if (this.isInRoot()) {
            this.dispatch();
            return true;
        }
        return false;
    }

    endArray(): boolean {
        this.doEndArray();
        if (this.isInRoot()) {
            this.dispatch();
            return true;
        }
        return false;
    }
}
