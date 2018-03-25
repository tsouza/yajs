import { Stack } from '../utils/Stack';

export abstract class AbstractObjectBuilder extends Stack<IJsonNode> {

    fieldName?: string;

    /*private stack: IJsonNode[];
    private stackSize: number = 0;
    private top: IJsonNode;
    private topDirty: boolean;*/

    constructor() {
        // this.stack = [];
        super();
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

    /*peek(): IJsonNode {
        if (this.topDirty) {
            this.top = this.stack[this.stackSize - 1];
            this.topDirty = false;
        }
        return this.top;
    }*/

    protected doEndObject(): void {
        this.pop();
    }

    protected doEndArray(): void {
        this.pop();
    }

    /*private pop(): void {
        this.stackSize--;
        this.topDirty = true;
    }

    private push(node: IJsonNode): void {
         this.stack[this.stackSize++] = this.top = node;
         this.topDirty = false;
    }*/
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
        // const fieldName = builder.fieldName;
        // if (fieldName) {
            this.value[builder.fieldName] = value;
        //    builder.fieldName = undefined;
        // }
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
