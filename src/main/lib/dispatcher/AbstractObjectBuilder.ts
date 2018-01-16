const S_ROOT    = 0;
const S_ARRAY   = 1;
const S_OBJECT  = 2;

export abstract class AbstractObjectBuilder {

    fieldName?: string;

    private stack: IJsonNode[];
    private stackSize: number = 0;

    constructor() {
        this.stack = [];
        this.push(new RootNode());
    }

    startObject(): void {
        const newObject = {};
        this.peek().handle(newObject, this);
        this.push(new ObjectNode(newObject));
    }

   startObjectEntry(key: string): void {
        this.fieldName = key;
    }

    startArray(): void {
        const newArray = [];
        this.peek().handle(newArray, this);
        this.push(new ArrayNode(newArray));
    }

    onValue(value: any): void {
        this.peek().handle(value, this);
    }

    isInRoot(): boolean {
        return this.peek().scope === S_ROOT;
    }

    peek(): IJsonNode {
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

    private pop(): void {
        this.stackSize--;
    }

    private push(node: IJsonNode): void {
        this.stack[this.stackSize++] = node;
    }
 }

interface IJsonNode {
     scope: number;
     value?: any;

     handle(value: any, builder: AbstractObjectBuilder): void;
}

// tslint:disable-next-line:max-classes-per-file
class RootNode implements IJsonNode {

    readonly scope = S_ROOT;
    value?: any;

    handle(value: any, builder: AbstractObjectBuilder): void {
        builder.peek().value = value;
    }
}

// tslint:disable-next-line:max-classes-per-file
class ObjectNode implements IJsonNode {

    readonly scope = S_OBJECT;
    value?: any;

    constructor(value: object) {
        this.value = value;
    }

    handle(value: any, builder: AbstractObjectBuilder): void {
        const fieldName = builder.fieldName;
        if (fieldName) {
            this.value[fieldName] = value;
            builder.fieldName = undefined;
        }
    }
}

// tslint:disable-next-line:max-classes-per-file
class ArrayNode implements IJsonNode {

    readonly scope = S_ARRAY;
    value?: any;

    constructor(value: any[]) {
        this.value = value;
    }

    handle(value: any, builder: AbstractObjectBuilder): void {
        (this.value as any[]).push(value);
    }
}
