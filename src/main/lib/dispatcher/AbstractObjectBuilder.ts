const S_ROOT    = 0;
const S_ARRAY   = 1;
const S_OBJECT  = 2;

export abstract class AbstractObjectBuilder {

    private stack: JsonNode[];
    private stackSize: number = 0;

    private fieldName?: string;

    constructor() {
        this.push(S_ROOT);
    }

    startObject(): void {
        const newObject = {};
        this.handle(newObject);
        this.push(S_OBJECT, newObject);
    }

   startObjectEntry(key: string): void {
       if (this.peek().scope === S_OBJECT) {
           this.fieldName = key;
       }
    }

    startArray(): void {
        const newArray = [];
        this.handle(newArray);
        this.push(S_ARRAY, newArray);
    }

    onValue(value: any): void {
        this.handle(value);
    }

    isInRoot(): boolean {
        return this.peek().scope === S_ROOT;
    }

    protected peek(): JsonNode {
        return this.stack[this.stackSize - 1];
    }

    protected doEndObject(): void {
        const scope = this.peek().scope;
        if (scope === S_OBJECT) {
            this.pop();
        }
    }

    protected doEndArray(): void {
        this.pop();
    }

    private replaceTop(value?: any): void {
        this.stack[this.stackSize - 1].value = value;
    }

    private pop(): void {
        this.stackSize--;
    }

    private push(scope: number, value?: any): void {
        this.stack = this.stack || [];
        let next = this.stack[this.stackSize];
        if (next == null) {
            next = new JsonNode();
            this.stack[this.stackSize] = next;
        }
        next.value = value;
        next.scope = scope;
        this.stackSize++;
    }

    private handle(value: any): void {
        const top = this.peek();
        const topScope = top.scope;
        const topValue = top.value;
        switch (topScope) {
            case S_ROOT:
                this.replaceTop(value);
                break;
            case S_OBJECT:
                const fieldName = this.fieldName;
                if (fieldName) {
                    topValue[fieldName] = value;
                    this.fieldName = undefined;
                }
                break;
            case S_ARRAY:
                (topValue as any[]).push(value);
        }
    }
 }

// tslint:disable-next-line:max-classes-per-file
class JsonNode {
    scope: number;
    value?: any;
}
