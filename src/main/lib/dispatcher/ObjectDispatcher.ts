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
                //
                // Issue #95: this gate runs against `result` BEFORE
                // dropDeferredKeys() below strips anything - i.e. against
                // the object's full, undropped top-level key set, exactly
                // as #95 specifies (a regex-gated project+drop-keys
                // combination's gate sees a key that drop-keys is about to
                // remove; see AbstractObjectBuilder's mDeferDropKeys for how
                // construction keeps that key attached long enough for this
                // to be possible in the first place). Object.keys(result) is
                // the keySetProvider for the regex primitive (#96)'s
                // existential match - only actually invoked when this
                // filter has a regex term at all (see ScriptFilterHelper).
                if (this.filterHelper.filters(
                        (key) => Object.prototype.hasOwnProperty.call(result, key),
                        () => Object.keys(result))) {
                    this.dropDeferredKeys();
                    this.listener(result);
                }
            } : () => this.listener(this.peek().value);
    }

    // See AbstractObjectBuilder.deferDropKeysForCombinedProject()'s own
    // comment for the full reasoning: standalone drop-keys (no project
    // active) keeps its original skip-during-construction behavior
    // untouched; only when this dispatcher's own project filter is ALSO
    // active does construction need to keep every key attached so the gate
    // above can see the complete object.
    protected deferDropKeysForCombinedProject(): boolean {
        return this.filterHelper.isFiltered();
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
