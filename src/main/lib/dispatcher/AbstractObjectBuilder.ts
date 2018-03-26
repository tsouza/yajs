import { Stack } from '../utils/Stack';

export abstract class AbstractObjectBuilder /*extends Stack<IJsonNode>*/ {

    fieldName?: string;
    private mStack = new Stack<IJsonNode>();

    constructor() {
        // super();
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
        return this.peek().root;
    }

    peek(): IJsonNode {
        return this.mStack.peek();
    }

    protected doEndObject(): void {
        this.pop();
    }

    protected doEndArray(): void {
        this.pop();
    }

    protected pop(): void {
        this.mStack.pop();
    }

    protected push(element: IJsonNode): void {
        this.mStack.push(element);
    }
}

interface IJsonNode {

     value?: any;
     root: boolean;

     handle(value: any, builder: AbstractObjectBuilder): void;
}

// tslint:disable-next-line:max-classes-per-file
class RootNode implements IJsonNode {

    root = true;
    value?: any;

    handle(value: any, builder: AbstractObjectBuilder): void {
        builder.peek().value = value;
    }
}

// tslint:disable-next-line:max-classes-per-file
class ObjectNode implements IJsonNode {

    root = false;
    value?: any;

    constructor(value: object) {
        this.value = value;
    }

    handle(value: any, builder: AbstractObjectBuilder): void {
        this.value[builder.fieldName] = value;
    }
}

// tslint:disable-next-line:max-classes-per-file
class ArrayNode implements IJsonNode {

    root = false;
    value?: any;

    constructor(value: any[]) {
        this.value = value;
    }

    handle(value: any, builder: AbstractObjectBuilder): void {
        (this.value as any[]).push(value);
    }
}
