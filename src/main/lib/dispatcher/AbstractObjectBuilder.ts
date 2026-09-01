import { isEmpty } from 'lodash';
import { Stack } from '../utils/Stack';

export abstract class AbstractObjectBuilder {

    fieldName?: string;
    private mStack = new Stack<IJsonNode>();
    private mDropKeys: any = Object.create(null);
    private mDrop;

    // Issue #95's amended scope (project + drop-keys combined, gated on a
    // regex primitive - #96): when this dispatcher's project filter is ALSO
    // active (see ObjectDispatcher's override of deferDropKeysForCombinedProject()
    // below), a top-level dropped key can no longer be skipped-during-
    // construction the way standalone drop-keys always has been (see
    // startObjectEntry()/onValue() below) - the project gate must see the
    // matched object's FULL, undropped top-level key set (per #95's own
    // specified evaluation order: gate first against the complete object,
    // drop second), and a key that's never attached in the first place is
    // invisible to that gate. So in that one case, every key is always
    // fully attached, and the drop happens as a surgical post-processing
    // step instead (see ObjectDispatcher.dispatch()'s dropDeferredKeys()
    // call, run right after the gate passes and right before the listener
    // fires). Standalone drop-keys (the overwhelming common case - no
    // project active) is untouched: it keeps skipping construction of a
    // dropped subtree entirely, exactly as before.
    private mDeferDropKeys = false;

    constructor() {
        this.push(new RootNode());
    }

    set dropKeys(dropKeys: string[]) {
        this.mDropKeys = (dropKeys || []).reduce((obj, val) => {
            obj[val] = true;
            return obj;
        }, Object.create(null));
        this.mDeferDropKeys = !isEmpty(dropKeys) && this.deferDropKeysForCombinedProject();
    }

    // Overridden by ObjectDispatcher to report whether its project ({...})
    // filter is also active - see mDeferDropKeys's own comment above for
    // why that changes how drop-keys behaves during construction. Called
    // from the dropKeys setter above, always AFTER the subclass's own
    // constructor has finished running (dropKeys is only ever set on an
    // already-fully-constructed dispatcher - see StreamContext.ts), so an
    // override reading its own fields here always sees them initialized.
    protected deferDropKeysForCombinedProject(): boolean {
        return false;
    }

    // Issue #95: the post-processing counterpart to mDeferDropKeys above -
    // deletes this match's own top-level dropped keys from the finished
    // root object. A no-op whenever mDeferDropKeys was never set (either no
    // drop-keys at all, or standalone drop-keys, which already dropped its
    // keys during construction instead - see startObjectEntry()/onValue()).
    protected dropDeferredKeys(): void {
        if (!this.mDeferDropKeys) {
            return;
        }
        const result = this.peek().value;
        if (result && typeof result === 'object') {
            for (const key in this.mDropKeys) {
                if (Object.prototype.hasOwnProperty.call(result, key)) {
                    delete result[key];
                }
            }
        }
    }

    startObject(): void {
        const newObject = {};
        this.onValue(newObject);
        this.pushNode(newObject, false);
    }

    startObjectEntry(key: string): void {
        this.fieldName = key;
        if (!this.mDeferDropKeys && this.mDropKeys[key] && this.mStack.size === 2) {
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
