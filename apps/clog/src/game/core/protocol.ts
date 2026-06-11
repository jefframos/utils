import type { WorldSnapshot } from '../world/WorldModel';

export type MineTileCommand = {
    type: 'MineTile';
    x: number;
    y: number;
    trigger: 'click' | 'hold';
};

export type GenerateWorldCommand = {
    type: 'GenerateWorld';
    seed: number;
};

export type LoadWorldSnapshotCommand = {
    type: 'LoadWorldSnapshot';
    snapshot: WorldSnapshot;
};

export type PlaceBeaconCommand = {
    type: 'PlaceBeacon';
    x: number;
    y: number;
    builderEntityId?: string;
};

export type RemoveBeaconCommand = {
    type: 'RemoveBeacon';
    entityId: string;
};

export type SpawnWorkerCommand = {
    type: 'SpawnWorker';
    buildingId: string;
};

export type DeployWorkerCommand = {
    type: 'DeployWorker';
    workerId: string;
};

export type RecallWorkerCommand = {
    type: 'RecallWorker';
    workerId: string;
};

export type RecallWorkersCommand = {
    type: 'RecallWorkers';
    buildingId: string;
};

export type MoveWorkerCommand = {
    type: 'MoveWorker';
    workerId: string;
    x: number;
    y: number;
};

export type MovePlayerCommand = {
    type: 'MovePlayer';
    x: number;
    y: number;
};

export type MineWorkerCommand = {
    type: 'MineWorker';
    workerId: string;
    x: number;
    y: number;
    repeat?: boolean;
};

export type InterruptWorkerCommand = {
    type: 'InterruptWorkerCommand';
    workerId: string;
};

export type ClearWorkerCommandsCommand = {
    type: 'ClearWorkerCommands';
    workerId: string;
};

export type RemoveQueuedWorkerCommand = {
    type: 'RemoveQueuedWorkerCommand';
    workerId: string;
    commandId: string;
};

export type RemoveQueuedPlayerCommand = {
    type: 'RemoveQueuedPlayerCommand';
    commandId: string;
};

export type InterruptPlayerCommand = {
    type: 'InterruptPlayerCommand';
};

export type ClearPlayerCommandsCommand = {
    type: 'ClearPlayerCommands';
};

export type PauseWorkerCommandsCommand = {
    type: 'PauseWorkerCommands';
    workerId: string;
};

export type ResumeWorkerCommandsCommand = {
    type: 'ResumeWorkerCommands';
    workerId: string;
};

export type PausePlayerCommandsCommand = {
    type: 'PausePlayerCommands';
};

export type ResumePlayerCommandsCommand = {
    type: 'ResumePlayerCommands';
};

export type GameCommand =
    | MineTileCommand
    | GenerateWorldCommand
    | LoadWorldSnapshotCommand
    | PlaceBeaconCommand
    | RemoveBeaconCommand
    | SpawnWorkerCommand
    | DeployWorkerCommand
    | RecallWorkerCommand
    | RecallWorkersCommand
    | MoveWorkerCommand
    | MovePlayerCommand
    | MineWorkerCommand
    | InterruptWorkerCommand
    | ClearWorkerCommandsCommand
    | RemoveQueuedWorkerCommand
    | RemoveQueuedPlayerCommand
    | InterruptPlayerCommand
    | ClearPlayerCommandsCommand
    | PauseWorkerCommandsCommand
    | ResumeWorkerCommandsCommand
    | PausePlayerCommandsCommand
    | ResumePlayerCommandsCommand;

export type WorldChunkDirtyEvent = {
    type: 'WorldChunkDirty';
    keys: string[];
};

export type TileMinedEvent = {
    type: 'TileMined';
    x: number;
    y: number;
};

export type TileDamageHit = {
    x: number;
    y: number;
    damage: number;
    remainingHp: number;
    opened: boolean;
};

export type TileDamagedEvent = {
    type: 'TileDamaged';
    hits: TileDamageHit[];
};

export type WorldGeneratedEvent = {
    type: 'WorldGenerated';
    seed: number;
};

export type EntityPlacedEvent = {
    type: 'EntityPlaced';
    id: string;
    entityType: 'beacon';
    x: number;
    y: number;
    parentId: string | null;
};

