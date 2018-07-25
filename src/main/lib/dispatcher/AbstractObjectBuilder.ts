import { Stack } from '../utils/Stack';

export abstract class AbstractObjectBuilder {

    fieldName?: string;
    private mStack = new Stack<IJsonNode>();
    private mDropKeys: any;
    private mDrop;

    constructor() {
        this.push(new RootNode());
    }

    set dropKeys(dropKeys: string[]) {
        this.mDropKeys = (dropKeys || []).reduce((obj, val) => {
            obj[val] = true;
            return obj;
        }, {});
    }

    startObject(): void {
        const newObject = {};
        this.onValue(newObject);
        this.push(new ObjectNode(newObject));
    }

    startObjectEntry(key: string): void {
        this.fieldName = key;
        if (this.mDropKeys[key] && this.mStack.size === 2) {
            this.mDrop = true;
        }
    }

    startArray(): void {
        const newArray = [];
        this.onValue(newArray);
        this.push(new ArrayNode(newArray));
    }

    onValue(value: any): void {
        if (this.mDrop) {
            if (this.mStack.size === 2) {
                this.mDrop = false;
            }
            return;
        }
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
        if (this.mDrop && this.mStack.size === 2) {
            this.mDrop = false;
        }
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
