export class Stack<E> {

    stack: E[] = [];
    size: number = 0;
    top: E;
    protected previousTop: E;

    peek(): E {
        return this.top || (this.top = this.stack[this.size - 1]);
    }

    push(element: E): void {
        this.stack[this.size++] = this.top = element;
    }

    pop(): void {
        this.size--;
        this.top = undefined;
    }

    previousPeek(): E {
        return this.stack[this.size];
    }

    hasPreviousPeek(): boolean {
        return this.stack.length > this.size;
    }
}
