import type { GameCommand, GameEvent } from './protocol';
import type { InventoryState } from '../inventory/InventoryModel';
import { ToolComponent } from './ToolComponent';
import { WorldModel } from '../world/WorldModel';
import { addInventoryItem, getTotalResourceCount, deductResource } from '../inventory/InventoryModel';

const BEACON_ORE_COST = 10;
const BEACON_DELETE_REFUND_ORE = Math.floor(BEACON_ORE_COST * 0.5);

export class GameSimulation {
    readonly world: WorldModel;
    readonly mainPlayerEntityId: string;
    private readonly mainPlayerTools: ToolComponent;
    private mainPlayerInventory: InventoryState | null = null;

    get tools(): ToolComponent {
        return this.mainPlayerTools;
    }

    get inventory(): InventoryState | null {
        return this.mainPlayerInventory;
    }

    set inventory(state: InventoryState | null) {
        this.mainPlayerInventory = state;
    }

    constructor(world?: WorldModel) {
        this.world = world ?? new WorldModel();
        this.mainPlayerEntityId = this.world.getMainPlayerEntityId();
        this.mainPlayerTools = new ToolComponent();
    }

    execute(command: GameCommand): GameEvent[] {
        const normalizeWorkerReason = (
            reason: 'not_found' | 'not_worker' | 'invalid_building' | 'already_deployed' | 'already_recalled' | 'no_deploy_space' | 'invalid_target' | 'path_blocked' | 'not_movable' | 'not_miner',
        ): 'not_found' | 'not_worker' | 'invalid_building' | 'already_deployed' | 'already_recalled' | 'no_deploy_space' | 'invalid_target' | 'path_blocked' => {
            if (reason === 'not_movable' || reason === 'not_miner') {
                return 'invalid_target';
            }
            return reason;
        };

        if (command.type === 'MineTile') {
            const tool = this.mainPlayerTools.getActiveTool();
            if (command.trigger === 'click' && !tool.hitOnClick) return [];
            if (command.trigger === 'hold' && !tool.hitOnHold) return [];

            const hits = this.world.mineWithTool(
                command.x,
                command.y,
                tool.tileDamage,
                tool.damageMode,
                tool.bluntRadius,
            );
            if (hits.length === 0) {
                if (this.world.revealFromEmptyClick(command.x, command.y)) {
                    return [{ type: 'WorldChunkDirty', keys: this.world.getDirtyChunkKeys() }];
                }
                return [];
            }

            return [
                { type: 'TileDamaged', hits },
                { type: 'TileMined', x: command.x, y: command.y },
                { type: 'WorldChunkDirty', keys: this.world.getDirtyChunkKeys() },
            ];
        }

        if (command.type === 'MovePlayer') {
            const directMove = this.world.moveMainPlayerTo(command.x, command.y);
            let movedPlayer = directMove.ok ? directMove.player : null;
            if (!movedPlayer) {
                // If exact target is blocked (for example base center occupied),
                // try nearby tiles so movement orders still succeed.
                for (let radius = 1; radius <= 12 && !movedPlayer; radius++) {
                    for (let dy = -radius; dy <= radius && !movedPlayer; dy++) {
                        for (let dx = -radius; dx <= radius; dx++) {
                            if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
                            const next = this.world.moveMainPlayerTo(command.x + dx, command.y + dy);
                            if (next.ok) {
                                movedPlayer = next.player;
                                break;
                            }
                        }
                    }
                }

                if (!movedPlayer) {
                    return [];
                }
            }
            return [
                { type: 'PlayerMoved', x: movedPlayer.x, y: movedPlayer.y },
                { type: 'WorldChunkDirty', keys: this.world.getDirtyChunkKeys() },
            ];
        }

        if (command.type === 'MinePlayer') {
            const result = this.world.startPlayerMining(command.x, command.y);
            if (!result.ok) return [];
            return [
                { type: 'PlayerMiningStarted', x: command.x, y: command.y },
                { type: 'WorldChunkDirty', keys: this.world.getDirtyChunkKeys() },
            ];
        }

        if (command.type === 'GenerateWorld') {
            this.world.reset(command.seed);
            return [
                { type: 'WorldGenerated', seed: command.seed },
                { type: 'WorldChunkDirty', keys: this.world.getDirtyChunkKeys() },
            ];
        }

        if (command.type === 'LoadWorldSnapshot') {
            this.world.applySnapshot(command.snapshot);
            return [
                { type: 'WorldGenerated', seed: this.world.getSeed() },
                { type: 'WorldChunkDirty', keys: this.world.getDirtyChunkKeys() },
            ];
        }

        if (command.type === 'PlaceBeacon') {
            if (this.inventory) {
                const oreCount = getTotalResourceCount(this.inventory, 'debug-asteroid-ore');
                if (oreCount < BEACON_ORE_COST) {
                    return [
                        {
                            type: 'EntityPlacementFailed',
                            entityType: 'beacon',
                            x: command.x,
                            y: command.y,
                            reason: 'insufficient_ore',
                        },
                    ];
                }
            }

            const placed = this.world.placeBeacon(command.x, command.y, command.builderEntityId);
            if (!placed) {
                const reason = this.world.getBeaconPlacementFailureReason(command.x, command.y, command.builderEntityId);
                return [
                    {
                        type: 'EntityPlacementFailed',
                        entityType: 'beacon',
                        x: command.x,
                        y: command.y,
                        reason,
                    },
                ];
            }

            if (this.inventory) {
                deductResource(this.inventory, 'debug-asteroid-ore', BEACON_ORE_COST);
            }

            return [
                {
                    type: 'EntityPlaced',
                    id: placed.id,
                    entityType: 'beacon',
                    x: placed.x,
                    y: placed.y,
                    parentId: placed.parentId,
                },
                { type: 'WorldChunkDirty', keys: this.world.getDirtyChunkKeys() },
            ];
        }

        if (command.type === 'RemoveBeacon') {
            const removed = this.world.removeBeaconByEntityId(command.entityId);
            if (!removed.ok) {
                return [
                    {
                        type: 'EntityRemovalFailed',
                        id: command.entityId,
                        entityType: 'beacon',
                        reason: removed.reason,
                    },
                ];
            }

            let refundOre = 0;
            if (this.inventory) {
                refundOre = addInventoryItem(this.inventory, 'debug-asteroid-ore', BEACON_DELETE_REFUND_ORE);
            }

            return [
                {
                    type: 'EntityRemoved',
                    id: command.entityId,
                    entityType: 'beacon',
                    x: removed.beacon.x,
                    y: removed.beacon.y,
                    refundOre,
                },
                { type: 'WorldChunkDirty', keys: this.world.getDirtyChunkKeys() },
            ];
        }

        if (command.type === 'SpawnUnit') {
            const spawned = this.world.spawnUnitAtBuilding(command.buildingId, command.unitType);
            if (!spawned.ok) {
                return [{ type: 'WorkerActionFailed', action: 'spawn', id: command.buildingId, reason: spawned.reason }];
            }

            return [
                {
                    type: 'WorkerSpawned',
                    workerId: spawned.worker.id,
                    buildingId: command.buildingId,
                    unitType: spawned.worker.unitType ?? 'basic-worker',
                },
                { type: 'WorldChunkDirty', keys: this.world.getDirtyChunkKeys() },
            ];
        }

        if (command.type === 'DeployWorker') {
            const deployed = this.world.deployWorker(command.workerId);
            if (!deployed.ok) {
                return [{ type: 'WorkerActionFailed', action: 'deploy', id: command.workerId, reason: deployed.reason }];
            }

            return [
                {
                    type: 'WorkerDeployed',
                    workerId: deployed.worker.id,
                    buildingId: deployed.worker.homeId ?? 'entity-base',
                    x: deployed.worker.x,
                    y: deployed.worker.y,
                },
                { type: 'WorldChunkDirty', keys: this.world.getDirtyChunkKeys() },
            ];
        }

        if (command.type === 'RecallWorker') {
            const recalled = this.world.recallWorker(command.workerId);
            if (!recalled.ok) {
                return [{ type: 'WorkerActionFailed', action: 'recall', id: command.workerId, reason: recalled.reason }];
            }

            return [
                {
                    type: 'WorkerRecalled',
                    workerId: recalled.worker.id,
                    buildingId: recalled.worker.homeId ?? 'entity-base',
                },
                { type: 'WorldChunkDirty', keys: this.world.getDirtyChunkKeys() },
            ];
        }

        if (command.type === 'RecallWorkers') {
            const recalled = this.world.recallWorkersForBuilding(command.buildingId);
            if (!recalled.ok) {
                return [{ type: 'WorkerActionFailed', action: 'recall_all', id: command.buildingId, reason: recalled.reason }];
            }

            return [
                {
                    type: 'WorkersRecalled',
                    buildingId: command.buildingId,
                    count: recalled.count,
                },
                { type: 'WorldChunkDirty', keys: this.world.getDirtyChunkKeys() },
            ];
        }

        if (command.type === 'MoveWorker') {
            const moved = this.world.moveWorkerTo(command.workerId, command.x, command.y);
            if (!moved.ok) {
                return [{ type: 'WorkerActionFailed', action: 'move', id: command.workerId, reason: moved.reason }];
            }

            return [
                {
                    type: 'WorkerMoved',
                    workerId: moved.worker.id,
                    x: command.x,
                    y: command.y,
                },
                { type: 'WorldChunkDirty', keys: this.world.getDirtyChunkKeys() },
            ];
        }

        if (command.type === 'MineWorker') {
            const started = this.world.startWorkerMining(command.workerId, command.x, command.y, command.repeat ?? true);
            if (!started.ok) {
                return [{ type: 'WorkerActionFailed', action: 'mine', id: command.workerId, reason: started.reason }];
            }

            return [
                {
                    type: 'WorkerMiningStarted',
                    workerId: started.worker.id,
                    x: command.x,
                    y: command.y,
                },
                { type: 'WorldChunkDirty', keys: this.world.getDirtyChunkKeys() },
            ];
        }

        if (command.type === 'MoveEntity') {
            const entity = this.world.getEntityById(command.entityId);
            if (!entity) { return []; }
            const moved = this.world.moveEntityTo(command.entityId, command.x, command.y);
            if (!moved.ok) {
                if (entity.kind === 'worker') {
                    return [{ type: 'WorkerActionFailed', action: 'move', id: command.entityId, reason: normalizeWorkerReason(moved.reason) }];
                }
                return [];
            }

            if (entity.kind === 'worker') {
                return [
                    { type: 'WorkerMoved', workerId: command.entityId, x: command.x, y: command.y },
                    { type: 'WorldChunkDirty', keys: this.world.getDirtyChunkKeys() },
                ];
            }

            if (entity.kind === 'player') {
                return [
                    { type: 'PlayerMoved', x: moved.entity.x, y: moved.entity.y },
                    { type: 'WorldChunkDirty', keys: this.world.getDirtyChunkKeys() },
                ];
            }

            return [{ type: 'WorldChunkDirty', keys: this.world.getDirtyChunkKeys() }];
        }

        if (command.type === 'MineEntity') {
            const entity = this.world.getEntityById(command.entityId);
            if (!entity) { return []; }
            const started = this.world.startEntityMining(command.entityId, command.x, command.y, command.repeat ?? true);
            if (!started.ok) {
                if (entity.kind === 'worker') {
                    return [{ type: 'WorkerActionFailed', action: 'mine', id: command.entityId, reason: normalizeWorkerReason(started.reason) }];
                }
                return [];
            }

            if (entity.kind === 'worker') {
                return [
                    { type: 'WorkerMiningStarted', workerId: command.entityId, x: command.x, y: command.y },
                    { type: 'WorldChunkDirty', keys: this.world.getDirtyChunkKeys() },
                ];
            }

            if (entity.kind === 'player') {
                return [
                    { type: 'PlayerMiningStarted', x: command.x, y: command.y },
                    { type: 'WorldChunkDirty', keys: this.world.getDirtyChunkKeys() },
                ];
            }

            return [{ type: 'WorldChunkDirty', keys: this.world.getDirtyChunkKeys() }];
        }

        if (command.type === 'InterruptWorkerCommand') {
            const interrupted = this.world.interruptWorkerCommand(command.workerId);
            if (!interrupted.ok) {
                return [{ type: 'WorkerActionFailed', action: 'interrupt', id: command.workerId, reason: interrupted.reason }];
            }

            return [
                {
                    type: 'WorkerCommandInterrupted',
                    workerId: command.workerId,
                },
                { type: 'WorldChunkDirty', keys: this.world.getDirtyChunkKeys() },
            ];
        }

        if (command.type === 'ClearWorkerCommands') {
            const cleared = this.world.clearWorkerCommands(command.workerId);
            if (!cleared.ok) {
                return [{ type: 'WorkerActionFailed', action: 'clear_commands', id: command.workerId, reason: cleared.reason }];
            }

            return [
                {
                    type: 'WorkerCommandsCleared',
                    workerId: command.workerId,
                },
                { type: 'WorldChunkDirty', keys: this.world.getDirtyChunkKeys() },
            ];
        }

        if (command.type === 'RemoveQueuedWorkerCommand') {
            const removed = this.world.removeQueuedWorkerCommand(command.workerId, command.commandId);
            if (!removed.ok) {
                return [{ type: 'WorkerActionFailed', action: 'remove_queued', id: command.workerId, reason: removed.reason }];
            }

            return [
                {
                    type: 'WorkerQueuedCommandRemoved',
                    workerId: command.workerId,
                    commandId: command.commandId,
                },
                { type: 'WorldChunkDirty', keys: this.world.getDirtyChunkKeys() },
            ];
        }


        if (command.type === 'RemoveQueuedPlayerCommand') {
            const removed = this.world.removeQueuedPlayerCommand(command.commandId);
            if (!removed.ok) return [];
            return [
                { type: 'PlayerQueuedCommandRemoved', commandId: command.commandId },
                { type: 'WorldChunkDirty', keys: this.world.getDirtyChunkKeys() },
            ];
        }

        if (command.type === 'InterruptPlayerCommand') {
            const result = this.world.interruptPlayerCommand();
            if (!result.ok) return [];
            return [
                { type: 'PlayerCommandInterrupted' },
                { type: 'WorldChunkDirty', keys: this.world.getDirtyChunkKeys() },
            ];
        }

        if (command.type === 'ClearPlayerCommands') {
            const result = this.world.clearPlayerCommands();
            if (!result.ok) return [];
            return [
                { type: 'PlayerCommandsCleared' },
                { type: 'WorldChunkDirty', keys: this.world.getDirtyChunkKeys() },
            ];
        }

        if (command.type === 'PauseWorkerCommands') {
            const result = this.world.pauseWorkerCommands(command.workerId);
            if (!result.ok) return [{ type: 'WorkerActionFailed', action: 'pause', id: command.workerId, reason: result.reason }];
            return [
                { type: 'WorkerCommandsPaused', workerId: command.workerId },
                { type: 'WorldChunkDirty', keys: this.world.getDirtyChunkKeys() },
            ];
        }

        if (command.type === 'ResumeWorkerCommands') {
            const result = this.world.resumeWorkerCommands(command.workerId);
            if (!result.ok) return [{ type: 'WorkerActionFailed', action: 'resume', id: command.workerId, reason: result.reason }];
            return [
                { type: 'WorkerCommandsResumed', workerId: command.workerId },
                { type: 'WorldChunkDirty', keys: this.world.getDirtyChunkKeys() },
            ];
        }

        if (command.type === 'PausePlayerCommands') {
            const result = this.world.pausePlayerCommands();
            if (!result.ok) return [];
            return [
                { type: 'PlayerCommandsPaused' },
                { type: 'WorldChunkDirty', keys: this.world.getDirtyChunkKeys() },
            ];
        }

        if (command.type === 'ResumePlayerCommands') {
            const result = this.world.resumePlayerCommands();
            if (!result.ok) return [];
            return [
                { type: 'PlayerCommandsResumed' },
                { type: 'WorldChunkDirty', keys: this.world.getDirtyChunkKeys() },
            ];
        }

        return [];
    }
}
