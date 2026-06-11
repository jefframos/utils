/**
 * CommandQueueSystem
 * Unified entity command queue — any entity with a commandList can use the same methods.
 * There is no player/worker distinction here; entities are entities.
 */

import { CommandListComponent, type CommandListState } from '../../core/CommandListComponent';
import type { WorldEntity } from '../WorldModel';

type EntityCommandPayload = { x?: number; y?: number; repeat?: boolean };
type EntityCommandType = string;

export interface CommandQueueSystemContext {
    beginMoveEntityTo(entity: WorldEntity, x: number, y: number): { ok: boolean };
    beginEntityMining(entity: WorldEntity, x: number, y: number, repeat: boolean): { ok: boolean };
    beginRecallEntity(entity: WorldEntity): { ok: boolean };
    findOpenPath(fromX: number, fromY: number, toX: number, toY: number, maxSteps: number): Array<{ x: number; y: number }> | null;
    getTile(x: number, y: number): any | undefined;
    isEntityOccupied(x: number, y: number, ignoreEntityId?: string): boolean;
    ensureWorldContainsTile(x: number, y: number): void;
}

export class CommandQueueSystem {
    constructor(private context: CommandQueueSystemContext) { }

    /**
     * Start the next queued command for any entity.
     * Handles 'move', 'mine', and 'recall' based on entity capabilities.
     */
    tryStartNextEntityCommand(entity: WorldEntity): void {
        if (entity.movement || entity.mining) return;
        if (entity.commandsPaused) return;

        const commandList = new CommandListComponent<EntityCommandType, EntityCommandPayload>(
            entity.commandList as CommandListState<EntityCommandType, EntityCommandPayload> ?? undefined,
        );
        if (commandList.snapshot().current) return;

        while (true) {
            const next = commandList.shiftNext();
            if (!next) {
                entity.commandList = commandList.snapshot() as unknown as typeof entity.commandList;
                return;
            }

            let result: { ok: boolean };
            if (next.type === 'move') {
                if (!Number.isFinite(next.payload.x) || !Number.isFinite(next.payload.y)) {
                    result = { ok: false };
                } else {
                    result = this.context.beginMoveEntityTo(entity, Number(next.payload.x), Number(next.payload.y));
                }
            } else if (next.type === 'mine') {
                if (!Number.isFinite(next.payload.x) || !Number.isFinite(next.payload.y)) {
                    result = { ok: false };
                } else {
                    result = this.context.beginEntityMining(
                        entity,
                        Number(next.payload.x),
                        Number(next.payload.y),
                        next.payload.repeat !== false,
                    );
                }
            } else if (next.type === 'recall') {
                result = this.context.beginRecallEntity(entity);
            } else {
                result = { ok: false };
            }

            if (result.ok) {
                entity.commandList = commandList.snapshot() as unknown as typeof entity.commandList;
                return;
            }

            commandList.completeCurrent();
        }
    }

    /** Complete the active command on any entity and advance the queue. */
    completeCurrentEntityCommand(entity: WorldEntity): void {
        const commandList = new CommandListComponent<EntityCommandType, EntityCommandPayload>(
            entity.commandList as CommandListState<EntityCommandType, EntityCommandPayload> ?? undefined,
        );
        commandList.completeCurrent();
        entity.commandList = commandList.snapshot() as unknown as typeof entity.commandList;
    }

    // ---------------------------------------------------------------------------
    // Legacy aliases so existing WorldModel call-sites compile without change.
    // ---------------------------------------------------------------------------

    tryStartNextWorkerCommand(entity: WorldEntity): void { this.tryStartNextEntityCommand(entity); }
    tryStartNextPlayerCommand(entity: WorldEntity): void { this.tryStartNextEntityCommand(entity); }
    completeCurrentWorkerCommand(entity: WorldEntity): void { this.completeCurrentEntityCommand(entity); }
    completeCurrentPlayerCommand(entity: WorldEntity): void { this.completeCurrentEntityCommand(entity); }
}
