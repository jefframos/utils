export type CommandEnvelope<TType extends string, TPayload extends object = object> = {
    id: string;
    type: TType;
    payload: TPayload;
    createdAtMs: number;
};

export type CommandListState<TType extends string, TPayload extends object = object> = {
    nextId: number;
    current: CommandEnvelope<TType, TPayload> | null;
    queue: Array<CommandEnvelope<TType, TPayload>>;
};

export type EnqueueMode = 'append' | 'replace';

export class CommandListComponent<TType extends string, TPayload extends object = object> {
    private readonly state: CommandListState<TType, TPayload>;

    constructor(initial?: Partial<CommandListState<TType, TPayload>>) {
        this.state = {
            nextId: Math.max(1, Math.trunc(initial?.nextId ?? 1)),
            current: initial?.current ?? null,
            queue: initial?.queue ? [...initial.queue] : [],
        };
    }

    static createEmpty<TType extends string, TPayload extends object = object>(): CommandListState<TType, TPayload> {
        return { nextId: 1, current: null, queue: [] };
    }

    enqueue(type: TType, payload: TPayload, mode: EnqueueMode = 'append'): CommandEnvelope<TType, TPayload> {
        if (mode === 'replace') {
            this.state.current = null;
            this.state.queue.length = 0;
        }

        const command: CommandEnvelope<TType, TPayload> = {
            id: `cmd-${this.state.nextId++}`,
            type,
            payload,
            createdAtMs: Date.now(),
        };
        this.state.queue.push(command);
        return command;
    }

    setCurrent(command: CommandEnvelope<TType, TPayload> | null): void {
        this.state.current = command;
    }

    shiftNext(): CommandEnvelope<TType, TPayload> | null {
        const next = this.state.queue.shift() ?? null;
        this.state.current = next;
        return next;
    }

    interruptCurrent(): CommandEnvelope<TType, TPayload> | null {
        const interrupted = this.state.current;
        this.state.current = null;
        return interrupted;
    }

    completeCurrent(): CommandEnvelope<TType, TPayload> | null {
        const completed = this.state.current;
        this.state.current = null;
        return completed;
    }

    removeQueued(commandId: string): boolean {
        const index = this.state.queue.findIndex((entry) => entry.id === commandId);
        if (index < 0) return false;
        this.state.queue.splice(index, 1);
        return true;
    }

    clearAll(): void {
        this.state.current = null;
        this.state.queue.length = 0;
    }

    snapshot(): CommandListState<TType, TPayload> {
        return {
            nextId: this.state.nextId,
            current: this.state.current ? { ...this.state.current } : null,
            queue: this.state.queue.map((entry) => ({ ...entry })),
        };
    }
}
