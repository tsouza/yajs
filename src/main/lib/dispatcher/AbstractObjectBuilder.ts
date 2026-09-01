import { Stack } from '../utils/Stack';

export abstract class AbstractObjectBuilder {

    fieldName?: string;
    private mStack = new Stack<IJsonNode>();
    private mDropKeys: any = Object.create(null);
    private mDrop;

    constructor() {
        this.push(new RootNode());
    }

    set dropKeys(dropKeys: string[]) {
        this.mDropKeys = (dropKeys || []).reduce((obj, val) => {
            obj[val] = true;
            return obj;
        }, Object.create(null));
    }

    startObject(): void {
        const newObject = {};
        this.onValue(newObject);
        this.pushNode(newObject, false);
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
        this.pushNode(newArray, true);
    }

    // Pushes an ObjectNode/ArrayNode for the container just opened, reusing
    // the wrapper left in the stack slot by a previously closed sibling of
    // the same kind (mirroring StreamPosition.stepInto()'s slot reuse)
    // instead of allocating a fresh wrapper per container - the wrapper is
    // pure builder bookkeeping, only its .value (the actual output object/
    // array) differs per container.
    private pushNode(value: any, isArray: boolean): void {
        if (this.mStack.hasPreviousPeek()) {
            const previous = this.mStack.previousPeek();
            if ((previous instanceof ArrayNode) === isArray && !previous.root) {
                previous.value = value;
                this.mStack.size++;
                this.mStack.top = previous;
                return;
            }
        }
        this.push(isArray ? new ArrayNode(value) : new ObjectNode(value));
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

    // Returns this builder to its just-constructed state (empty root, no
    // pending field name, no active drop) so a completed dispatcher can be
    // reused for a later match instead of allocating a fresh one per match
    // (listener/projection/dropKeys configuration is per-selector, not
    // per-match, so it survives reuse untouched). The node stack is truncated
    // to a fresh root rather than merely rewound so the pooled instance
    // doesn't retain references to the previously emitted value.
    resetForReuse(): void {
        this.fieldName = undefined;
        this.mDrop = false;
        const stack = this.mStack.stack;
        // Keep the wrapper slots (slot 0 is always the RootNode - nothing
        // ever replaces it - and the ones above feed pushNode()'s reuse),
        // but clear every wrapper's .value so a pooled dispatcher doesn't
        // retain the previously emitted subtree.
        for (let i = 0; i < stack.length; i++) {
            stack[i].value = undefined;
        }
        this.mStack.top = undefined;
        if (stack.length > 0) {
            this.mStack.size = 1;
        } else {
            this.mStack.size = 0;
            this.push(new RootNode());
        }
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
        // "__proto__" is the single own-key name that plain assignment cannot
        // create: it routes through Object.prototype's inherited accessor and
        // would mutate this object's actual prototype chain instead. Every
        // other Object.prototype member (toString, constructor, ...) is a
        // plain data property, which assignment shadows with a real own
        // property just fine - so only "__proto__" needs the (much slower)
        // defineProperty route; the hot path stays a plain store.
        if (builder.fieldName === '__proto__') {
            Object.defineProperty(this.value, builder.fieldName, {
                value,
                writable: true,
                enumerable: true,
                configurable: true,
            });
        } else {
            this.value[builder.fieldName] = value;
        }
    }
}

// tslint:disable-next-line:max-classes-per-file
class ArrayNode implements IJsonNode {

    root = false;
    value?: any;

    constructor(value: any[]) {
        this.value = value;
    }

    handle(value: any): void {
        (this.value as any[]).push(value);
    }
}
