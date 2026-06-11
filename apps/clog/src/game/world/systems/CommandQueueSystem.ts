/**
 * CommandQueueSystem
 * Encapsulates command queue progression: starting next command, completing current, pausing/resuming.
 * Separated from WorldModel to isolate command mechanics.
 */

import { CommandListComponent } from '../../core/CommandListComponent';
import type {
    PlayerEntityCommandList,
    PlayerEntityCommandPayload,
    PlayerEntityCommandType,
    WorkerEntityCommandList,
    WorkerEntityCommandPayload,
    WorkerEntityCommandType,
    WorldEntity,
} from '../WorldModel';

export interface CommandQueueSystemContext {
    beginMoveWorkerTo(worker: WorldEntity, x: number, y: number): { ok: boolean };
    beginWorkerMining(worker: WorldEntity, x: number, y: number, repeat: boolean): { ok: boolean };
    beginRecallWorker(worker: WorldEntity): { ok: boolean };
    findOpenPath(fromX: number, fromY: number, toX: number, toY: number, maxSteps: number): Array<{ x: number; y: number }> | null;
    getTile(x: number, y: number): any | undefined;
    isEntityOccupied(x: number, y: number, ignoreEntityId?: string): boolean;
    ensureWorldContainsTile(x: number, y: number): void;
}

export class CommandQueueSystem {
    constructor(private context: CommandQueueSystemContext) { }

    /**
     * Attempt to start the next queued command for a worker.
     * Skips invalid commands and returns when a command starts successfully or queue is empty.
     */
    tryStartNextWorkerCommand(worker: WorldEntity): void {
        if (worker.movement || worker.mining) return;
        if (worker.commandsPaused) return;

        const commandList = new CommandListComponent<WorkerEntityCommandType, WorkerEntityCommandPayload>(
            worker.commandList as WorkerEntityCommandList ?? undefined
        );
        const state = commandList.snapshot();
        if (state.current) return;

        while (true) {
            const next = commandList.shiftNext();
            if (!next) {
                // Update worker entity with cleared current
                worker.commandList = commandList.snapshot();
                return;
            }

            let result: { ok: boolean };
            if (next.type === 'move') {
                if (!Number.isFinite(next.payload.x) || !Number.isFinite(next.payload.y)) {
                    result = { ok: false };
                } else {
                    result = this.context.beginMoveWorkerTo(worker, Number(next.payload.x), Number(next.payload.y));
                }
            } else if (next.type === 'mine') {
                if (!Number.isFinite(next.payload.x) || !Number.isFinite(next.payload.y)) {
                    result = { ok: false };
                } else {
                    result = this.context.beginWorkerMining(
                        worker,
                        Number(next.payload.x),
                        Number(next.payload.y),
                        next.payload.repeat !== false
                    );
                }
            } else {
                result = this.context.beginRecallWorker(worker);
            }

            if (result.ok) {
                worker.commandList = commandList.snapshot();
                return;
            }

            commandList.completeCurrent();
        }
    }

    /**
     * Attempt to start the next queued command for the player.
     * Skips invalid commands and returns when a command starts successfully or queue is empty.
     */
    tryStartNextPlayerCommand(player: WorldEntity): void {
        if (player.movement) return;
        if (player.commandsPaused) return;

        const commandList = new CommandListComponent<PlayerEntityCommandType, PlayerEntityCommandPayload>(
            player.commandList as PlayerEntityCommandList ?? undefined
        );
        const state = commandList.snapshot();
        if (state.current) return;

        while (true) {
            const next = commandList.shiftNext();
            if (!next) {
                player.commandList = commandList.snapshot();
                return;
            }

            if (next.type !== 'move' || !Number.isFinite(next.payload.x) || !Number.isFinite(next.payload.y)) {
                commandList.completeCurrent();
                continue;
            }

            const tx = Number(next.payload.x);
            const ty = Number(next.payload.y);

            this.context.ensureWorldContainsTile(tx, ty);
            const tile = this.context.getTile(tx, ty);
            if (!tile || tile.solid || tile.visibility === 'Unknown' || this.context.isEntityOccupied(tx, ty, player.id)) {
                commandList.completeCurrent();
                continue;
            }

            const path = this.context.findOpenPath(player.x, player.y, tx, ty, 20000);
            if (!path || path.length <= 1) {
                commandList.completeCurrent();
                continue;
            }

            player.movement = { path, stepIndex: 1, progress: 0, mode: 'move' };
            player.commandList = commandList.snapshot();
            return;
        }
    }

    /**
     * Complete the current command and prepare for next.
     */
    completeCurrentWorkerCommand(worker: WorldEntity): void {
        const commandList = new CommandListComponent<WorkerEntityCommandType, WorkerEntityCommandPayload>(
            worker.commandList as WorkerEntityCommandList ?? undefined
        );
        commandList.completeCurrent();
        worker.commandList = commandList.snapshot();
    }

    /**
     * Complete the current command and prepare for next.
     */
    completeCurrentPlayerCommand(player: WorldEntity): void {
        const commandList = new CommandListComponent<PlayerEntityCommandType, PlayerEntityCommandPayload>(
            player.commandList as PlayerEntityCommandList ?? undefined
        );
        commandList.completeCurrent();
        player.commandList = commandList.snapshot();
    }
}