export type EntityPlacementFailedEvent = {
    type: 'EntityPlacementFailed';
    entityType: 'beacon';
    x: number;
    y: number;
    reason: 'too_far' | 'not_open' | 'already_exists' | 'unknown_tile' | 'insufficient_ore' | 'not_builder';
};

export type EntityRemovedEvent = {
    type: 'EntityRemoved';
    id: string;
    entityType: 'beacon';
    x: number;
    y: number;
    refundOre: number;
};

export type EntityRemovalFailedEvent = {
    type: 'EntityRemovalFailed';
    id: string;
    entityType: 'beacon';
    reason: 'not_found' | 'not_beacon';
};

export type WorkerSpawnedEvent = {
    type: 'WorkerSpawned';
    workerId: string;
    buildingId: string;
    unitType: 'basic-worker';
};

export type WorkerDeployedEvent = {
    type: 'WorkerDeployed';
    workerId: string;
    buildingId: string;
    x: number;
    y: number;
};

export type WorkerRecalledEvent = {
    type: 'WorkerRecalled';
    workerId: string;
    buildingId: string;
};

export type WorkerMovedEvent = {
    type: 'WorkerMoved';
    workerId: string;
    x: number;
    y: number;
};

export type PlayerMovedEvent = {
    type: 'PlayerMoved';
    x: number;
    y: number;
};

export type WorkerMiningStartedEvent = {
    type: 'WorkerMiningStarted';
    workerId: string;
    x: number;
    y: number;
};

export type WorkerCommandInterruptedEvent = {
    type: 'WorkerCommandInterrupted';
    workerId: string;
};

export type WorkerCommandsClearedEvent = {
    type: 'WorkerCommandsCleared';
    workerId: string;
};

export type WorkerQueuedCommandRemovedEvent = {
    type: 'WorkerQueuedCommandRemoved';
    workerId: string;
    commandId: string;
};

export type PlayerQueuedCommandRemovedEvent = {
    type: 'PlayerQueuedCommandRemoved';
    commandId: string;
};

export type WorkersRecalledEvent = {
    type: 'WorkersRecalled';
    buildingId: string;
    count: number;
};

export type WorkerActionFailedEvent = {
    type: 'WorkerActionFailed';
    action: 'spawn' | 'deploy' | 'recall' | 'recall_all' | 'move' | 'mine' | 'interrupt' | 'clear_commands' | 'remove_queued' | 'pause' | 'resume';
    id: string;
    reason: 'not_found' | 'not_worker' | 'invalid_building' | 'already_deployed' | 'already_recalled' | 'no_deploy_space' | 'invalid_target' | 'path_blocked';
};

export type GameEvent =
    | WorldChunkDirtyEvent
    | TileMinedEvent
    | TileDamagedEvent
    | WorldGeneratedEvent
    | EntityPlacedEvent
    | EntityPlacementFailedEvent
    | EntityRemovedEvent
    | EntityRemovalFailedEvent
    | WorkerSpawnedEvent
    | WorkerDeployedEvent
    | WorkerRecalledEvent
    | WorkerMovedEvent
    | PlayerMovedEvent
    | WorkerMiningStartedEvent
    | WorkerCommandInterruptedEvent
    | WorkerCommandsClearedEvent
    | WorkerQueuedCommandRemovedEvent
    | PlayerQueuedCommandRemovedEvent
    | WorkersRecalledEvent
    | WorkerActionFailedEvent
    | WorkerCommandsPausedEvent
    | WorkerCommandsResumedEvent
    | PlayerCommandInterruptedEvent
    | PlayerCommandsClearedEvent
    | PlayerCommandsPausedEvent
    | PlayerCommandsResumedEvent;

export type WorkerCommandsPausedEvent = {
    type: 'WorkerCommandsPaused';
    workerId: string;
};

export type WorkerCommandsResumedEvent = {
    type: 'WorkerCommandsResumed';
    workerId: string;
};

export type PlayerCommandInterruptedEvent = {
    type: 'PlayerCommandInterrupted';
};

export type PlayerCommandsClearedEvent = {
    type: 'PlayerCommandsCleared';
};

export type PlayerCommandsPausedEvent = {
    type: 'PlayerCommandsPaused';
};

export type PlayerCommandsResumedEvent = {
    type: 'PlayerCommandsResumed';
};

export interface GameTransport {
    send(command: GameCommand): void;
    onEvent(callback: (event: GameEvent) => void): () => void;
}
