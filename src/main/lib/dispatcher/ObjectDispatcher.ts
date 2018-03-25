import { isEmpty, pick } from 'lodash';
import { ScriptFilterHelper } from '../utils/ScriptFilterHelper';
import { AbstractObjectBuilder } from './AbstractObjectBuilder';

export class ObjectDispatcher extends AbstractObjectBuilder {

    private listener?: (value?: any) => void;

    private filterHelper: ScriptFilterHelper;

    constructor(listener: (value?: any) => any, projectExpression: string = '', projectKeys: string[] = []) {
        super();
        this.listener = listener || ((value?: any) => value);
        this.filterHelper = new ScriptFilterHelper(projectKeys, projectExpression);
    }

    endObject(): boolean {
        this.doEndObject();
        if (this.isInRoot()) {
            if (this.filterHelper.isFiltered()) {
                const result: any = this.peek().value;
                if (this.filterHelper.filters((key) => key in result)) {
                    this.listener(result);
                }
            } else {
                this.listener(this.peek().value);
            }
            return true;
        }
        return false;
    }

    endArray(): boolean {
        this.doEndArray();
        return this.isInRoot();
    }
}
