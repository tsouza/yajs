const Scope = {
    IN_ARRAY: 2,
    IN_OBJECT: 1,
    ROOT: 0,
};

export abstract class AbstractObjectBuilder {

    private stack: JsonNode[];
    private stackSize: number = 0;

    private fieldName?: string;

    // private handlers: { [index: number]: (value: any, top: JsonNode) => void };

    constructor() {
        /*this.handlers = {
            [Scope.ROOT]: (value) => this.replaceTop(value),
            [Scope.IN_OBJECT]: (value, top) => {
                if (this.fieldName) {
                    top.value[this.fieldName] = value;
                    this.fieldName = undefined;
                }
            },
            [Scope.IN_ARRAY]: (value, top) =>
                (top.value as any[]).push(value),
        };*/
        this.push(Scope.ROOT);
    }

    startObject(): void {
        const newObject: any = { };
        const top = this.peek();
        this.handle(newObject, top);
        // this.handlers[top.scope.valueOf()](newObject, top);
        /*switch (top.scope) {
            case Scope.ROOT:
                this.replaceTop(newObject);
                break;
            case Scope.IN_OBJECT:
                if (this.fieldName) {
                    top.value[this.fieldName] = newObject;
                    this.fieldName = undefined;
                }
                break;
            case Scope.IN_ARRAY:
                (top.value as any[]).push(newObject);
                break;
            default:
                throw new Error();
        }*/
        this.push(Scope.IN_OBJECT, newObject);
    }

   startObjectEntry(key: string): void {
       if (this.peek().scope === Scope.IN_OBJECT) {
           this.fieldName = key;
       }
        /*switch (this.peek().scope) {
            case Scope.IN_OBJECT:
                this.fieldName = key;
                break;
            case Scope.IN_ARRAY:
                throw new Error();
        }*/
    }

    startArray(): void {
        const newArray: any[] = [];
        const top = this.peek();
        this.handle(newArray, top);
        // this.handlers[top.scope.valueOf()](newArray, top);
        /*switch (top.scope) {
            case Scope.ROOT:
                this.replaceTop(newArray);
                break;
            case Scope.IN_OBJECT:
                if (this.fieldName) {
                    top.value[this.fieldName] = newArray;
                    this.fieldName = undefined;
                }
                break;
            case Scope.IN_ARRAY:
                (top.value as any[]).push(newArray);
                break;
            default:
                throw new Error();
        }*/
        this.push(Scope.IN_ARRAY, newArray);
    }

    onValue(value: any): void {
        this.handle(value, this.peek());
        // this.handlers[top.scope.valueOf()](value, top);
        /*switch (top.scope) {
            case Scope.ROOT:
                this.replaceTop(value);
                break;
            case Scope.IN_OBJECT:
                if (this.fieldName) {
                    top.value[this.fieldName] = value;
                    this.fieldName = undefined;
                }
                break;
            case Scope.IN_ARRAY:
                (top.value as any[]).push(value);
                break;
            default:
                throw new Error();
        }*/
    }

    isInRoot(): boolean {
        return this.peek().scope === Scope.ROOT;
    }

    clear(): void {
        /*this.fieldName = undefined;
        this.stack = [];*/
    }

    protected peek(): JsonNode {
        return this.stack[this.stackSize - 1];
    }

    protected doEndObject(): void {
        const scope = this.peek().scope;
        if (scope === Scope.IN_OBJECT) {
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
        // next.handler = this.handlers[scope];
        this.stackSize++;
    }

    private handle(value: any, top: JsonNode): void {
        if (top.scope === Scope.ROOT) {
            this.replaceTop(value);
        } else if (top.scope === Scope.IN_OBJECT) {
            if (this.fieldName) {
                top.value[this.fieldName] = value;
                this.fieldName = undefined;
            }
        } else if (top.scope === Scope.IN_ARRAY) {
            (top.value as any[]).push(value);
        }
    }
 }

// tslint:disable-next-line:max-classes-per-file
class JsonNode {
    scope: number;
    // handler: (value: any, top: JsonNode) => void;
    value?: any;
}
