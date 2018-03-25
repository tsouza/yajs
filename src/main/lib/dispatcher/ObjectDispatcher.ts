import { isEmpty, pick } from 'lodash';
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
                if (this.filterHelper.filters((key) => key in result)) {
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
        return this.isInRoot();
    }
}
