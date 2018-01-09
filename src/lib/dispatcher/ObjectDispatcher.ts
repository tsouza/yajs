import { isEmpty, pick } from 'lodash';
import { AbstractObjectBuilder } from './AbstractObjectBuilder';

export class JsonDispatcher extends AbstractObjectBuilder {

    private listener?: (value?: any) => void;
    private projectionKeys?: string[];

    constructor(listener: (value?: any) => void, projectionKeys?: string[]) {
        super();
        this.listener = listener;
        this.projectionKeys = projectionKeys;
    }

    endObject(): boolean {
        this.doEndObject();
        if (this.isInRoot()) {
            let result: any = this.peek().value;
            if (this.listener) {
                if (this.projectionKeys && !isEmpty(this.projectionKeys)) {
                    result = pick(result, this.projectionKeys);
                }
                this.listener(result);
            }
            this.clear();
            return true;
        }
        return false;
    }

    endArray(): boolean {
        this.doEndArray();
        if (this.isInRoot()) {
            /*let result: any = this.peek().value;
            if (this.listener)
                this.listener(result);*/
            this.clear();
            return true;
        }
        return false;
    }

    clear(): void {
        super.clear();
        this.listener = undefined;
    }
}
