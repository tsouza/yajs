export abstract class AbstractObjectBuilder {

    private stack: JsonNode[];
    private stackSize: number = 0;

    private fieldName?: string;

    constructor() {
      this.push(Scope.ROOT);
    }

    startObject(): void {
        const newObject: any = { };
        const top = this.peek();
        switch (top.scope) {
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
        }
        this.push(Scope.IN_OBJECT, newObject);
    }

   startObjectEntry(key: string): void {
        switch (this.peek().scope) {
            case Scope.IN_OBJECT:
                this.fieldName = key;
                break;
            case Scope.IN_ARRAY:
                throw new Error();
        }
    }

    startArray(): void {
        const newArray: any[] = [];
        const top = this.peek();
        switch (top.scope) {
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
        }
        this.push(Scope.IN_ARRAY, newArray);
    }

    onValue(value: any): void {
        const top = this.peek();
        switch (top.scope) {
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
        }
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

    private push(scope: Scope, value?: any): void {
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
}

// tslint:disable-next-line:max-classes-per-file
class JsonNode {
    scope: Scope;
    value?: any;
}

enum Scope {
    ROOT,
    IN_OBJECT,
    IN_ARRAY,
}
