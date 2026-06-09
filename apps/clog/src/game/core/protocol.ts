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
};

export type GameCommand = MineTileCommand | GenerateWorldCommand | LoadWorldSnapshotCommand | PlaceBeaconCommand;

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

export type BeaconPlacedEvent = {
    type: 'BeaconPlaced';
    id: string;
    x: number;
    y: number;
    parentId: string | null;
};

export type BeaconPlacementFailedEvent = {
    type: 'BeaconPlacementFailed';
    x: number;
    y: number;
    reason: 'too_far' | 'not_open' | 'already_exists' | 'unknown_tile';
};

export type GameEvent = WorldChunkDirtyEvent | TileMinedEvent | TileDamagedEvent | WorldGeneratedEvent | BeaconPlacedEvent | BeaconPlacementFailedEvent;

export interface GameTransport {
    send(command: GameCommand): void;
    onEvent(callback: (event: GameEvent) => void): () => void;
}
