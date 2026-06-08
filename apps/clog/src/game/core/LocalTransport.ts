import { GameSimulation } from './GameSimulation';
import type { GameCommand, GameEvent, GameTransport } from './protocol';

export class LocalTransport implements GameTransport {
    private readonly listeners = new Set<(event: GameEvent) => void>();

    constructor(private readonly simulation: GameSimulation) { }

    send(command: GameCommand): void {
        const events = this.simulation.execute(command);
        for (const event of events) {
            for (const listener of this.listeners) {
                listener(event);
            }
        }
    }

    onEvent(callback: (event: GameEvent) => void): () => void {
        this.listeners.add(callback);
        return () => {
            this.listeners.delete(callback);
        };
    }
}
