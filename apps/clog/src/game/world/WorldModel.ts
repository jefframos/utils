import { BASE_START_X, BASE_START_Y, CHUNK_SIZE, GAME_RULES, WORLD_HEIGHT, WORLD_WIDTH } from '../config';
import { BIOME_DEFINITIONS } from '../content/biomes';
import { getEntityDefinition, type EntitySizeDef, type EntityViewDef } from '../content/entities.ts';
import { getToolDefinition } from '../content/tools.ts';
import { carveOpen, createHiddenSpaceTile, createSolidTile, damageTile } from '../content/tiles';
import { getWorkerDefinition, type WorkerUnitType } from '../content/workers';
import { CommandListComponent, type CommandListState, type EnqueueMode } from '../core/CommandListComponent';
import type { TileDamageHit } from '../core/protocol.ts';
import type { Tile, VisibilityState } from '../types';
import {
    chooseBiomeForPosition,
    getSpaceAreaTypeAtPosition,
    shouldGenerateAsteroidBody,
    surfaceNoise,
    type SpaceAreaType,
} from './noise';
import { ScanNearestBehavior, type ScanNearestPlan } from './behaviors/ScanNearestBehavior';
import type { WorldViewportRect } from '../camera/GameCamera';
import { getDropDefinitionIdForBiome } from '../bootstrap/storage';

export type SavedTile = {
    x: number;
    y: number;
    solid: boolean;
    hp: number;
    visibility: VisibilityState;
};

export type WorldEntityKind = 'base' | 'beacon' | 'worker' | 'player';
export type WorldEntityMobility = 'static' | 'dynamic';
export type { WorkerUnitType } from '../content/workers';

export type { EntitySizeDef, EntityViewDef } from '../content/entities.ts';

export type EntityWalkingDefinition = {
    speedTilesPerSecond: number;
};

export type EntityBuilderDefinition = {
    buildRadius: number;
    buildables: Array<'beacon'>;
};

export type EntityMiningDefinition = {
    minePower: number;
    mineCooldownMs: number;
    carryCapacity: number;
};

export type EntityInventoryDefinition = {
    capacity: number;
    sharedId?: string;
};

export type EntitySizeDefinition = {
    width: number;
    height: number;
};

export const ENTITY_SIZES: Record<'beacon', EntitySizeDefinition> = {
    beacon: { width: 1, height: 1 },
};

export type WorldEntity = {
    id: string;
    kind: WorldEntityKind;
    mobility: WorldEntityMobility;
    x: number;
    y: number;
    visibilityRadius: number;
    parentId: string | null;
    unitType?: WorkerUnitType;
    homeId?: string | null;
    deployed?: boolean;
    hp?: number;
    maxHp?: number;
    moveSpeedTilesPerSecond?: number;
    spawnTimeMs?: number;
    toolId?: string;
    minePower?: number;
    mineCooldownMs?: number;
    carryCapacity?: number;
    movement?: WorkerMovementState | null;
    mining?: WorkerMiningState | null;
    commandList?: WorkerEntityCommandList | PlayerEntityCommandList | null;
    commandsPaused?: boolean;
    commandRetryCooldownMs?: number;
    walking?: EntityWalkingDefinition;
    builder?: EntityBuilderDefinition;
    miningDef?: EntityMiningDefinition;
    inventoryDef?: EntityInventoryDefinition;
    /** Physical footprint. Drives collision, pathfinding clearance, and deployment checks. */
    sizeDef?: EntitySizeDef;
    /** Visual presentation. Drives rendering tint, icon, and future sprite reference. */
    viewDef?: EntityViewDef;
};

export type WorkerMovementState = {
    path: Array<{ x: number; y: number }>;
    stepIndex: number;
    progress: number;
    mode: 'move' | 'return';
    homeId?: string | null;
};

export type WorkerMiningState = {
    targetX: number;
    targetY: number;
    approachX: number;
    approachY: number;
    anchorX: number;
    anchorY: number;
    homeId: string | null;
    repeat: boolean;
    carriedOre: number;
    miningProgressMs: number;
    cooldownMs: number;
    lastMinedX: number;
    lastMinedY: number;
};

export type WorkerEntityCommandType = 'move' | 'mine' | 'recall';

export type WorkerEntityCommandPayload = {
    x?: number;
    y?: number;
    repeat?: boolean;
};

export type WorkerEntityCommandList = CommandListState<WorkerEntityCommandType, WorkerEntityCommandPayload>;

export type PlayerEntityCommandType = 'move' | 'build' | 'mine';

export type PlayerEntityCommandPayload = {
    x?: number;
    y?: number;
    buildableType?: 'beacon';
    repeat?: boolean;
};

export type PlayerEntityCommandList = CommandListState<PlayerEntityCommandType, PlayerEntityCommandPayload>;

type WorkerOreDelivery = {
    workerId: string;
    homeId: string | null;
    amount: number;
};

export type RemoveBeaconResult =
    | { ok: true; beacon: SavedBeacon }
    | { ok: false; reason: 'not_found' | 'not_beacon' };

export type WorkerActionResult =
    | { ok: true; worker: WorldEntity }
    | { ok: false; reason: 'not_found' | 'not_worker' | 'invalid_building' | 'already_deployed' | 'already_recalled' | 'no_deploy_space' | 'invalid_target' | 'path_blocked' | 'capacity_reached' };

export type PlayerActionResult =
    | { ok: true; player: WorldEntity }
    | { ok: false; reason: 'not_found' | 'invalid_target' | 'path_blocked' };

export type EntityActionFailureReason =
    | 'not_found'
    | 'not_worker'
    | 'invalid_building'
    | 'already_deployed'
    | 'already_recalled'
    | 'no_deploy_space'
    | 'invalid_target'
    | 'path_blocked'
    | 'not_movable'
    | 'not_miner';

export type EntityActionResult =
    | { ok: true; entity: WorldEntity }
    | { ok: false; reason: EntityActionFailureReason };

export type SavedBeacon = {
    id: string;
    x: number;
    y: number;
    parentId: string | null;
};

export type WorldSnapshot = {
    version: 3;
    seed: number;
    width: number;
    height: number;
    savedTiles: SavedTile[];
    entities: WorldEntity[];
};

export type SnapshotV2 = {
    version: 2;
    seed: number;
    width: number;
    height: number;
    savedTiles: SavedTile[];
    beacons: SavedBeacon[];
};

export type LegacyWorldSnapshot = {
    version: 1;
    seed: number;
    savedTiles: SavedTile[];
};

type WorldRules = {
    persistentTileDamage: boolean;
    transientDamageWindowMs: number;
};

const BASE_ENTITY_ID = 'entity-base';
const MAIN_PLAYER_ENTITY_ID = 'entity-player-main';
const BASE_ENTITY_CAPACITY = 8;
const BASE_VISIBILITY_RADIUS = 7;
const PLAYER_VISIBILITY_RADIUS = 14;
const PLAYER_MOVE_SPEED_TILES_PER_SECOND = 2.5;
const PLAYER_BUILD_RADIUS = 12;
const WORKER_VISIBILITY_RADIUS = 8;
const BEACON_VISIBILITY_RADIUS = 10;
const BEACON_BIOME_PENETRATION_DEPTH = 1;
const ORE_UNITS_PER_SLOT = 99;

type BeaconNode = SavedBeacon;

export type WorldPerformanceSnapshot = {
    tickMs: number;
    tickCalls: number;
    tickMaxMs: number;
    pathfindMs: number;
    pathfindCalls: number;
    minePlanMs: number;
    minePlanCalls: number;
    minePlanMaxMs: number;
    dropoffSearchMs: number;
    dropoffSearchCalls: number;
    workerCount: number;
    movingWorkers: number;
    miningWorkers: number;
    queuedWorkerCommands: number;
    workersWithQueuedCommands: number;
    workersInRetryCooldown: number;
    workersPaused: number;
    idleWorkers: number;
    mineReservations: number;
};

export type BaseSlotSummary = {
    capacity: number;
    used: number;
    available: number;
    heroReserved: number;
    workersAssigned: number;
};

export class WorldModel {
    private widthValue = WORLD_WIDTH;
    private heightValue = WORLD_HEIGHT;
    readonly chunkSize = CHUNK_SIZE;

    private seed: number;
    private readonly tiles: Tile[] = [];
    private readonly dirtyChunks = new Set<string>();
    private readonly activeChunks = new Set<string>();
    private readonly modifiedTiles = new Set<string>();
    private readonly entities = new Map<string, WorldEntity>();
    private readonly beacons: BeaconNode[] = [];
    private readonly mineReservations = new Map<string, string>();
    private readonly pendingWorkerOreDeliveries: WorkerOreDelivery[] = [];
    private readonly pendingPlayerOreCollected: { amount: number; oreDefinitionId: string }[] = [];
    private readonly pendingPlayerDropoffArrivals: Array<{ homeId: string | null }> = [];
    private readonly pendingWorkerDamageHits: TileDamageHit[] = [];
    private readonly scanNearestBehavior = new ScanNearestBehavior({
        areaRadius: 9,
        reseedScanRadius: 18,
        minDenseNeighbors: 2,
        maxStepFromLastMined: 3,
    });
    private readonly rules: WorldRules;
    private transientMineState: { x: number; y: number; time: number } | null = null;
    private transientDamageTiles = new Set<string>();
    private performanceStats: WorldPerformanceSnapshot = {
        tickMs: 0,
        tickCalls: 0,
        tickMaxMs: 0,
        pathfindMs: 0,
        pathfindCalls: 0,
        minePlanMs: 0,
        minePlanCalls: 0,
        minePlanMaxMs: 0,
        dropoffSearchMs: 0,
        dropoffSearchCalls: 0,
        workerCount: 0,
        movingWorkers: 0,
        miningWorkers: 0,
        queuedWorkerCommands: 0,
        workersWithQueuedCommands: 0,
        workersInRetryCooldown: 0,
        workersPaused: 0,
        idleWorkers: 0,
        mineReservations: 0,
    };
    private baseXValue = BASE_START_X;
    private baseYValue = BASE_START_Y;
    private nextBeaconIndex = 1;
    private nextWorkerIndex = 1;

    get width(): number {
        return this.widthValue;
    }

    get height(): number {
        return this.heightValue;
    }

    get baseX(): number {
        return this.getBaseEntity()?.x ?? this.baseXValue;
    }

    get baseY(): number {
        return this.getBaseEntity()?.y ?? this.baseYValue;
    }

    getMainPlayerEntityId(): string {
        return MAIN_PLAYER_ENTITY_ID;
    }

    constructor(seed = 1337, rules?: Partial<WorldRules>) {
        this.seed = seed;
        this.rules = {
            persistentTileDamage: rules?.persistentTileDamage ?? GAME_RULES.persistentTileDamage,
            transientDamageWindowMs: rules?.transientDamageWindowMs ?? GAME_RULES.transientDamageWindowMs,
        };
        this.generate();
    }

    getSeed(): number {
        return this.seed;
    }

    reset(seed: number): void {
        this.seed = Number.isFinite(seed) ? Math.trunc(seed) : 1337;
        this.tiles.length = 0;
        this.dirtyChunks.clear();
        this.activeChunks.clear();
        this.modifiedTiles.clear();
        this.entities.clear();
        this.beacons.length = 0;
        this.mineReservations.clear();
        this.pendingWorkerOreDeliveries.length = 0;
        this.pendingPlayerOreCollected.length = 0;
        this.pendingPlayerDropoffArrivals.length = 0;
        this.nextBeaconIndex = 1;
        this.nextWorkerIndex = 1;
        this.widthValue = WORLD_WIDTH;
        this.heightValue = WORLD_HEIGHT;
        this.generate();
    }

    getBeacons(): ReadonlyArray<SavedBeacon> {
        return this.beacons;
    }

    getEntities(): ReadonlyArray<WorldEntity> {
        return Array.from(this.entities.values());
    }

    getEntityById(entityId: string): WorldEntity | null {
        return this.entities.get(entityId) ?? null;
    }

    canEntityBuildBeaconAt(entityId: string, x: number, y: number): boolean {
        const reason = this.getBeaconPlacementFailureReason(x, y, entityId);
        return reason === 'unknown_tile';
    }

    canEntityBuild(entityId: string): boolean {
        const entity = this.entities.get(entityId);
        return !!entity?.builder && entity.builder.buildables.length > 0;
    }

    getEntityAtTile(x: number, y: number): WorldEntity | null {
        // Prioritize dynamic/smaller entities before large static backdrops like the base.
        let baseMatch: WorldEntity | null = null;
        for (const entity of this.entities.values()) {
            if (entity.kind === 'worker' && entity.deployed !== true) continue;
            if (entity.kind === 'base') {
                if (Math.abs(entity.x - x) <= 2 && Math.abs(entity.y - y) <= 2) baseMatch = entity;
                continue;
            }
            const sizeX = entity.sizeDef?.tilesX ?? 1;
            const sizeY = entity.sizeDef?.tilesY ?? 1;
            const ex = Math.round(entity.x);
            const ey = Math.round(entity.y);
            if (x >= ex && x < ex + sizeX && y >= ey && y < ey + sizeY) return entity;
        }
        return baseMatch;
    }

    getWorkersForBuilding(buildingId: string): ReadonlyArray<WorldEntity> {
        return Array.from(this.entities.values())
            .filter((entity) => entity.kind === 'worker' && entity.homeId === buildingId)
            .sort((left, right) => left.id.localeCompare(right.id));
    }

    getBaseSlotSummary(buildingId: string): BaseSlotSummary | null {
        const building = this.entities.get(buildingId);
        if (!building || building.kind !== 'base') return null;

        const workersAssigned = this.getWorkersForBuilding(buildingId).length;
        const heroReserved = this.getMainPlayerEntity() ? 1 : 0;
        const used = workersAssigned + heroReserved;
        const available = Math.max(0, BASE_ENTITY_CAPACITY - used);

        return {
            capacity: BASE_ENTITY_CAPACITY,
            used,
            available,
            heroReserved,
            workersAssigned,
        };
    }

    toSnapshot(): WorldSnapshot {
        const savedTiles: SavedTile[] = [];

        for (const key of this.modifiedTiles) {
            const [x, y] = key.split(',').map(Number);
            const tile = this.getTile(x, y);
            if (!tile) continue;
            savedTiles.push({
                x,
                y,
                solid: tile.solid,
                hp: tile.hp,
                visibility: tile.visibility,
            });
        }

        return {
            version: 3,
            seed: this.seed,
            width: this.width,
            height: this.height,
            savedTiles,
            entities: Array.from(this.entities.values()).map((entity) => ({ ...entity })),
        };
    }

    applySnapshot(snapshot: WorldSnapshot | SnapshotV2 | LegacyWorldSnapshot): void {
        this.reset(snapshot.seed);

        if ('width' in snapshot && 'height' in snapshot) {
            this.ensureWorldContainsTile(Math.max(0, snapshot.width - 1), Math.max(0, snapshot.height - 1));
        }

        for (const saved of snapshot.savedTiles) {
            this.ensureWorldContainsTile(saved.x, saved.y);
            const tile = this.getTile(saved.x, saved.y);
            if (!tile) continue;
            tile.solid = saved.solid;
            tile.hp = this.rules.persistentTileDamage || !saved.solid
                ? saved.hp
                : BIOME_DEFINITIONS[tile.biome].defaultHp;
            tile.visibility = saved.visibility;
            this.modifiedTiles.add(`${saved.x},${saved.y}`);
            this.markChunkDirtyAt(saved.x, saved.y);
        }

        this.beacons.length = 0;

        if (snapshot.version === 2 && Array.isArray(snapshot.beacons)) {
            this.ensureBaseEntity();
            for (const beacon of snapshot.beacons) {
                this.beacons.push({ ...beacon });
                this.entities.set(`entity-${beacon.id}`, {
                    id: `entity-${beacon.id}`,
                    kind: 'beacon',
                    mobility: 'static',
                    x: beacon.x,
                    y: beacon.y,
                    visibilityRadius: BEACON_VISIBILITY_RADIUS,
                    parentId: beacon.parentId ? `entity-${beacon.parentId}` : BASE_ENTITY_ID,
                });
                if (beacon.id.startsWith('beacon-')) {
                    const suffix = Number.parseInt(beacon.id.slice('beacon-'.length), 10);
                    if (Number.isFinite(suffix)) {
                        this.nextBeaconIndex = Math.max(this.nextBeaconIndex, suffix + 1);
                    }
                }
            }
        } else if (snapshot.version === 3 && Array.isArray(snapshot.entities)) {
            for (const entity of snapshot.entities) {
                const normalizedEntity: WorldEntity = { ...entity };
                if (normalizedEntity.kind === 'beacon') {
                    normalizedEntity.visibilityRadius = BEACON_VISIBILITY_RADIUS;
                    normalizedEntity.sizeDef = getEntityDefinition('beacon').sizeDef;
                    normalizedEntity.viewDef = getEntityDefinition('beacon').viewDef;
                } else if (normalizedEntity.kind === 'player') {
                    normalizedEntity.visibilityRadius = PLAYER_VISIBILITY_RADIUS;
                    normalizedEntity.mobility = 'dynamic';
                    normalizedEntity.parentId = null;
                    normalizedEntity.moveSpeedTilesPerSecond = normalizedEntity.moveSpeedTilesPerSecond ?? PLAYER_MOVE_SPEED_TILES_PER_SECOND;
                    normalizedEntity.walking = normalizedEntity.walking ?? {
                        speedTilesPerSecond: normalizedEntity.moveSpeedTilesPerSecond,
                    };
                    normalizedEntity.builder = normalizedEntity.builder ?? {
                        buildRadius: PLAYER_BUILD_RADIUS,
                        buildables: ['beacon'],
                    };
                    normalizedEntity.inventoryDef = {
                        capacity: 12,
                        sharedId: 'main-player',
                    };
                    normalizedEntity.miningDef = normalizedEntity.miningDef ?? {
                        minePower: 1,
                        mineCooldownMs: 160,
                        carryCapacity: 999,
                    };
                    normalizedEntity.toolId = normalizedEntity.toolId ?? 'starter-cutter';
                    normalizedEntity.minePower = normalizedEntity.minePower ?? normalizedEntity.miningDef.minePower;
                    normalizedEntity.mineCooldownMs = normalizedEntity.mineCooldownMs ?? normalizedEntity.miningDef.mineCooldownMs;
                    normalizedEntity.sizeDef = getEntityDefinition('player').sizeDef;
                    normalizedEntity.viewDef = getEntityDefinition('player').viewDef;
                } else if (normalizedEntity.kind === 'worker') {
                    const unitType: WorkerUnitType = normalizedEntity.unitType === 'large-worker' ? 'large-worker' : 'basic-worker';
                    const definition = getWorkerDefinition(unitType);
                    normalizedEntity.unitType = unitType;
                    normalizedEntity.visibilityRadius = definition.visibilityRadius;
                    normalizedEntity.hp = normalizedEntity.hp ?? definition.maxHp;
                    normalizedEntity.maxHp = normalizedEntity.maxHp ?? definition.maxHp;
                    normalizedEntity.moveSpeedTilesPerSecond = normalizedEntity.moveSpeedTilesPerSecond ?? definition.moveSpeedTilesPerSecond;
                    normalizedEntity.spawnTimeMs = normalizedEntity.spawnTimeMs ?? definition.spawnTimeMs;
                    normalizedEntity.toolId = normalizedEntity.toolId ?? definition.toolId;
                    normalizedEntity.minePower = normalizedEntity.minePower ?? definition.minePower;
                    normalizedEntity.mineCooldownMs = normalizedEntity.mineCooldownMs ?? definition.mineCooldownMs;
                    normalizedEntity.carryCapacity = normalizedEntity.carryCapacity ?? definition.carryCapacity;
                    normalizedEntity.mining = normalizedEntity.mining ?? null;
                    normalizedEntity.walking = normalizedEntity.walking ?? {
                        speedTilesPerSecond: normalizedEntity.moveSpeedTilesPerSecond,
                    };
                    normalizedEntity.miningDef = normalizedEntity.miningDef ?? {
                        minePower: normalizedEntity.minePower,
                        mineCooldownMs: normalizedEntity.mineCooldownMs,
                        carryCapacity: normalizedEntity.carryCapacity,
                    };
                    normalizedEntity.inventoryDef = normalizedEntity.inventoryDef ?? {
                        capacity: definition.inventoryCapacity,
                    };
                    const commandListComponent = new CommandListComponent<WorkerEntityCommandType, WorkerEntityCommandPayload>(normalizedEntity.commandList as WorkerEntityCommandList ?? undefined);
                    normalizedEntity.commandList = commandListComponent.snapshot();
                    if (normalizedEntity.mining) {
                        normalizedEntity.mining.anchorX = normalizedEntity.mining.anchorX ?? normalizedEntity.mining.targetX;
                        normalizedEntity.mining.anchorY = normalizedEntity.mining.anchorY ?? normalizedEntity.mining.targetY;
                        normalizedEntity.mining.lastMinedX = normalizedEntity.mining.lastMinedX ?? normalizedEntity.mining.targetX;
                        normalizedEntity.mining.lastMinedY = normalizedEntity.mining.lastMinedY ?? normalizedEntity.mining.targetY;
                    }
                    normalizedEntity.sizeDef = getEntityDefinition('worker', unitType).sizeDef;
                    normalizedEntity.viewDef = getEntityDefinition('worker', unitType).viewDef;
                }

                this.entities.set(normalizedEntity.id, normalizedEntity);
                if (entity.kind === 'beacon') {
                    const beaconId = entity.id.startsWith('entity-') ? entity.id.slice('entity-'.length) : entity.id;
                    this.beacons.push({ id: beaconId, x: entity.x, y: entity.y, parentId: entity.parentId && entity.parentId !== BASE_ENTITY_ID ? entity.parentId.replace(/^entity-/, '') : null });
                    if (beaconId.startsWith('beacon-')) {
                        const suffix = Number.parseInt(beaconId.slice('beacon-'.length), 10);
                        if (Number.isFinite(suffix)) {
                            this.nextBeaconIndex = Math.max(this.nextBeaconIndex, suffix + 1);
                        }
                    }
                }
                if (entity.kind === 'worker' && entity.id.startsWith('entity-worker-')) {
                    const suffix = Number.parseInt(entity.id.slice('entity-worker-'.length), 10);
                    if (Number.isFinite(suffix)) {
                        this.nextWorkerIndex = Math.max(this.nextWorkerIndex, suffix + 1);
                    }
                }
            }
            this.syncBaseFromEntity();
        }

        this.ensureBaseEntity();
        this.ensureMainPlayerEntity();
        this.rebuildBeaconLighting();
        this.applyEntityVisibility();
        this.rebuildMineReservationsFromEntities();
        this.markAllDirty();
    }

    drainWorkerOreDeliveries(): WorkerOreDelivery[] {
        const deliveries = this.pendingWorkerOreDeliveries.splice(0, this.pendingWorkerOreDeliveries.length);
        return deliveries;
    }

    drainPlayerOreCollected(): { amount: number; oreDefinitionId: string }[] {
        return this.pendingPlayerOreCollected.splice(0, this.pendingPlayerOreCollected.length);
    }

    drainPlayerDropoffArrivals(): Array<{ homeId: string | null }> {
        return this.pendingPlayerDropoffArrivals.splice(0, this.pendingPlayerDropoffArrivals.length);
    }

    drainWorkerDamageHits(): TileDamageHit[] {
        return this.pendingWorkerDamageHits.splice(0, this.pendingWorkerDamageHits.length);
    }

    drainPerformanceStats(): WorldPerformanceSnapshot {
        const snapshot = { ...this.performanceStats };
        this.performanceStats = {
            tickMs: 0,
            tickCalls: 0,
            tickMaxMs: 0,
            pathfindMs: 0,
            pathfindCalls: 0,
            minePlanMs: 0,
            minePlanCalls: 0,
            minePlanMaxMs: 0,
            dropoffSearchMs: 0,
            dropoffSearchCalls: 0,
            workerCount: 0,
            movingWorkers: 0,
            miningWorkers: 0,
            queuedWorkerCommands: 0,
            workersWithQueuedCommands: 0,
            workersInRetryCooldown: 0,
            workersPaused: 0,
            idleWorkers: 0,
            mineReservations: 0,
        };
        return snapshot;
    }

    getBeaconPlacementFailureReason(x: number, y: number, builderEntityId?: string): 'too_far' | 'not_open' | 'already_exists' | 'unknown_tile' | 'not_builder' {
        const tile = this.getTile(x, y);
        if (!tile) return 'unknown_tile';
        if (tile.visibility === 'Unknown') return 'not_open';
        if (this.beacons.some((entry) => entry.x === x && entry.y === y)) return 'already_exists';

        const builder = this.resolveBuilderEntity(builderEntityId);
        if (!builder || !builder.builder || !builder.builder.buildables.includes('beacon')) {
            return 'not_builder';
        }

        const distance = Math.hypot(x - builder.x, y - builder.y);
        if (distance > builder.builder.buildRadius) return 'too_far';

        return 'unknown_tile';
    }

    /**
     * Get all valid buildable tiles for a builder entity (within build radius and visible).
     */
    getBuildableTilesForEntity(entityId: string, buildableType: 'beacon'): Array<{ x: number; y: number }> {
        const builder = this.entities.get(entityId);
        if (!builder || !builder.builder) return [];

        const buildRadius = builder.builder.buildRadius;
        const tiles: Array<{ x: number; y: number }> = [];

        for (let dx = -buildRadius; dx <= buildRadius; dx++) {
            for (let dy = -buildRadius; dy <= buildRadius; dy++) {
                const x = builder.x + dx;
                const y = builder.y + dy;
                const distance = Math.hypot(dx, dy);
                if (distance > buildRadius) continue;

                const tile = this.getTile(x, y);
                if (!tile) continue;
                if (tile.visibility === 'Unknown') continue;
                if (buildableType === 'beacon' && this.beacons.some((entry) => entry.x === x && entry.y === y)) continue;

                tiles.push({ x, y });
            }
        }

        return tiles;
    }

    placeBeacon(x: number, y: number, builderEntityId?: string): SavedBeacon | null {
        this.ensureWorldContainsTile(x, y);
        const tile = this.getTile(x, y);
        if (!tile) return null;
        if (tile.visibility === 'Unknown') return null;
        if (this.beacons.some((entry) => entry.x === x && entry.y === y)) return null;

        const builder = this.resolveBuilderEntity(builderEntityId);
        if (!builder || !builder.builder || !builder.builder.buildables.includes('beacon')) return null;

        const buildDistance = Math.hypot(x - builder.x, y - builder.y);
        if (buildDistance > builder.builder.buildRadius) return null;

        const parent = this.findNearestBeacon(x, y);
        const maxLinkDistance = Math.max(16, Math.ceil(builder.builder.buildRadius * 2));
        const source = parent
            ? { id: parent.id, x: parent.x, y: parent.y }
            : { id: null as string | null, x: builder.x, y: builder.y };

        const path = this.findBeaconLinkPath(source.x, source.y, x, y, maxLinkDistance * 6);
        if (!path) return null;

        const beaconId = `beacon-${this.nextBeaconIndex++}`;
        const beaconEntityId = `entity-${beaconId}`;
        const parentEntityId = parent ? `entity-${parent.id}` : BASE_ENTITY_ID;
        const beacon: BeaconNode = {
            id: beaconId,
            x,
            y,
            parentId: source.id,
        };
        this.beacons.push(beacon);
        this.entities.set(beaconEntityId, {
            id: beaconEntityId,
            kind: 'beacon',
            mobility: 'static',
            x,
            y,
            visibilityRadius: BEACON_VISIBILITY_RADIUS,
            parentId: parentEntityId,
        });

        this.applyBeaconPathLighting(path);
        this.applyEntityVisibility();
        this.markModifiedAt(x, y);
        return { ...beacon };
    }

    removeBeaconByEntityId(entityId: string): RemoveBeaconResult {
        const entity = this.entities.get(entityId);
        if (!entity) {
            return { ok: false, reason: 'not_found' };
        }
        if (entity.kind !== 'beacon') {
            return { ok: false, reason: 'not_beacon' };
        }

        const beaconId = entityId.startsWith('entity-') ? entityId.slice('entity-'.length) : entityId;
        const beaconIndex = this.beacons.findIndex((entry) => entry.id === beaconId);
        if (beaconIndex < 0) {
            this.entities.delete(entityId);
            this.markChunkDirtyAt(entity.x, entity.y);
            return { ok: false, reason: 'not_found' };
        }

        const removedBeacon = this.beacons[beaconIndex];
        this.beacons.splice(beaconIndex, 1);
        this.entities.delete(entityId);

        for (const beacon of this.beacons) {
            if (beacon.parentId === removedBeacon.id) {
                beacon.parentId = removedBeacon.parentId;
            }
        }

        for (const entry of this.entities.values()) {
            if (entry.kind !== 'beacon') continue;
            if (entry.parentId !== entityId) continue;
            entry.parentId = removedBeacon.parentId ? `entity-${removedBeacon.parentId}` : BASE_ENTITY_ID;
        }

        this.markModifiedAt(removedBeacon.x, removedBeacon.y);
        this.markChunkDirtyAt(removedBeacon.x, removedBeacon.y);
        this.recalculateVisibilityFromCurrentState();

        return { ok: true, beacon: { ...removedBeacon } };
    }

    spawnUnitAtBuilding(buildingId: string, unitType: WorkerUnitType): WorkerActionResult {
        return this.spawnWorkerOfTypeAtBuilding(buildingId, unitType);
    }

    private spawnWorkerOfTypeAtBuilding(buildingId: string, unitType: WorkerUnitType): WorkerActionResult {
        const building = this.entities.get(buildingId);
        if (!building) {
            return { ok: false, reason: 'not_found' };
        }
        if (building.kind !== 'base') {
            return { ok: false, reason: 'invalid_building' };
        }

        const slotSummary = this.getBaseSlotSummary(buildingId);
        if (!slotSummary || slotSummary.available <= 0) {
            return { ok: false, reason: 'capacity_reached' };
        }

        const definition = getWorkerDefinition(unitType);
        const workerId = `entity-worker-${this.nextWorkerIndex++}`;
        const worker: WorldEntity = {
            id: workerId,
            kind: 'worker',
            mobility: 'dynamic',
            x: building.x,
            y: building.y,
            visibilityRadius: definition.visibilityRadius,
            parentId: buildingId,
            unitType,
            homeId: buildingId,
            deployed: false,
            hp: definition.maxHp,
            maxHp: definition.maxHp,
            moveSpeedTilesPerSecond: definition.moveSpeedTilesPerSecond,
            spawnTimeMs: definition.spawnTimeMs,
            toolId: definition.toolId,
            minePower: definition.minePower,
            mineCooldownMs: definition.mineCooldownMs,
            carryCapacity: definition.carryCapacity,
            walking: {
                speedTilesPerSecond: definition.moveSpeedTilesPerSecond,
            },
            miningDef: {
                minePower: definition.minePower,
                mineCooldownMs: definition.mineCooldownMs,
                carryCapacity: definition.carryCapacity,
            },
            inventoryDef: {
                capacity: definition.inventoryCapacity,
            },
            sizeDef: getEntityDefinition('worker', unitType).sizeDef,
            viewDef: getEntityDefinition('worker', unitType).viewDef,
            commandList: CommandListComponent.createEmpty<WorkerEntityCommandType, WorkerEntityCommandPayload>(),
        };

        this.entities.set(workerId, worker);
        this.markChunkDirtyAt(building.x, building.y);
        return { ok: true, worker: { ...worker } };
    }

    deployWorker(workerId: string): WorkerActionResult {
        const worker = this.entities.get(workerId);
        if (!worker) {
            return { ok: false, reason: 'not_found' };
        }
        if (worker.kind !== 'worker') {
            return { ok: false, reason: 'not_worker' };
        }
        if (worker.deployed) {
            return { ok: false, reason: 'already_deployed' };
        }

        const home = worker.homeId ? this.entities.get(worker.homeId) : null;
        if (!home) {
            return { ok: false, reason: 'invalid_building' };
        }

        const tile = this.findDeploymentTile(home, worker.sizeDef, worker.id);
        if (!tile) {
            return { ok: false, reason: 'no_deploy_space' };
        }

        const previousX = worker.x;
        const previousY = worker.y;
        worker.x = tile.x;
        worker.y = tile.y;
        worker.deployed = true;
        worker.parentId = null;
        worker.movement = null;
        worker.mining = null;
        this.markChunkDirtyAt(previousX, previousY);
        this.markChunkDirtyAt(tile.x, tile.y);
        this.applyWorkerVisibility(worker);
        return { ok: true, worker: { ...worker } };
    }

    recallWorker(workerId: string): WorkerActionResult {
        return this.enqueueWorkerCommand(workerId, { type: 'recall' }, 'append');
    }

    recallWorkersForBuilding(buildingId: string): { ok: true; count: number } | { ok: false; reason: 'not_found' | 'invalid_building' } {
        const building = this.entities.get(buildingId);
        if (!building) {
            return { ok: false, reason: 'not_found' };
        }
        if (building.kind !== 'base') {
            return { ok: false, reason: 'invalid_building' };
        }

        let count = 0;
        for (const entity of this.entities.values()) {
            if (entity.kind !== 'worker') continue;
            if (entity.homeId !== buildingId) continue;
            if (!entity.deployed) continue;
            this.clearWorkerCommands(entity.id);
            this.clearWorkerMining(entity);
            const returnTarget = this.findNearestDropoffTile(building, entity.x, entity.y, entity.sizeDef, entity.id);
            if (!returnTarget) continue;

            const path = this.findOpenPath(entity.x, entity.y, returnTarget.x, returnTarget.y, 15000, entity.sizeDef);
            if (!path) continue;

            if (path.length <= 1) {
                this.markChunkDirtyAt(entity.x, entity.y);
                entity.x = building.x;
                entity.y = building.y;
                entity.deployed = false;
                entity.parentId = buildingId;
                entity.movement = null;
                count++;
                continue;
            }

            entity.movement = {
                path,
                stepIndex: 1,
                progress: 0,
                mode: 'return',
                homeId: buildingId,
            };
            this.markChunkDirtyAt(entity.x, entity.y);
            count++;
        }

        if (count > 0) {
            this.markChunkDirtyAt(building.x, building.y);
        }
        return { ok: true, count };
    }

    canWorkerMineTile(workerId: string, x: number, y: number): boolean {
        const worker = this.entities.get(workerId);
        if (!worker || worker.kind !== 'worker') return false;
        return this.canWorkerMineTileForWorker(worker, x, y) && this.findMineApproachPath(worker, x, y) !== null;
    }

    startWorkerMining(workerId: string, x: number, y: number, repeat = true): WorkerActionResult {
        const result = this.enqueueEntityCommand(workerId, { type: 'mine', x, y, repeat }, 'append');
        if (!result.ok) return { ok: false, reason: this.asWorkerFailureReason(result.reason) };
        return { ok: true, worker: result.entity };
    }

    moveWorkerTo(workerId: string, x: number, y: number): WorkerActionResult {
        const result = this.enqueueEntityCommand(workerId, { type: 'move', x, y }, 'append');
        if (!result.ok) return { ok: false, reason: this.asWorkerFailureReason(result.reason) };
        return { ok: true, worker: result.entity };
    }

    moveEntityTo(entityId: string, x: number, y: number): EntityActionResult {
        const entity = this.entities.get(entityId);
        if (!entity) return { ok: false, reason: 'not_found' };
        if (!entity.walking) return { ok: false, reason: 'not_movable' };
        return this.enqueueEntityCommand(entityId, { type: 'move', x, y }, 'append');
    }

    canEntityMoveTo(entityId: string, x: number, y: number): boolean {
        const entity = this.entities.get(entityId);
        if (!entity) return false;

        return this.findBestFitAnchorForSelectedTile(entity, x, y) !== null;
    }

    canEntityMineTile(entityId: string, x: number, y: number): boolean {
        const entity = this.entities.get(entityId);
        if (!entity || !entity.miningDef) return false;

        return this.isMineableFrontierSolid(x, y);
    }

    startEntityMining(entityId: string, x: number, y: number, repeat = true): EntityActionResult {
        const entity = this.entities.get(entityId);
        if (!entity) return { ok: false, reason: 'not_found' };
        if (!entity.miningDef) return { ok: false, reason: 'not_miner' };
        return this.enqueueEntityCommand(entityId, { type: 'mine', x, y, repeat }, 'append');
    }

    startPlayerMining(x: number, y: number, repeat = true): PlayerActionResult {
        const player = this.getMainPlayerEntity();
        if (!player) return { ok: false, reason: 'not_found' };
        const result = this.enqueueEntityCommand(player.id, { type: 'mine', x, y, repeat }, 'append');
        if (!result.ok) return { ok: false, reason: this.asPlayerFailureReason(result.reason) };
        return { ok: true, player: result.entity };
    }

    moveMainPlayerTo(x: number, y: number): PlayerActionResult {
        const player = this.getMainPlayerEntity();
        if (!player) return { ok: false, reason: 'not_found' };
        const result = this.enqueueEntityCommand(player.id, { type: 'move', x, y }, 'append');
        if (!result.ok) return { ok: false, reason: this.asPlayerFailureReason(result.reason) };
        return { ok: true, player: result.entity };
    }

    removeQueuedPlayerCommand(commandId: string): { ok: true } | { ok: false; reason: 'not_found' } {
        const player = this.getMainPlayerEntity();
        if (!player) return { ok: false, reason: 'not_found' };
        const removed = this.removeQueuedEntityCommand(player.id, commandId);
        if (!removed.ok) return { ok: false, reason: 'not_found' };
        return { ok: true };
    }

    interruptPlayerCommand(): PlayerActionResult {
        const player = this.getMainPlayerEntity();
        if (!player) return { ok: false, reason: 'not_found' };
        const result = this.interruptEntityCommand(player.id);
        if (!result.ok) return { ok: false, reason: this.asPlayerFailureReason(result.reason) };
        return { ok: true, player: result.entity };
    }

    clearPlayerCommands(): PlayerActionResult {
        const player = this.getMainPlayerEntity();
        if (!player) return { ok: false, reason: 'not_found' };
        const result = this.clearEntityCommands(player.id);
        if (!result.ok) return { ok: false, reason: this.asPlayerFailureReason(result.reason) };
        return { ok: true, player: result.entity };
    }

    pausePlayerCommands(): PlayerActionResult {
        const player = this.getMainPlayerEntity();
        if (!player) return { ok: false, reason: 'not_found' };
        player.commandsPaused = true;
        this.markChunkDirtyAt(player.x, player.y);
        return { ok: true, player: { ...player } };
    }

    resumePlayerCommands(): PlayerActionResult {
        const player = this.getMainPlayerEntity();
        if (!player) return { ok: false, reason: 'not_found' };
        player.commandsPaused = false;
        this.tryStartNextEntityCommand(player);
        this.markChunkDirtyAt(player.x, player.y);
        return { ok: true, player: { ...player } };
    }

    pauseWorkerCommands(workerId: string): WorkerActionResult {
        const worker = this.entities.get(workerId);
        if (!worker) return { ok: false, reason: 'not_found' };
        if (worker.kind !== 'worker') return { ok: false, reason: 'not_worker' };
        worker.commandsPaused = true;
        this.markChunkDirtyAt(worker.x, worker.y);
        return { ok: true, worker: { ...worker } };
    }


    resumeWorkerCommands(workerId: string): WorkerActionResult {
        const worker = this.entities.get(workerId);
        if (!worker) return { ok: false, reason: 'not_found' };
        if (worker.kind !== 'worker') return { ok: false, reason: 'not_worker' };
        worker.commandsPaused = false;
        this.tryStartNextEntityCommand(worker);
        this.markChunkDirtyAt(worker.x, worker.y);
        return { ok: true, worker: { ...worker } };
    }

    enqueueWorkerCommand(workerId: string, command: { type: WorkerEntityCommandType; x?: number; y?: number; repeat?: boolean }, mode: EnqueueMode = 'append'): WorkerActionResult {
        const result = this.enqueueEntityCommand(workerId, command, mode);
        if (!result.ok) return { ok: false, reason: this.asWorkerFailureReason(result.reason) };
        return { ok: true, worker: result.entity };
    }

    interruptWorkerCommand(workerId: string): WorkerActionResult {
        const result = this.interruptEntityCommand(workerId);
        if (!result.ok) return { ok: false, reason: this.asWorkerFailureReason(result.reason) };
        return { ok: true, worker: result.entity };
    }

    clearWorkerCommands(workerId: string): WorkerActionResult {
        const result = this.clearEntityCommands(workerId);
        if (!result.ok) return { ok: false, reason: this.asWorkerFailureReason(result.reason) };
        return { ok: true, worker: result.entity };
    }

    removeQueuedWorkerCommand(workerId: string, commandId: string): WorkerActionResult {
        const entity = this.entities.get(workerId);
        if (!entity || entity.kind !== 'worker') return { ok: false, reason: !entity ? 'not_found' : 'not_worker' };
        const removed = this.removeQueuedEntityCommand(workerId, commandId);
        if (!removed.ok) return { ok: false, reason: 'invalid_target' };
        return { ok: true, worker: { ...entity } };
    }

    private beginMoveWorkerTo(worker: WorldEntity, x: number, y: number): WorkerActionResult {
        this.clearWorkerMining(worker);

        const bestFit = this.findBestFitMoveTarget(worker, x, y, 15000);
        if (!bestFit) {
            return { ok: false, reason: 'path_blocked' };
        }

        const { path } = bestFit;

        if (path.length <= 1) {
            worker.movement = null;
            this.markChunkDirtyAt(worker.x, worker.y);
            return { ok: true, worker: { ...worker } };
        }

        worker.movement = {
            path,
            stepIndex: 1,
            progress: 0,
            mode: 'move',
        };
        this.markChunkDirtyAt(worker.x, worker.y);
        return { ok: true, worker: { ...worker } };
    }

    private beginWorkerMining(worker: WorldEntity, x: number, y: number, repeat = true): WorkerActionResult {
        let targetX = x;
        let targetY = y;
        let approachX: number;
        let approachY: number;
        let path: Array<{ x: number; y: number }>;
        let anchorX = x;
        let anchorY = y;

        const directMineable = this.canWorkerMineTileForWorker(worker, x, y);
        const directPlan = directMineable ? this.findMineApproachPath(worker, x, y) : null;

        if (directPlan) {
            approachX = directPlan.approachX;
            approachY = directPlan.approachY;
            path = directPlan.path;
        } else {
            const fallback = this.findClosestMineTargetPlan(worker, {
                anchorX: x,
                anchorY: y,
                lastMinedX: x,
                lastMinedY: y,
            });
            if (!fallback) {
                return { ok: false, reason: directMineable ? 'path_blocked' : 'invalid_target' };
            }
            targetX = fallback.targetX;
            targetY = fallback.targetY;
            approachX = fallback.approachX;
            approachY = fallback.approachY;
            path = fallback.path;
            anchorX = fallback.anchorX;
            anchorY = fallback.anchorY;
        }

        this.clearWorkerMining(worker);
        this.clearWorkerMovement(worker);
        if (!this.reserveMineTarget(targetX, targetY, worker.id)) {
            return { ok: false, reason: 'invalid_target' };
        }
        worker.deployed = true;
        worker.parentId = null;
        worker.mining = {
            targetX,
            targetY,
            approachX,
            approachY,
            anchorX,
            anchorY,
            homeId: worker.homeId ?? null,
            repeat,
            carriedOre: 0,
            miningProgressMs: 0,
            cooldownMs: 0,
            lastMinedX: targetX,
            lastMinedY: targetY,
        };
        worker.movement = {
            path,
            stepIndex: 1,
            progress: 0,
            mode: 'move',
        };
        this.markChunkDirtyAt(worker.x, worker.y);
        return { ok: true, worker: { ...worker } };
    }

    private beginRecallWorker(worker: WorldEntity): WorkerActionResult {
        if (!worker.deployed || worker.movement?.mode === 'return') {
            return { ok: false, reason: 'already_recalled' };
        }

        this.clearWorkerMining(worker);

        const home = worker.homeId ? this.entities.get(worker.homeId) : null;
        if (!home) {
            return { ok: false, reason: 'invalid_building' };
        }

        const returnTarget = this.findNearestDropoffTile(home, worker.x, worker.y, worker.sizeDef, worker.id);
        if (!returnTarget) {
            return { ok: false, reason: 'no_deploy_space' };
        }

        const path = this.findOpenPath(worker.x, worker.y, returnTarget.x, returnTarget.y, 15000, worker.sizeDef);
        if (!path) {
            return { ok: false, reason: 'path_blocked' };
        }

        if (path.length <= 1) {
            worker.deployed = false;
            worker.parentId = home.id;
            worker.movement = null;
            this.markChunkDirtyAt(returnTarget.x, returnTarget.y);
            return { ok: true, worker: { ...worker } };
        }

        worker.movement = {
            path,
            stepIndex: 1,
            progress: 0,
            mode: 'return',
            homeId: home.id,
        };
        this.markChunkDirtyAt(worker.x, worker.y);
        return { ok: true, worker: { ...worker } };
    }

    tickFixed(deltaMs: number): void {
        if (deltaMs <= 0) return;
        const tickStart = performance.now();

        const movedWorkers: WorldEntity[] = [];
        let workerCount = 0;
        let movingWorkers = 0;
        let miningWorkers = 0;
        let queuedWorkerCommands = 0;
        let workersWithQueuedCommands = 0;
        let workersInRetryCooldown = 0;
        let workersPaused = 0;
        let idleWorkers = 0;
        for (const entity of this.entities.values()) {
            if (entity.kind !== 'worker') continue;
            workerCount++;
            const previousX = entity.x;
            const previousY = entity.y;

            if ((entity.commandRetryCooldownMs ?? 0) > 0) {
                entity.commandRetryCooldownMs = Math.max(0, (entity.commandRetryCooldownMs ?? 0) - deltaMs);
            }

            this.tryStartNextEntityCommand(entity);

            if (!entity.commandsPaused && entity.movement) {
                movingWorkers++;
                const speed = Math.max(0.1, entity.walking?.speedTilesPerSecond ?? entity.moveSpeedTilesPerSecond ?? getWorkerDefinition(entity.unitType ?? 'basic-worker').moveSpeedTilesPerSecond);
                let remainingTiles = (speed * deltaMs) / 1000;

                while (remainingTiles > 0 && entity.movement.stepIndex < entity.movement.path.length) {
                    const nextPoint = entity.movement.path[entity.movement.stepIndex];
                    const distance = Math.hypot(nextPoint.x - entity.x, nextPoint.y - entity.y);
                    if (distance === 0) {
                        entity.x = nextPoint.x;
                        entity.y = nextPoint.y;
                        entity.movement.stepIndex++;
                        entity.movement.progress = 0;
                        continue;
                    }

                    const step = Math.min(remainingTiles, distance);
                    const ratio = step / distance;
                    entity.x += (nextPoint.x - entity.x) * ratio;
                    entity.y += (nextPoint.y - entity.y) * ratio;
                    entity.movement.progress += step;
                    remainingTiles -= step;

                    if (Math.hypot(nextPoint.x - entity.x, nextPoint.y - entity.y) <= 0.001) {
                        entity.x = nextPoint.x;
                        entity.y = nextPoint.y;
                        entity.movement.stepIndex++;
                        entity.movement.progress = 0;
                    }

                    if (entity.movement.mode === 'return' && entity.movement.homeId) {
                        const home = this.entities.get(entity.movement.homeId);
                        if (home && this.isInBaseDropoffZone(home, entity.x, entity.y, entity.sizeDef)) {
                            entity.movement.stepIndex = entity.movement.path.length;
                            break;
                        }
                    }
                }

                if (entity.movement.stepIndex >= entity.movement.path.length) {
                    const movementMode = entity.movement.mode;
                    const homeId = entity.movement.homeId ?? entity.homeId ?? null;
                    entity.movement = null;

                    if (movementMode === 'return' && homeId) {
                        const home = this.entities.get(homeId);
                        if (home) {
                            if (entity.mining?.carriedOre && entity.mining.carriedOre > 0) {
                                this.pendingWorkerOreDeliveries.push({
                                    workerId: entity.id,
                                    homeId,
                                    amount: entity.mining.carriedOre,
                                });
                                entity.mining.carriedOre = 0;
                            }

                            if (entity.mining) {
                                const repeatMining = entity.mining.repeat;
                                const repeatAnchorX = entity.mining.anchorX;
                                const repeatAnchorY = entity.mining.anchorY;
                                this.clearWorkerMining(entity);
                                entity.deployed = true;
                                entity.parentId = null;
                                this.completeCurrentEntityCommand(entity);

                                if (repeatMining) {
                                    // Only re-enqueue the cycle if the queue is empty.
                                    // If other commands were added while this cycle was running,
                                    // they take over as the new active cycle instead of reverting.
                                    const commandList = this.getEntityCommandList(entity);
                                    if (commandList.snapshot().queue.length === 0) {
                                        commandList.enqueue('mine', { x: repeatAnchorX, y: repeatAnchorY, repeat: true }, 'append');
                                        this.setEntityCommandList(entity, commandList);
                                    }
                                }

                                this.tryStartNextEntityCommand(entity);
                            } else {
                                entity.deployed = false;
                                entity.parentId = home.id;
                                this.completeCurrentEntityCommand(entity);
                                this.tryStartNextEntityCommand(entity);
                            }
                        }
                    } else if (movementMode === 'move') {
                        if (entity.mining) {
                            // Approach movement completed normally â€” mining tick will handle it.
                        } else {
                            // Check if the current command is 'mine'. This can happen after a save/reload
                            // where the snapshot was taken during an approach movement before mining
                            // state was set. Re-activate mining from the current position so the command
                            // isn't incorrectly discarded.
                            const cmdList = this.getEntityCommandList(entity);
                            const currentCmd = cmdList.snapshot().current;
                            if (currentCmd?.type === 'mine' && Number.isFinite(currentCmd.payload.x) && Number.isFinite(currentCmd.payload.y)) {
                                const result = this.beginWorkerMining(entity, Number(currentCmd.payload.x), Number(currentCmd.payload.y), currentCmd.payload.repeat !== false);
                                if (!result.ok) {
                                    // Target gone â€” give up and advance queue.
                                    this.completeCurrentEntityCommand(entity);
                                    this.tryStartNextEntityCommand(entity);
                                }
                                // beginWorkerMining sets entity.mining â€” next tick the mining loop takes over.
                            } else {
                                this.completeCurrentEntityCommand(entity);
                                this.tryStartNextEntityCommand(entity);
                            }
                        }
                    }
                }
            }

            if (!entity.commandsPaused && entity.mining) {
                miningWorkers++;
                if (entity.deployed && !entity.movement) {
                    const mining = entity.mining;
                    const atApproach = Math.round(entity.x) === mining.approachX && Math.round(entity.y) === mining.approachY;
                    const targetStillMineable = this.isMineableFrontierSolid(mining.targetX, mining.targetY);

                    if (!targetStillMineable || !atApproach) {
                        const plan = this.findClosestMineTargetPlan(entity, {
                            anchorX: mining.anchorX,
                            anchorY: mining.anchorY,
                            lastMinedX: mining.lastMinedX,
                            lastMinedY: mining.lastMinedY,
                        });

                        if (!plan) {
                            this.clearWorkerMining(entity);
                            this.completeCurrentEntityCommand(entity);
                            this.tryStartNextEntityCommand(entity);
                        } else if (this.reserveMineTarget(plan.targetX, plan.targetY, entity.id)) {
                            mining.targetX = plan.targetX;
                            mining.targetY = plan.targetY;
                            mining.approachX = plan.approachX;
                            mining.approachY = plan.approachY;
                            mining.anchorX = plan.anchorX;
                            mining.anchorY = plan.anchorY;
                            mining.cooldownMs = 0;
                            mining.miningProgressMs = 0;
                            entity.movement = {
                                path: plan.path,
                                stepIndex: 1,
                                progress: 0,
                                mode: 'move',
                            };
                        }
                    } else {
                        const tool = entity.toolId ? getToolDefinition(entity.toolId) : undefined;
                        if (!tool) {
                            this.clearWorkerMining(entity);
                            this.completeCurrentEntityCommand(entity);
                            this.tryStartNextEntityCommand(entity);
                        } else if (entity.mining.cooldownMs > 0) {
                            entity.mining.cooldownMs = Math.max(0, entity.mining.cooldownMs - deltaMs);
                        } else {
                            // Each inventory slot can hold up to ORE_UNITS_PER_SLOT ore.
                            const inventorySlots = Math.max(1, entity.inventoryDef?.capacity ?? 1);
                            const perSlotCap = Math.max(1, entity.miningDef?.carryCapacity ?? ORE_UNITS_PER_SLOT);
                            const totalCapacity = inventorySlots * perSlotCap;
                            const carried = entity.mining.carriedOre ?? 0;
                            const availableCapacity = Math.max(0, totalCapacity - carried);

                            let baseDamage = Math.max(1, Math.floor(tool.tileDamage * Math.max(1, entity.minePower ?? 1)));

                            // Cap damage proportionally if near capacity
                            if (availableCapacity < baseDamage * 2) {
                                // When low on capacity, reduce damage to not overshoot capacity
                                const tile = this.getTile(entity.mining.targetX, entity.mining.targetY);
                                if (tile) {
                                    const biomeDef = BIOME_DEFINITIONS[tile.biome];
                                    const avgOre = (biomeDef.oreYield[0] + biomeDef.oreYield[1]) / 2;
                                    const orecPerHP = Math.max(1, avgOre / biomeDef.defaultHp);
                                    baseDamage = Math.ceil(Math.min(baseDamage, availableCapacity / orecPerHP));
                                }
                            }

                            const hit = this.mineSingleAt(entity.mining.targetX, entity.mining.targetY, Math.max(1, baseDamage));
                            if (!hit) {
                                this.releaseMineTarget(entity.mining.targetX, entity.mining.targetY, entity.id);
                                this.clearWorkerMining(entity);
                                this.completeCurrentEntityCommand(entity);
                                this.tryStartNextEntityCommand(entity);
                            } else {
                                this.pendingWorkerDamageHits.push(hit);
                                const toolCadenceMs = Math.max(60, Math.round(1000 / Math.max(0.1, tool.hitsPerSecond)));
                                const workerCadenceMs = Math.max(0, Math.round(entity.mineCooldownMs ?? 0));
                                entity.mining.cooldownMs = workerCadenceMs > 0
                                    ? Math.max(workerCadenceMs, toolCadenceMs)
                                    : toolCadenceMs;
                                entity.mining.miningProgressMs += deltaMs;

                                const remainingCapacity = Math.max(0, totalCapacity - entity.mining.carriedOre);
                                const oreGain = Math.max(0, Math.min(hit.oreYield ?? 0, remainingCapacity));
                                if (oreGain > 0) {
                                    entity.mining.carriedOre += oreGain;
                                }

                                const inventoryNowFull = entity.mining.carriedOre >= totalCapacity;
                                if (inventoryNowFull) {
                                    const home = entity.mining.homeId ? this.entities.get(entity.mining.homeId) : null;
                                    if (home) {
                                        const returnTarget = this.findNearestDropoffTile(home, entity.x, entity.y, entity.sizeDef, entity.id);
                                        if (returnTarget) {
                                            const path = this.findOpenPath(entity.x, entity.y, returnTarget.x, returnTarget.y, 15000, entity.sizeDef);
                                            if (path) {
                                                entity.movement = {
                                                    path,
                                                    stepIndex: 1,
                                                    progress: 0,
                                                    mode: 'return',
                                                    homeId: home.id,
                                                };
                                            }
                                        }
                                    }
                                }

                                if (hit.opened) {
                                    entity.mining.lastMinedX = entity.mining.targetX;
                                    entity.mining.lastMinedY = entity.mining.targetY;
                                    this.releaseMineTarget(entity.mining.targetX, entity.mining.targetY, entity.id);

                                    if (!inventoryNowFull) {
                                        // Continue mining - find next nearby target
                                        const nextPlan = this.findClosestMineTargetPlan(entity, {
                                            // Chain mining around the last opened tile so routes stay coherent.
                                            anchorX: entity.mining.lastMinedX,
                                            anchorY: entity.mining.lastMinedY,
                                            lastMinedX: entity.mining.lastMinedX,
                                            lastMinedY: entity.mining.lastMinedY,
                                        });

                                        if (nextPlan && this.reserveMineTarget(nextPlan.targetX, nextPlan.targetY, entity.id)) {
                                            entity.mining.targetX = nextPlan.targetX;
                                            entity.mining.targetY = nextPlan.targetY;
                                            entity.mining.approachX = nextPlan.approachX;
                                            entity.mining.approachY = nextPlan.approachY;
                                            entity.mining.anchorX = nextPlan.anchorX;
                                            entity.mining.anchorY = nextPlan.anchorY;
                                            entity.mining.cooldownMs = 0;
                                            entity.mining.miningProgressMs = 0;
                                            entity.movement = {
                                                path: nextPlan.path,
                                                stepIndex: 1,
                                                progress: 0,
                                                mode: 'move',
                                            };
                                        } else {
                                            // No more targets nearby - return home with collected ore
                                            const home = entity.mining.homeId ? this.entities.get(entity.mining.homeId) : null;
                                            if (home && entity.mining.carriedOre > 0) {
                                                const returnTarget = this.findNearestDropoffTile(home, entity.x, entity.y, entity.sizeDef, entity.id);
                                                if (returnTarget) {
                                                    const path = this.findOpenPath(entity.x, entity.y, returnTarget.x, returnTarget.y, 15000, entity.sizeDef);
                                                    if (path) {
                                                        entity.movement = {
                                                            path,
                                                            stepIndex: 1,
                                                            progress: 0,
                                                            mode: 'return',
                                                            homeId: home.id,
                                                        };
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if (entity.x !== previousX || entity.y !== previousY || (!entity.commandsPaused && (entity.movement || entity.mining))) {
                movedWorkers.push(entity);
                this.markChunkDirtyAt(previousX, previousY);
                this.applyWorkerVisibility(entity);
                this.markChunkDirtyAt(Math.floor(entity.x), Math.floor(entity.y));
            }

            const commandState = entity.commandList;
            const queuedCommands = commandState?.queue.length ?? 0;
            queuedWorkerCommands += queuedCommands;
            if (queuedCommands > 0) {
                workersWithQueuedCommands++;
            }
            if ((entity.commandRetryCooldownMs ?? 0) > 0) {
                workersInRetryCooldown++;
            }
            if (entity.commandsPaused) {
                workersPaused++;
            }
            const hasCurrentCommand = !!commandState?.current;
            const isIdle = !entity.commandsPaused
                && !entity.movement
                && !entity.mining
                && queuedCommands === 0
                && !hasCurrentCommand;
            if (isIdle) {
                idleWorkers++;
            }
        }

        this.performanceStats.workerCount += workerCount;
        this.performanceStats.movingWorkers += movingWorkers;
        this.performanceStats.miningWorkers += miningWorkers;
        this.performanceStats.queuedWorkerCommands += queuedWorkerCommands;
        this.performanceStats.workersWithQueuedCommands += workersWithQueuedCommands;
        this.performanceStats.workersInRetryCooldown += workersInRetryCooldown;
        this.performanceStats.workersPaused += workersPaused;
        this.performanceStats.idleWorkers += idleWorkers;
        this.performanceStats.mineReservations += this.mineReservations.size;

        const player = this.getMainPlayerEntity();
        if (player) {
            const previousX = player.x;
            const previousY = player.y;

            if ((player.commandRetryCooldownMs ?? 0) > 0) {
                player.commandRetryCooldownMs = Math.max(0, (player.commandRetryCooldownMs ?? 0) - deltaMs);
            }

            if (!player.commandsPaused && player.movement) {
                const movementMode = player.movement.mode;
                const returnHomeId = movementMode === 'return' ? (player.movement.homeId ?? null) : null;
                const speed = Math.max(0.1, player.walking?.speedTilesPerSecond ?? player.moveSpeedTilesPerSecond ?? PLAYER_MOVE_SPEED_TILES_PER_SECOND);
                let remainingTiles = (speed * deltaMs) / 1000;

                while (remainingTiles > 0 && player.movement.stepIndex < player.movement.path.length) {
                    const nextPoint = player.movement.path[player.movement.stepIndex];
                    const distance = Math.hypot(nextPoint.x - player.x, nextPoint.y - player.y);
                    if (distance === 0) {
                        player.x = nextPoint.x;
                        player.y = nextPoint.y;
                        player.movement.stepIndex++;
                        player.movement.progress = 0;
                        continue;
                    }

                    const step = Math.min(remainingTiles, distance);
                    const ratio = step / distance;
                    player.x += (nextPoint.x - player.x) * ratio;
                    player.y += (nextPoint.y - player.y) * ratio;
                    player.movement.progress += step;
                    remainingTiles -= step;

                    if (Math.hypot(nextPoint.x - player.x, nextPoint.y - player.y) <= 0.001) {
                        player.x = nextPoint.x;
                        player.y = nextPoint.y;
                        player.movement.stepIndex++;
                        player.movement.progress = 0;
                    }
                }

                if (player.movement.stepIndex >= player.movement.path.length) {
                    const wasApproach = movementMode === 'move' && player.mining != null;
                    const wasReturn = movementMode === 'return' && player.mining != null;
                    player.movement = null;
                    if (wasReturn && player.mining) {
                        // Returning to a dropoff point empties carried load and resumes mining command.
                        this.pendingPlayerDropoffArrivals.push({ homeId: returnHomeId });
                        player.mining.carriedOre = 0;
                    } else if (!wasApproach) {
                        // Only complete a move command; approach to mining position is handled by mining tick.
                        this.completeCurrentEntityCommand(player);
                        this.tryStartNextEntityCommand(player);
                    }
                }
            } else if (!player.commandsPaused) {
                this.tryStartNextEntityCommand(player);
            }

            // Player mining tick — mirrors worker mining but collects ore directly (no carry/return cycle).
            if (!player.commandsPaused && player.mining && !player.movement) {
                const mining = player.mining;
                const atApproach = Math.round(player.x) === mining.approachX && Math.round(player.y) === mining.approachY;
                const targetStillMineable = this.isMineableFrontierSolid(mining.targetX, mining.targetY);

                if (!targetStillMineable || !atApproach) {
                    const plan = this.findClosestMineTargetPlan(player, {
                        anchorX: mining.lastMinedX,
                        anchorY: mining.lastMinedY,
                        lastMinedX: mining.lastMinedX,
                        lastMinedY: mining.lastMinedY,
                    });
                    if (!plan) {
                        this.clearWorkerMining(player);
                        this.completeCurrentEntityCommand(player);
                        this.tryStartNextEntityCommand(player);
                    } else if (this.reserveMineTarget(plan.targetX, plan.targetY, player.id)) {
                        mining.targetX = plan.targetX;
                        mining.targetY = plan.targetY;
                        mining.approachX = plan.approachX;
                        mining.approachY = plan.approachY;
                        mining.anchorX = plan.anchorX;
                        mining.anchorY = plan.anchorY;
                        mining.cooldownMs = 0;
                        mining.miningProgressMs = 0;
                        player.movement = { path: plan.path, stepIndex: 1, progress: 0, mode: 'move' };
                    }
                } else {
                    const tool = player.toolId ? getToolDefinition(player.toolId) : undefined;
                    if (!tool) {
                        this.clearWorkerMining(player);
                        this.completeCurrentEntityCommand(player);
                        this.tryStartNextEntityCommand(player);
                    } else if (mining.cooldownMs > 0) {
                        mining.cooldownMs = Math.max(0, mining.cooldownMs - deltaMs);
                    } else {
                        const inventorySlots = Math.max(1, player.inventoryDef?.capacity ?? 1);
                        const configuredCarryLimit = Math.max(1, player.miningDef?.carryCapacity ?? player.carryCapacity ?? ORE_UNITS_PER_SLOT);
                        const totalCapacity = Math.max(configuredCarryLimit, inventorySlots * ORE_UNITS_PER_SLOT);
                        const carried = mining.carriedOre ?? 0;
                        const availableCapacity = Math.max(0, totalCapacity - carried);

                        let rawDamage = Math.max(1, Math.floor(tool.tileDamage * Math.max(1, player.minePower ?? 1)));
                        if (availableCapacity < rawDamage * 2) {
                            const tile = this.getTile(mining.targetX, mining.targetY);
                            if (tile) {
                                const biomeDef = BIOME_DEFINITIONS[tile.biome];
                                const avgOre = (biomeDef.oreYield[0] + biomeDef.oreYield[1]) / 2;
                                const orePerHp = Math.max(1, avgOre / biomeDef.defaultHp);
                                rawDamage = Math.ceil(Math.min(rawDamage, availableCapacity / orePerHp));
                            }
                        }

                        const hit = this.mineSingleAt(mining.targetX, mining.targetY, rawDamage);
                        if (!hit) {
                            this.releaseMineTarget(mining.targetX, mining.targetY, player.id);
                            this.clearWorkerMining(player);
                            this.completeCurrentEntityCommand(player);
                            this.tryStartNextEntityCommand(player);
                        } else {
                            this.pendingWorkerDamageHits.push(hit);
                            const toolCadenceMs = Math.max(60, Math.round(1000 / Math.max(0.1, tool.hitsPerSecond)));
                            const entityCadenceMs = Math.max(0, Math.round(player.mineCooldownMs ?? 0));
                            mining.cooldownMs = entityCadenceMs > 0 ? Math.max(entityCadenceMs, toolCadenceMs) : toolCadenceMs;
                            mining.miningProgressMs += deltaMs;

                            const remainingCapacity = Math.max(0, totalCapacity - mining.carriedOre);
                            const oreGain = Math.max(0, Math.min(hit.oreYield ?? 0, remainingCapacity));
                            if (oreGain > 0) {
                                mining.carriedOre += oreGain;
                                // Keep existing collection pipeline, but cap by carried capacity.
                                this.pendingPlayerOreCollected.push({ amount: oreGain, oreDefinitionId: hit.oreDefinitionId });
                            }

                            const inventoryNowFull = mining.carriedOre >= totalCapacity;
                            if (inventoryNowFull) {
                                const home = this.findNearestStaticDropoffEntity(player.x, player.y) ?? this.getBaseEntity();
                                if (home) {
                                    const returnTarget = this.findNearestDropoffTile(home, player.x, player.y);
                                    if (returnTarget) {
                                        const path = this.findOpenPath(player.x, player.y, returnTarget.x, returnTarget.y, 15000);
                                        if (path) {
                                            player.movement = {
                                                path,
                                                stepIndex: 1,
                                                progress: 0,
                                                mode: 'return',
                                                homeId: home.id,
                                            };
                                        }
                                    }
                                }

                            }

                            if (hit.opened) {
                                mining.lastMinedX = mining.targetX;
                                mining.lastMinedY = mining.targetY;
                                this.releaseMineTarget(mining.targetX, mining.targetY, player.id);

                                if (!inventoryNowFull) {
                                    const nextPlan = this.findClosestMineTargetPlan(player, {
                                        anchorX: mining.lastMinedX,
                                        anchorY: mining.lastMinedY,
                                        lastMinedX: mining.lastMinedX,
                                        lastMinedY: mining.lastMinedY,
                                    });

                                    if (nextPlan && this.reserveMineTarget(nextPlan.targetX, nextPlan.targetY, player.id)) {
                                        mining.targetX = nextPlan.targetX;
                                        mining.targetY = nextPlan.targetY;
                                        mining.approachX = nextPlan.approachX;
                                        mining.approachY = nextPlan.approachY;
                                        mining.anchorX = nextPlan.anchorX;
                                        mining.anchorY = nextPlan.anchorY;
                                        mining.cooldownMs = 0;
                                        mining.miningProgressMs = 0;
                                        player.movement = { path: nextPlan.path, stepIndex: 1, progress: 0, mode: 'move' };
                                    } else if (mining.repeat) {
                                        const repeatX = mining.lastMinedX;
                                        const repeatY = mining.lastMinedY;
                                        this.clearWorkerMining(player);
                                        const cmdList = this.getEntityCommandList(player);
                                        cmdList.completeCurrent();
                                        if (cmdList.snapshot().queue.length === 0) {
                                            cmdList.enqueue('mine', { x: repeatX, y: repeatY, repeat: true }, 'append');
                                        }
                                        this.setEntityCommandList(player, cmdList);
                                        this.tryStartNextEntityCommand(player);
                                    } else {
                                        this.clearWorkerMining(player);
                                        this.completeCurrentEntityCommand(player);
                                        this.tryStartNextEntityCommand(player);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if (player.x !== previousX || player.y !== previousY || (!player.commandsPaused && (player.movement || player.mining))) {
                this.markChunkDirtyAt(previousX, previousY);
                this.revealAround(player.x, player.y, Math.max(1, Math.floor(player.visibilityRadius)));
                this.ensureChunksAround(player.x, player.y, 1);
                this.markChunkDirtyAt(Math.floor(player.x), Math.floor(player.y));
            }
        }

        const tickDurationMs = performance.now() - tickStart;
        this.performanceStats.tickMs += tickDurationMs;
        this.performanceStats.tickMaxMs = Math.max(this.performanceStats.tickMaxMs, tickDurationMs);
        this.performanceStats.tickCalls += 1;
    }

    getDirtyChunkKeys(): string[] {
        this.expireTransientDamageIfNeeded();
        return Array.from(this.dirtyChunks.values());
    }

    clearDirtyChunks(): void {
        this.dirtyChunks.clear();
    }

    isChunkActive(chunkX: number, chunkY: number): boolean {
        return this.activeChunks.has(`${chunkX},${chunkY}`);
    }

    isChunkActiveAt(x: number, y: number): boolean {
        if (!this.isInBounds(x, y)) return false;
        return this.isChunkActive(Math.floor(x / this.chunkSize), Math.floor(y / this.chunkSize));
    }

    ensureChunksAround(tileX: number, tileY: number, radiusChunks: number): void {
        const chunkX = Math.floor(tileX / this.chunkSize);
        const chunkY = Math.floor(tileY / this.chunkSize);
        for (let oy = -radiusChunks; oy <= radiusChunks; oy++) {
            for (let ox = -radiusChunks; ox <= radiusChunks; ox++) {
                this.activateChunk(chunkX + ox, chunkY + oy);
            }
        }
    }

    ensureChunksForViewport(viewport: WorldViewportRect, radiusChunks: number): void {
        const startChunkX = Math.floor(viewport.left / this.chunkSize) - radiusChunks;
        const endChunkX = Math.floor(Math.max(0, viewport.right - 0.001) / this.chunkSize) + radiusChunks;
        const startChunkY = Math.floor(viewport.top / this.chunkSize) - radiusChunks;
        const endChunkY = Math.floor(Math.max(0, viewport.bottom - 0.001) / this.chunkSize) + radiusChunks;

        for (let chunkY = startChunkY; chunkY <= endChunkY; chunkY++) {
            for (let chunkX = startChunkX; chunkX <= endChunkX; chunkX++) {
                this.activateChunk(chunkX, chunkY);
            }
        }
    }

    getTile(x: number, y: number): Tile | undefined {
        x = Math.floor(x);
        y = Math.floor(y);
        if (!this.isInBounds(x, y)) return undefined;
        return this.tiles[this.index(x, y)];
    }

    isVisibleSolid(x: number, y: number): boolean {
        const tile = this.getTile(x, y);
        return !!tile && tile.solid && this.isTileVisible(tile);
    }

    getTileVisibility(x: number, y: number): VisibilityState {
        const tile = this.getTile(x, y);
        if (!tile) return 'Unknown';
        if (tile.visibility !== 'Unknown') return tile.visibility;
        if (this.isBiomeNearOpen(x, y)) return 'EdgeHint';
        return 'Unknown';
    }

    mineWithTool(x: number, y: number, damage: number, mode: 'precise' | 'blunt', bluntRadius: number): TileDamageHit[] {
        const hits: TileDamageHit[] = [];
        const centerDamage = Math.max(1, Math.floor(damage));

        if (!this.rules.persistentTileDamage) {
            this.prepareTransientMineTarget(x, y);
        }

        if (mode === 'blunt' && bluntRadius > 0) {
            for (let oy = -bluntRadius; oy <= bluntRadius; oy++) {
                for (let ox = -bluntRadius; ox <= bluntRadius; ox++) {
                    const squaredDistance = ox * ox + oy * oy;
                    if (squaredDistance > bluntRadius * bluntRadius) continue;

                    const distance = Math.sqrt(squaredDistance);
                    const radiusRatio = bluntRadius <= 0 ? 0 : Math.min(1, distance / bluntRadius);
                    const falloffScale = 1 - (0.8 * radiusRatio);
                    const hitDamage = Math.max(1, Math.floor(centerDamage * falloffScale));

                    const hit = this.mineSingleAt(x + ox, y + oy, hitDamage);
                    if (!hit) continue;
                    hits.push(hit);
                }
            }
        } else {
            const hit = this.mineSingleAt(x, y, centerDamage);
            if (hit) hits.push(hit);
        }

        return hits;
    }

    revealFromEmptyClick(x: number, y: number): boolean {
        const tile = this.getTile(x, y);
        if (!tile || tile.solid) return false;
        if (tile.visibility === 'Unknown') return false;

        const changed = this.revealAround(x, y, 4);
        return changed > 0;
    }

    edgeMask8(x: number, y: number): { n: boolean; e: boolean; s: boolean; w: boolean; ne: boolean; se: boolean; sw: boolean; nw: boolean } {
        const n = this.isVisibleSolid(x, y - 1);
        const e = this.isVisibleSolid(x + 1, y);
        const s = this.isVisibleSolid(x, y + 1);
        const w = this.isVisibleSolid(x - 1, y);
        const ne = n && e && this.isVisibleSolid(x + 1, y - 1);
        const se = s && e && this.isVisibleSolid(x + 1, y + 1);
        const sw = s && w && this.isVisibleSolid(x - 1, y + 1);
        const nw = n && w && this.isVisibleSolid(x - 1, y - 1);
        return { n, e, s, w, ne, se, sw, nw };
    }

    edgeMaskSolid8(x: number, y: number): { n: boolean; e: boolean; s: boolean; w: boolean; ne: boolean; se: boolean; sw: boolean; nw: boolean } {
        const n = this.isSolidTile(x, y - 1);
        const e = this.isSolidTile(x + 1, y);
        const s = this.isSolidTile(x, y + 1);
        const w = this.isSolidTile(x - 1, y);
        const ne = n && e && this.isSolidTile(x + 1, y - 1);
        const se = s && e && this.isSolidTile(x + 1, y + 1);
        const sw = s && w && this.isSolidTile(x - 1, y + 1);
        const nw = n && w && this.isSolidTile(x - 1, y - 1);
        return { n, e, s, w, ne, se, sw, nw };
    }

    isSolidTile(x: number, y: number): boolean {
        const tile = this.getTile(x, y);
        return !!tile && tile.solid;
    }

    edgeMaskMineable8(x: number, y: number): { n: boolean; e: boolean; s: boolean; w: boolean; ne: boolean; se: boolean; sw: boolean; nw: boolean } {
        const n = this.isMineableFrontierSolid(x, y - 1);
        const e = this.isMineableFrontierSolid(x + 1, y);
        const s = this.isMineableFrontierSolid(x, y + 1);
        const w = this.isMineableFrontierSolid(x - 1, y);
        const ne = n && e && this.isMineableFrontierSolid(x + 1, y - 1);
        const se = s && e && this.isMineableFrontierSolid(x + 1, y + 1);
        const sw = s && w && this.isMineableFrontierSolid(x - 1, y + 1);
        const nw = n && w && this.isMineableFrontierSolid(x - 1, y - 1);
        return { n, e, s, w, ne, se, sw, nw };
    }

    isMineableFrontierSolid(x: number, y: number): boolean {
        const tile = this.getTile(x, y);
        if (!tile) return false;
        return this.isMineableSolidTile(x, y, tile);
    }

    isBiomeNearOpen(x: number, y: number): boolean {
        const tile = this.getTile(x, y);
        if (!tile || !tile.solid) return false;

        for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
                if (ox === 0 && oy === 0) continue;
                const neighbor = this.getTile(x + ox, y + oy);
                if (neighbor?.visibility === 'Open') return true;
            }
        }
        return false;
    }

    getChunkBounds(chunkX: number, chunkY: number): { startX: number; startY: number; endX: number; endY: number } {
        const startX = chunkX * this.chunkSize;
        const startY = chunkY * this.chunkSize;
        return {
            startX,
            startY,
            endX: Math.min(this.width, startX + this.chunkSize),
            endY: Math.min(this.height, startY + this.chunkSize),
        };
    }

    private index(x: number, y: number): number {
        return y * this.width + x;
    }

    private isInBounds(x: number, y: number): boolean {
        return x >= 0 && y >= 0 && x < this.width && y < this.height;
    }

    private generate(): void {
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const tile = shouldGenerateAsteroidBody(x, y, this.seed)
                    ? createSolidTile(0)
                    : createHiddenSpaceTile(0);
                this.tiles.push(tile);
            }
        }

        this.stabilizeAsteroidBodies();
        this.chooseBaseSpawn();
        this.ensureBaseEntity();
        this.ensureMainPlayerEntity();
        this.assignAsteroidBiomes();
        this.createStartCave();
        this.revealFromOpenTiles();
        this.applyEntityVisibility();
        this.ensureChunksAround(this.baseX, this.baseY, 1);
    }

    private stabilizeAsteroidBodies(): void {
        const nextSolid = new Uint8Array(this.tiles.length);

        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const index = this.index(x, y);
                const tile = this.tiles[index];
                const solidNeighbors = this.countSolidNeighbors(x, y);
                let solid = tile.solid;

                if (!solid && solidNeighbors >= 8) {
                    solid = true;
                } else if (solid && solidNeighbors <= 2) {
                    solid = false;
                }

                nextSolid[index] = solid ? 1 : 0;
            }
        }

        for (let index = 0; index < this.tiles.length; index++) {
            const tile = this.tiles[index];
            if (nextSolid[index] === 1) {
                tile.solid = true;
                tile.biome = 0;
                tile.hp = BIOME_DEFINITIONS[0].defaultHp;
                tile.visibility = 'Unknown';
            } else {
                tile.solid = false;
                tile.biome = 0;
                tile.hp = 0;
                tile.visibility = 'Unknown';
            }
        }
    }

    private chooseBaseSpawn(): void {
        let best: { x: number; y: number; score: number } | null = null;

        for (let y = 8; y < this.height - 8; y++) {
            for (let x = 8; x < this.width - 8; x++) {
                const tile = this.getTile(x, y);
                if (!tile || tile.solid) continue;
                if (getSpaceAreaTypeAtPosition(x, y, this.seed) !== 'safe') continue;

                let nearbySolid = 0;
                let nearbySafeSolid = 0;
                for (let oy = -5; oy <= 5; oy++) {
                    for (let ox = -5; ox <= 5; ox++) {
                        if (ox * ox + oy * oy > 25) continue;
                        const neighbor = this.getTile(x + ox, y + oy);
                        if (!neighbor?.solid) continue;
                        nearbySolid++;
                        const areaType = getSpaceAreaTypeAtPosition(x + ox, y + oy, this.seed);
                        if (areaType === 'safe') nearbySafeSolid++;
                    }
                }

                if (nearbySolid < 18) continue;
                const centerBias = 1 - Math.min(1, Math.hypot(x - WORLD_WIDTH * 0.5, y - WORLD_HEIGHT * 0.5) / (WORLD_WIDTH * 0.5));
                const score = nearbySafeSolid * 2 + nearbySolid + centerBias * 8;
                if (!best || score > best.score) {
                    best = { x, y, score };
                }
            }
        }

        this.baseXValue = best?.x ?? BASE_START_X;
        this.baseYValue = best?.y ?? BASE_START_Y;
    }

    private assignAsteroidBiomes(): void {
        const visited = new Uint8Array(this.tiles.length);
        const components: Array<Array<{ x: number; y: number }>> = [];

        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const startIndex = this.index(x, y);
                if (visited[startIndex] === 1) continue;
                const tile = this.tiles[startIndex];
                if (!tile.solid) continue;

                components.push(this.collectAsteroidComponent(x, y, visited));
            }
        }

        components.sort((left, right) => right.length - left.length);
        components.forEach((component, index) => {
            this.assignBiomeToAsteroidComponent(component, index);
        });
    }

    private collectAsteroidComponent(startX: number, startY: number, visited: Uint8Array): Array<{ x: number; y: number }> {
        const component: Array<{ x: number; y: number }> = [];
        const queue: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];
        visited[this.index(startX, startY)] = 1;

        while (queue.length > 0) {
            const current = queue.pop();
            if (!current) continue;
            component.push(current);

            for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                const tx = current.x + ox;
                const ty = current.y + oy;
                if (!this.isInBounds(tx, ty)) continue;
                const nextIndex = this.index(tx, ty);
                if (visited[nextIndex] === 1) continue;
                if (!this.tiles[nextIndex].solid) continue;
                visited[nextIndex] = 1;
                queue.push({ x: tx, y: ty });
            }
        }

        return component;
    }

    private assignBiomeToAsteroidComponent(component: Array<{ x: number; y: number }>, asteroidRank: number): void {
        if (component.length === 0) return;

        let sumX = 0;
        let sumY = 0;
        let containsBase = false;
        for (const tile of component) {
            sumX += tile.x;
            sumY += tile.y;
            if (Math.abs(tile.x - this.baseX) <= 10 && Math.abs(tile.y - this.baseY) <= 8) {
                containsBase = true;
            }
        }

        const anchorX = Math.round(sumX / component.length);
        const anchorY = Math.round(sumY / component.length);
        const specialSeed = surfaceNoise(anchorX * 3 + 11, anchorY * 3 - 7, this.seed);
        const anchorBiome = chooseBiomeForPosition(anchorX, anchorY, this.seed);
        const areaType = containsBase ? 'safe' : getSpaceAreaTypeAtPosition(anchorX, anchorY, this.seed);
        const bodyFlavor = this.pickAsteroidBodyFlavor(anchorX, anchorY, anchorBiome, component.length, containsBase, areaType);
        const forcedSpecialAsteroid = !containsBase && component.length >= 42 && asteroidRank < 4;
        const isSpecialAsteroid = !containsBase
            && component.length >= 42
            && bodyFlavor !== 0
            && (forcedSpecialAsteroid || specialSeed > 0.58);
        if (isSpecialAsteroid) {
            const specialBiome = this.pickSpecialAsteroidBiome(anchorX, anchorY, bodyFlavor);
            for (const tile of component) {
                const depth = this.computeAsteroidInteriorDepth(tile.x, tile.y);
                const layeredBiome = depth > 0.38 ? specialBiome : 0;
                this.applyBiomeToTile(tile.x, tile.y, layeredBiome);
            }
            return;
        }

        for (const tile of component) {
            let biome: 0 | 1 | 2 | 3 | 4 | 5 | 7 | 8 = 0;
            const edgeTile = this.isAsteroidEdgeTile(tile.x, tile.y);
            const depth = this.computeAsteroidInteriorDepth(tile.x, tile.y);
            const tileAreaType = getSpaceAreaTypeAtPosition(tile.x, tile.y, this.seed);
            const tileCandidate = chooseBiomeForPosition(tile.x, tile.y, this.seed);
            const tilePatchSeed = surfaceNoise(tile.x + anchorX * 2, tile.y + anchorY * 2, this.seed);

            if (!edgeTile && tileAreaType === 'danger' && depth > 0.34) {
                biome = tilePatchSeed > 0.78
                    ? this.normalizeBodyBiome(tileCandidate, 'danger')
                    : 8;
            }

            if (biome === 0 && !edgeTile && tileAreaType === 'safe' && depth > 0.5) {
                if (tilePatchSeed > 0.72) {
                    const safeBiome = this.normalizeBodyBiome(tileCandidate, 'safe');
                    biome = safeBiome === 0
                        ? (surfaceNoise(tile.x - anchorX, tile.y - anchorY, this.seed) > 0.55 ? 2 : 5)
                        : safeBiome;
                }
            }

            if (biome === 0 && !edgeTile && bodyFlavor !== 0 && component.length >= 40) {
                const requiredDepth = component.length >= 120 ? 0.42 : 0.5;
                if (depth > requiredDepth && tilePatchSeed > (component.length >= 120 ? 0.68 : 0.78)) {
                    biome = bodyFlavor;
                }
            }

            if (biome === 0 && !edgeTile && component.length >= 48) {
                if (depth > 0.56 && tileCandidate !== 0 && tilePatchSeed > 0.83) {
                    biome = this.normalizeBodyBiome(tileCandidate, tileAreaType);
                }
            }

            this.applyBiomeToTile(tile.x, tile.y, biome);
        }
    }

    private pickAsteroidBodyFlavor(
        anchorX: number,
        anchorY: number,
        anchorBiome: number,
        componentSize: number,
        containsBase: boolean,
        areaType: SpaceAreaType,
    ): 0 | 1 | 2 | 3 | 4 | 5 | 7 | 8 {
        if (containsBase || componentSize < 28) return 0;

        const normalizedAnchor = this.normalizeBodyBiome(anchorBiome, areaType);
        if (normalizedAnchor !== 0) return normalizedAnchor;

        const roll = surfaceNoise(anchorX * 7 + 19, anchorY * 7 - 31, this.seed);
        if (areaType === 'safe') {
            if (componentSize < 52) {
                if (roll < 0.78) return 0;
                if (roll < 0.88) return 2;
                if (roll < 0.96) return 5;
                return 1;
            }

            if (roll < 0.62) return 0;
            if (roll < 0.78) return 2;
            if (roll < 0.92) return 5;
            return 1;
        }

        if (areaType === 'danger') {
            if (componentSize < 52) {
                if (roll < 0.14) return 0;
                if (roll < 0.48) return 8;
                if (roll < 0.7) return 4;
                if (roll < 0.84) return 3;
                if (roll < 0.94) return 1;
                return 7;
            }

            if (roll < 0.08) return 0;
            if (roll < 0.46) return 8;
            if (roll < 0.68) return 4;
            if (roll < 0.84) return 3;
            if (roll < 0.93) return 1;
            return 7;
        }

        if (componentSize < 48) {
            if (roll < 0.84) return 0;
            if (roll < 0.88) return 1;
            if (roll < 0.92) return 2;
            if (roll < 0.95) return 4;
            if (roll < 0.98) return 5;
            return 7;
        }

        if (roll < 0.52) return 0;
        if (roll < 0.62) return 1;
        if (roll < 0.72) return 2;
        if (roll < 0.8) return 3;
        if (roll < 0.88) return 4;
        if (roll < 0.95) return 5;
        return 7;
    }

    private pickSpecialAsteroidBiome(anchorX: number, anchorY: number, anchorBiome: 0 | 1 | 2 | 3 | 4 | 5 | 7 | 8): 1 | 2 | 3 | 4 | 5 | 7 | 8 {
        const areaType = getSpaceAreaTypeAtPosition(anchorX, anchorY, this.seed);
        const normalizedAnchor = this.normalizeBodyBiome(anchorBiome, areaType);
        if (normalizedAnchor !== 0) return normalizedAnchor;

        const roll = surfaceNoise(anchorX * 5 - 17, anchorY * 5 + 23, this.seed);
        if (areaType === 'danger') {
            if (roll < 0.3) return 8;
            if (roll < 0.58) return 4;
            if (roll < 0.78) return 3;
            if (roll < 0.9) return 1;
            return 7;
        }

        if (roll < 0.18) return 1;
        if (roll < 0.36) return 2;
        if (roll < 0.54) return 3;
        if (roll < 0.72) return 4;
        if (roll < 0.88) return 5;
        return 7;
    }

    private normalizeBodyBiome(biome: number, areaType: SpaceAreaType): 0 | 1 | 2 | 3 | 4 | 5 | 7 | 8 {
        if (areaType === 'safe') {
            if (biome === 1 || biome === 2 || biome === 5) return biome;
            return 0;
        }

        if (areaType === 'danger') {
            if (biome === 1 || biome === 3 || biome === 4 || biome === 7) return biome;
            return biome === 6 ? 8 : 0;
        }

        if (biome === 1 || biome === 2 || biome === 3 || biome === 4 || biome === 5 || biome === 7) {
            return biome;
        }
        return 0;
    }

    private applyBiomeToTile(x: number, y: number, biome: 0 | 1 | 2 | 3 | 4 | 5 | 7 | 8): void {
        const tile = this.getTile(x, y);
        if (!tile || !tile.solid) return;
        tile.biome = biome;
        tile.hp = BIOME_DEFINITIONS[biome].defaultHp;
    }

    private computeAsteroidInteriorDepth(x: number, y: number): number {
        const maxScan = 8;
        let nearestExit = maxScan;

        for (const [ox, oy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
            [1, 1],
            [1, -1],
            [-1, 1],
            [-1, -1],
        ] as const) {
            let rayDepth = maxScan;
            for (let step = 1; step <= maxScan; step++) {
                if (!this.isSolidTile(x + ox * step, y + oy * step)) {
                    rayDepth = step - 1;
                    break;
                }
            }
            if (rayDepth < nearestExit) {
                nearestExit = rayDepth;
            }
        }

        const localNoise = (surfaceNoise(x * 2 + 7, y * 2 - 13, this.seed) - 0.5) * 0.12;
        return Math.max(0, Math.min(1, nearestExit / maxScan + localNoise));
    }

    private countSolidNeighbors(x: number, y: number): number {
        let count = 0;
        for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
                if (ox === 0 && oy === 0) continue;
                const neighbor = this.getTile(x + ox, y + oy);
                if (neighbor?.solid) count++;
            }
        }
        return count;
    }

    private isAsteroidEdgeTile(x: number, y: number): boolean {
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const neighbor = this.getTile(x + ox, y + oy);
            if (!neighbor?.solid) return true;
        }
        return false;
    }

    private createStartCave(): void {
        for (let y = this.baseY - 5; y <= this.baseY + 5; y++) {
            for (let x = this.baseX - 7; x <= this.baseX + 7; x++) {
                const dx = (x - this.baseX) / 7;
                const dy = (y - this.baseY) / 5;
                if (dx * dx + dy * dy < 1) this.openTile(x, y, false);
            }
        }
    }

    private openTile(x: number, y: number, reveal: boolean): void {
        const tile = this.getTile(x, y);
        if (!tile) return;

        carveOpen(tile);
        this.markModifiedAt(x, y);
        this.markChunkDirtyAt(x, y);

        for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
                this.markChunkDirtyAt(x + ox, y + oy);
            }
        }

        if (reveal) this.revealFrom(x, y);
    }

    private revealFromOpenTiles(): void {
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                if (this.getTile(x, y)?.visibility === 'Open') this.revealFrom(x, y);
            }
        }
    }

    private revealFrom(x: number, y: number): number {
        const source = this.getTile(x, y);
        const baseRadius = source ? BIOME_DEFINITIONS[source.biome].revealRadius : 1;
        let changed = 0;

        for (let oy = -6; oy <= 6; oy++) {
            for (let ox = -6; ox <= 6; ox++) {
                const tx = x + ox;
                const ty = y + oy;
                const tile = this.getTile(tx, ty);
                if (!tile) continue;

                const revealRadius = Math.max(baseRadius, BIOME_DEFINITIONS[tile.biome].revealRadius);
                if (ox * ox + oy * oy <= revealRadius * revealRadius) {
                    const before = tile.visibility;
                    if (!tile.solid) {
                        tile.visibility = 'Open';
                    } else if (tile.visibility !== 'Open') {
                        tile.visibility = 'Revealed';
                    }
                    if (tile.visibility !== before) changed++;
                    this.markChunkDirtyAt(tx, ty);
                }
            }
        }

        return changed;
    }

    private revealAround(x: number, y: number, radius: number): number {
        let changed = 0;
        for (let oy = -radius; oy <= radius; oy++) {
            for (let ox = -radius; ox <= radius; ox++) {
                if (ox * ox + oy * oy > radius * radius) continue;
                const tx = x + ox;
                const ty = y + oy;
                const tile = this.getTile(tx, ty);
                if (!tile) continue;

                const before = tile.visibility;
                if (!tile.solid) {
                    tile.visibility = 'Open';
                } else if (tile.visibility !== 'Open') {
                    tile.visibility = 'Revealed';
                }

                if (tile.visibility !== before) changed++;
                this.markChunkDirtyAt(tx, ty);
            }
        }
        return changed;
    }

    private revealAroundWithLimitedBiomePenetration(x: number, y: number, radius: number, biomePenetrationDepth: number): number {
        let changed = 0;

        for (let oy = -radius; oy <= radius; oy++) {
            for (let ox = -radius; ox <= radius; ox++) {
                if (ox * ox + oy * oy > radius * radius) continue;
                const tx = x + ox;
                const ty = y + oy;
                const tile = this.getTile(tx, ty);
                if (!tile) continue;

                const before = tile.visibility;

                // Open tiles get full illumination
                if (!tile.solid) {
                    tile.visibility = 'Open';
                } else {
                    // Solid tiles (biomes): only reveal if at the edge or within penetration depth
                    // Count distance to nearest open tile (but limit check for performance)
                    let distanceToOpen = Number.POSITIVE_INFINITY;
                    for (let checkY = Math.max(ty - biomePenetrationDepth - 1, 0); checkY <= Math.min(ty + biomePenetrationDepth + 1, this.heightValue - 1); checkY++) {
                        for (let checkX = Math.max(tx - biomePenetrationDepth - 1, 0); checkX <= Math.min(tx + biomePenetrationDepth + 1, this.widthValue - 1); checkX++) {
                            const checkTile = this.getTile(checkX, checkY);
                            if (checkTile && !checkTile.solid) {
                                const dist = Math.hypot(checkX - tx, checkY - ty);
                                if (dist < distanceToOpen) {
                                    distanceToOpen = dist;
                                }
                            }
                        }
                    }

                    // Reveal if at the edge or within penetration depth
                    if (distanceToOpen <= biomePenetrationDepth + 0.5) {
                        tile.visibility = 'Revealed';
                    }
                }

                if (tile.visibility !== before) changed++;
                this.markChunkDirtyAt(tx, ty);
            }
        }
        return changed;
    }

    private isTileVisible(tile: Tile): boolean {
        return tile.visibility === 'Open' || tile.visibility === 'Revealed' || tile.visibility === 'EdgeHint';
    }

    private prepareTransientMineTarget(x: number, y: number): void {
        const now = Date.now();
        const prev = this.transientMineState;

        if (prev && (prev.x !== x || prev.y !== y)) {
            this.resetTrackedTransientDamage();
        }

        const isContinuous = !!prev
            && prev.x === x
            && prev.y === y
            && now - prev.time <= this.rules.transientDamageWindowMs;

        if (!isContinuous) {
            this.resetTrackedTransientDamage();
        }

        this.transientMineState = { x, y, time: now };
    }

    private expireTransientDamageIfNeeded(): void {
        if (this.rules.persistentTileDamage || !this.transientMineState) return;
        const now = Date.now();
        if (now - this.transientMineState.time <= this.rules.transientDamageWindowMs) return;

        this.resetTrackedTransientDamage();
        this.transientMineState = null;
    }

    private resetTrackedTransientDamage(): void {
        if (this.transientDamageTiles.size === 0) return;
        for (const key of this.transientDamageTiles) {
            const [x, y] = key.split(',').map(Number);
            this.resetTileDamage(x, y);
        }
        this.transientDamageTiles.clear();
    }

    private trackTransientDamage(x: number, y: number): void {
        this.transientDamageTiles.add(`${x},${y}`);
    }

    private untrackTransientDamage(x: number, y: number): void {
        this.transientDamageTiles.delete(`${x},${y}`);
    }

    private mineSingleAt(x: number, y: number, damage: number): TileDamageHit | null {
        const tile = this.getTile(x, y);
        if (!tile || !this.isMineableSolidTile(x, y, tile)) return null;

        const beforeHp = tile.hp;
        const opened = damageTile(tile, damage);
        const dealt = Math.max(0, beforeHp - tile.hp);
        if (dealt <= 0) return null;

        if (opened) {
            this.openTile(x, y, true);
            this.untrackTransientDamage(x, y);
        } else {
            this.markModifiedAt(x, y);
            this.markChunkDirtyAt(x, y);
            if (!this.rules.persistentTileDamage) {
                this.trackTransientDamage(x, y);
            }
        }

        // Calculate ore yield based on damage fraction
        let oreYield = 0;
        let oreDefinitionId = 'debug-asteroid-ore';
        if (opened) {
            const biomeDef = BIOME_DEFINITIONS[tile.biome];
            const [yieldMin, yieldMax] = biomeDef.oreYield;
            const fraction = dealt / biomeDef.defaultHp;
            const tileOre = yieldMin + Math.floor(Math.random() * (yieldMax - yieldMin + 1));
            oreYield = Math.max(0, Math.round(fraction * tileOre));
            oreDefinitionId = getDropDefinitionIdForBiome(tile.biome);
        }

        // Award ore based on damage fraction for ANY damage dealt
        if (dealt > 0 && oreYield === 0) {
            const biomeDef = BIOME_DEFINITIONS[tile.biome];
            const [yieldMin, yieldMax] = biomeDef.oreYield;
            const fraction = dealt / biomeDef.defaultHp;
            const tileOre = yieldMin + Math.floor(Math.random() * (yieldMax - yieldMin + 1));
            oreYield = Math.max(0, Math.round(fraction * tileOre));
            oreDefinitionId = getDropDefinitionIdForBiome(tile.biome);
        }
        return {
            x,
            y,
            damage: dealt,
            remainingHp: tile.hp,
            opened,
            oreYield,
            oreDefinitionId,
        };
    }

    private isMineableSolidTile(x: number, y: number, tile: Tile): boolean {
        if (!tile.solid) return false;
        // Only allow mining on the frontier touching the carved/open path.
        return this.isBiomeNearOpen(x, y);
    }

    private resetTileDamage(x: number, y: number): void {
        const tile = this.getTile(x, y);
        if (!tile || !tile.solid) return;
        const defaultHp = BIOME_DEFINITIONS[tile.biome].defaultHp;
        if (tile.hp === defaultHp) return;
        tile.hp = defaultHp;
        this.markModifiedAt(x, y);
        this.markChunkDirtyAt(x, y);
    }

    private markChunkDirtyAt(x: number, y: number): void {
        if (!this.isInBounds(x, y)) return;
        const cx = Math.floor(x / this.chunkSize);
        const cy = Math.floor(y / this.chunkSize);
        this.dirtyChunks.add(`${cx},${cy}`);
    }

    private activateChunk(chunkX: number, chunkY: number): void {
        if (chunkX < 0 || chunkY < 0) return;
        this.ensureWorldContainsChunk(chunkX, chunkY);
        const key = `${chunkX},${chunkY}`;
        if (this.activeChunks.has(key)) return;
        this.activeChunks.add(key);
        this.dirtyChunks.add(key);
    }

    private markAllDirty(): void {
        const chunkRows = Math.ceil(this.height / this.chunkSize);
        const chunkColumns = Math.ceil(this.width / this.chunkSize);
        for (let cy = 0; cy < chunkRows; cy++) {
            for (let cx = 0; cx < chunkColumns; cx++) {
                this.dirtyChunks.add(`${cx},${cy}`);
            }
        }
    }

    private createProceduralTileAt(x: number, y: number, withBiomePass: boolean): Tile {
        if (!this.isStabilizedBodyAt(x, y)) {
            return createHiddenSpaceTile(0);
        }

        if (!withBiomePass) {
            return createSolidTile(0);
        }

        const areaType = getSpaceAreaTypeAtPosition(x, y, this.seed);
        const candidateBiome = chooseBiomeForPosition(x, y, this.seed);
        let biome = this.normalizeBodyBiome(candidateBiome, areaType);
        if (biome === 0 && areaType === 'danger' && surfaceNoise(x * 2 + 11, y * 2 - 7, this.seed) > 0.72) {
            biome = 8;
        }
        return createSolidTile(biome);
    }

    private isStabilizedBodyAt(x: number, y: number): boolean {
        const baseSolid = shouldGenerateAsteroidBody(x, y, this.seed);
        let neighbors = 0;
        for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
                if (ox === 0 && oy === 0) continue;
                if (shouldGenerateAsteroidBody(x + ox, y + oy, this.seed)) neighbors++;
            }
        }

        if (!baseSolid && neighbors >= 8) return true;
        if (baseSolid && neighbors <= 2) return false;
        return baseSolid;
    }

    private ensureWorldContainsTile(x: number, y: number): void {
        if (x < this.width && y < this.height) return;
        this.ensureWorldContainsChunk(
            Math.floor(Math.max(0, x) / this.chunkSize),
            Math.floor(Math.max(0, y) / this.chunkSize),
        );
    }

    private ensureWorldContainsChunk(chunkX: number, chunkY: number): void {
        const requiredWidth = (chunkX + 1) * this.chunkSize;
        const requiredHeight = (chunkY + 1) * this.chunkSize;
        if (requiredWidth <= this.width && requiredHeight <= this.height) return;

        const nextWidth = Math.max(this.width, requiredWidth);
        const nextHeight = Math.max(this.height, requiredHeight);
        this.expandWorld(nextWidth, nextHeight);
    }

    private expandWorld(nextWidth: number, nextHeight: number): void {
        const previousWidth = this.width;
        const previousHeight = this.height;
        if (nextWidth <= previousWidth && nextHeight <= previousHeight) return;

        const oldTiles = this.tiles.slice();
        const expandedTiles = new Array<Tile>(nextWidth * nextHeight);

        for (let y = 0; y < nextHeight; y++) {
            for (let x = 0; x < nextWidth; x++) {
                const nextIndex = y * nextWidth + x;
                if (x < previousWidth && y < previousHeight) {
                    expandedTiles[nextIndex] = oldTiles[y * previousWidth + x];
                } else {
                    expandedTiles[nextIndex] = this.createProceduralTileAt(x, y, true);
                }
            }
        }

        this.widthValue = nextWidth;
        this.heightValue = nextHeight;
        this.tiles.length = expandedTiles.length;
        for (let i = 0; i < expandedTiles.length; i++) {
            this.tiles[i] = expandedTiles[i];
        }

        const previousChunkColumns = Math.ceil(previousWidth / this.chunkSize);
        const previousChunkRows = Math.ceil(previousHeight / this.chunkSize);
        const nextChunkColumns = Math.ceil(nextWidth / this.chunkSize);
        const nextChunkRows = Math.ceil(nextHeight / this.chunkSize);

        for (let cy = 0; cy < nextChunkRows; cy++) {
            for (let cx = 0; cx < nextChunkColumns; cx++) {
                if (cx < previousChunkColumns && cy < previousChunkRows) continue;
                this.dirtyChunks.add(`${cx},${cy}`);
            }
        }
    }

    private ensureBaseEntity(): void {
        const existing = this.entities.get(BASE_ENTITY_ID);
        if (existing) {
            existing.x = this.baseXValue;
            existing.y = this.baseYValue;
            existing.visibilityRadius = BASE_VISIBILITY_RADIUS;
            existing.mobility = 'static';
            existing.kind = 'base';
            existing.parentId = null;
            existing.inventoryDef = existing.inventoryDef ?? {
                capacity: 48,
            };
            return;
        }

        this.entities.set(BASE_ENTITY_ID, {
            id: BASE_ENTITY_ID,
            kind: 'base',
            mobility: 'static',
            x: this.baseXValue,
            y: this.baseYValue,
            visibilityRadius: BASE_VISIBILITY_RADIUS,
            parentId: null,
            inventoryDef: {
                capacity: 48,
            },
            sizeDef: getEntityDefinition('base').sizeDef,
            viewDef: getEntityDefinition('base').viewDef,
        });
    }

    private getBaseEntity(): WorldEntity | null {
        return this.entities.get(BASE_ENTITY_ID) ?? null;
    }

    private findNearestStaticDropoffEntity(fromX: number, fromY: number): WorldEntity | null {
        let nearest: WorldEntity | null = null;
        let nearestDistance = Number.POSITIVE_INFINITY;
        for (const entity of this.entities.values()) {
            if (entity.mobility !== 'static') continue;
            if (entity.kind !== 'base' && entity.kind !== 'beacon') continue;
            const distance = Math.hypot(entity.x - fromX, entity.y - fromY);
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearest = entity;
            }
        }
        return nearest;
    }

    private ensureMainPlayerEntity(): void {
        const base = this.getBaseEntity();
        const playerSpawn = base ? this.findDeploymentTile(base, getEntityDefinition('player').sizeDef, MAIN_PLAYER_ENTITY_ID) : null;
        const existing = this.entities.get(MAIN_PLAYER_ENTITY_ID);
        if (existing) {
            existing.x = Math.round(existing.x);
            existing.y = Math.round(existing.y);
            existing.visibilityRadius = PLAYER_VISIBILITY_RADIUS;
            existing.mobility = 'dynamic';
            existing.kind = 'player';
            existing.parentId = null;
            existing.moveSpeedTilesPerSecond = existing.moveSpeedTilesPerSecond ?? PLAYER_MOVE_SPEED_TILES_PER_SECOND;
            existing.walking = existing.walking ?? {
                speedTilesPerSecond: existing.moveSpeedTilesPerSecond,
            };
            existing.builder = existing.builder ?? {
                buildRadius: PLAYER_BUILD_RADIUS,
                buildables: ['beacon'],
            };
            existing.inventoryDef = {
                capacity: 12,
                sharedId: 'main-player',
            };
            existing.miningDef = existing.miningDef ?? {
                minePower: 1,
                mineCooldownMs: 160,
                carryCapacity: 999,
            };
            existing.toolId = existing.toolId ?? 'starter-cutter';
            existing.minePower = existing.minePower ?? existing.miningDef.minePower;
            existing.mineCooldownMs = existing.mineCooldownMs ?? existing.miningDef.mineCooldownMs;
            existing.sizeDef = getEntityDefinition('player').sizeDef;
            existing.viewDef = getEntityDefinition('player').viewDef;
            if (base && this.isBaseFootprintOverlappingEntity(base, existing)) {
                const fallbackX = playerSpawn?.x ?? this.baseXValue + 3;
                const fallbackY = playerSpawn?.y ?? this.baseYValue;
                existing.x = fallbackX;
                existing.y = fallbackY;
            }
            return;
        }

        this.entities.set(MAIN_PLAYER_ENTITY_ID, {
            id: MAIN_PLAYER_ENTITY_ID,
            kind: 'player',
            mobility: 'dynamic',
            x: playerSpawn?.x ?? this.baseXValue + 3,
            y: playerSpawn?.y ?? this.baseYValue,
            visibilityRadius: PLAYER_VISIBILITY_RADIUS,
            moveSpeedTilesPerSecond: PLAYER_MOVE_SPEED_TILES_PER_SECOND,
            parentId: null,
            toolId: 'starter-cutter',
            minePower: 1,
            mineCooldownMs: 160,
            walking: {
                speedTilesPerSecond: PLAYER_MOVE_SPEED_TILES_PER_SECOND,
            },
            builder: {
                buildRadius: PLAYER_BUILD_RADIUS,
                buildables: ['beacon'],
            },
            inventoryDef: {
                capacity: 12,
                sharedId: 'main-player',
            },
            miningDef: {
                minePower: 1,
                mineCooldownMs: 160,
                carryCapacity: 999,
            },
            sizeDef: getEntityDefinition('player').sizeDef,
            viewDef: getEntityDefinition('player').viewDef,
        });
    }

    private isBaseFootprintOverlappingEntity(base: WorldEntity, entity: WorldEntity): boolean {
        const sizeX = Math.max(1, entity.sizeDef?.tilesX ?? 1);
        const sizeY = Math.max(1, entity.sizeDef?.tilesY ?? 1);
        const startX = Math.round(entity.x);
        const startY = Math.round(entity.y);
        for (let dy = 0; dy < sizeY; dy++) {
            for (let dx = 0; dx < sizeX; dx++) {
                if (Math.abs(startX + dx - base.x) <= 2 && Math.abs(startY + dy - base.y) <= 2) {
                    return true;
                }
            }
        }
        return false;
    }

    private getMainPlayerEntity(): WorldEntity | null {
        const player = this.entities.get(MAIN_PLAYER_ENTITY_ID) ?? null;
        if (!player || player.kind !== 'player') return null;
        return player;
    }

    private syncBaseFromEntity(): void {
        const base = this.getBaseEntity();
        if (!base) return;
        this.baseXValue = base.x;
        this.baseYValue = base.y;
    }

    private applyEntityVisibility(): void {
        for (const entity of this.entities.values()) {
            if (entity.kind === 'worker' && entity.deployed !== true) {
                continue;
            }
            if (entity.kind === 'beacon') {
                // Beacons have limited penetration into biomes (solid tiles)
                this.revealAroundWithLimitedBiomePenetration(entity.x, entity.y, Math.max(1, Math.floor(entity.visibilityRadius)), BEACON_BIOME_PENETRATION_DEPTH);
            } else {
                // Base and other entities illuminate fully
                this.revealAround(entity.x, entity.y, Math.max(1, Math.floor(entity.visibilityRadius)));
            }
        }
    }

    private applyWorkerVisibility(worker: WorldEntity): void {
        if (worker.kind !== 'worker') return;
        if (!worker.deployed) return;
        this.revealAround(worker.x, worker.y, Math.max(1, Math.floor(worker.visibilityRadius)));
    }

    private markModifiedAt(x: number, y: number): void {
        if (!this.isInBounds(x, y)) return;
        this.modifiedTiles.add(`${x},${y}`);
    }

    private findNearestBeacon(x: number, y: number): BeaconNode | null {
        let nearest: BeaconNode | null = null;
        let nearestDistance = Number.POSITIVE_INFINITY;
        for (const beacon of this.beacons) {
            const distance = Math.hypot(beacon.x - x, beacon.y - y);
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearest = beacon;
            }
        }
        return nearest;
    }

    private resolveBuilderEntity(builderEntityId?: string): WorldEntity | null {
        const requested = builderEntityId ? this.entities.get(builderEntityId) ?? null : null;
        if (requested) return requested;
        return this.getMainPlayerEntity();
    }

    private findOpenPath(
        fromX: number,
        fromY: number,
        toX: number,
        toY: number,
        maxSteps: number,
        sizeDef?: { tilesX: number; tilesY: number },
    ): Array<{ x: number; y: number }> | null {
        const perfStart = performance.now();
        fromX = Math.round(fromX);
        fromY = Math.round(fromY);
        toX = Math.round(toX);
        toY = Math.round(toY);

        const sw = sizeDef?.tilesX ?? 1;
        const sh = sizeDef?.tilesY ?? 1;

        /** Returns true when all tiles of the entity footprint anchored at (x,y) are walkable. */
        const canStand = (x: number, y: number): boolean => {
            for (let dy = 0; dy < sh; dy++) {
                for (let dx = 0; dx < sw; dx++) {
                    const t = this.getTile(x + dx, y + dy);
                    if (!t || t.solid) return false;
                }
            }
            return true;
        };

        if (!canStand(fromX, fromY) || !canStand(toX, toY)) {
            this.performanceStats.pathfindMs += performance.now() - perfStart;
            this.performanceStats.pathfindCalls += 1;
            return null;
        }

        const queue: Array<{ x: number; y: number }> = [{ x: fromX, y: fromY }];
        const previous = new Map<string, string | null>();
        previous.set(`${fromX},${fromY}`, null);

        let cursor = 0;
        while (cursor < queue.length && queue.length <= maxSteps) {
            const current = queue[cursor++];
            if (current.x === toX && current.y === toY) {
                const path: Array<{ x: number; y: number }> = [];
                let key: string | null = `${toX},${toY}`;
                while (key) {
                    const [px, py] = key.split(',').map(Number);
                    path.push({ x: px, y: py });
                    key = previous.get(key) ?? null;
                }
                path.reverse();
                this.performanceStats.pathfindMs += performance.now() - perfStart;
                this.performanceStats.pathfindCalls += 1;
                return path;
            }

            for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                const nx = current.x + ox;
                const ny = current.y + oy;
                const key = `${nx},${ny}`;
                if (previous.has(key)) continue;
                if (!canStand(nx, ny)) continue;
                previous.set(key, `${current.x},${current.y}`);
                queue.push({ x: nx, y: ny });
            }
        }

        this.performanceStats.pathfindMs += performance.now() - perfStart;
        this.performanceStats.pathfindCalls += 1;
        return null;
    }

    private findBeaconLinkPath(fromX: number, fromY: number, toX: number, toY: number, maxSteps: number): Array<{ x: number; y: number }> | null {
        const openPath = this.findOpenPath(fromX, fromY, toX, toY, maxSteps);
        if (openPath) return openPath;

        const linePath = this.buildLinePath(fromX, fromY, toX, toY);
        return linePath.length > 0 ? linePath : null;
    }

    private buildLinePath(fromX: number, fromY: number, toX: number, toY: number): Array<{ x: number; y: number }> {
        const points: Array<{ x: number; y: number }> = [];

        let x = fromX;
        let y = fromY;
        const dx = Math.abs(toX - fromX);
        const dy = Math.abs(toY - fromY);
        const sx = fromX < toX ? 1 : -1;
        const sy = fromY < toY ? 1 : -1;
        let err = dx - dy;

        while (true) {
            if (this.isInBounds(x, y)) {
                points.push({ x, y });
            }
            if (x === toX && y === toY) break;
            const e2 = err * 2;
            if (e2 > -dy) {
                err -= dy;
                x += sx;
            }
            if (e2 < dx) {
                err += dx;
                y += sy;
            }
        }

        return points;
    }

    private findDeploymentTile(building: WorldEntity, sizeDef?: EntitySizeDef, ignoreEntityId?: string): { x: number; y: number } | null {
        const minRadius = building.kind === 'base' ? 3 : 2;
        const maxRadius = 14;

        for (let radius = minRadius; radius <= maxRadius; radius++) {
            for (let oy = -radius; oy <= radius; oy++) {
                for (let ox = -radius; ox <= radius; ox++) {
                    if (Math.max(Math.abs(ox), Math.abs(oy)) !== radius) continue;
                    const tx = building.x + ox;
                    const ty = building.y + oy;
                    if (building.kind === 'base' && Math.abs(tx - building.x) <= 2 && Math.abs(ty - building.y) <= 2) continue;
                    if (!this.isFootprintClearAt(tx, ty, sizeDef, ignoreEntityId)) continue;
                    return { x: tx, y: ty };
                }
            }
        }

        return null;
    }

    private isFootprintClearAt(anchorX: number, anchorY: number, sizeDef: EntitySizeDef | undefined, ignoreEntityId?: string): boolean {
        const sizeX = Math.max(1, sizeDef?.tilesX ?? 1);
        const sizeY = Math.max(1, sizeDef?.tilesY ?? 1);

        for (let dy = 0; dy < sizeY; dy++) {
            for (let dx = 0; dx < sizeX; dx++) {
                const tx = anchorX + dx;
                const ty = anchorY + dy;
                if (!this.isInBounds(tx, ty)) return false;
                const tile = this.getTile(tx, ty);
                if (!tile || tile.solid || tile.visibility === 'Unknown') return false;
                if (this.isEntityOccupied(tx, ty, ignoreEntityId)) return false;
            }
        }

        return true;
    }

    private footprintTouchesTile(anchorX: number, anchorY: number, sizeDef: EntitySizeDef | undefined, targetX: number, targetY: number): boolean {
        const sizeX = Math.max(1, sizeDef?.tilesX ?? 1);
        const sizeY = Math.max(1, sizeDef?.tilesY ?? 1);
        for (let dy = 0; dy < sizeY; dy++) {
            for (let dx = 0; dx < sizeX; dx++) {
                const tx = anchorX + dx;
                const ty = anchorY + dy;
                if (Math.abs(tx - targetX) + Math.abs(ty - targetY) === 1) {
                    return true;
                }
            }
        }
        return false;
    }

    private findBestFitAnchorForSelectedTile(entity: WorldEntity, selectedX: number, selectedY: number): { x: number; y: number } | null {
        const sizeX = Math.max(1, entity.sizeDef?.tilesX ?? 1);
        const sizeY = Math.max(1, entity.sizeDef?.tilesY ?? 1);
        const currentX = Math.round(entity.x);
        const currentY = Math.round(entity.y);

        let best: { x: number; y: number; score: number } | null = null;

        // Try every pivot so the selected tile can map to any slot of the footprint.
        for (let pivotY = 0; pivotY < sizeY; pivotY++) {
            for (let pivotX = 0; pivotX < sizeX; pivotX++) {
                const anchorX = selectedX - pivotX;
                const anchorY = selectedY - pivotY;
                if (!this.isFootprintClearAt(anchorX, anchorY, entity.sizeDef, entity.id)) continue;

                // Prefer placements with smaller movement from current position.
                const moveScore = Math.abs(anchorX - currentX) + Math.abs(anchorY - currentY);
                // Tie-breaker: keep the clicked tile close to the footprint center.
                const centerX = anchorX + (sizeX - 1) / 2;
                const centerY = anchorY + (sizeY - 1) / 2;
                const centerScore = Math.abs(centerX - selectedX) + Math.abs(centerY - selectedY);
                const score = moveScore * 100 + centerScore;

                if (!best || score < best.score) {
                    best = { x: anchorX, y: anchorY, score };
                }
            }
        }

        return best ? { x: best.x, y: best.y } : null;
    }

    private findBestFitMoveTarget(
        entity: WorldEntity,
        selectedX: number,
        selectedY: number,
        maxSteps: number,
    ): { x: number; y: number; path: Array<{ x: number; y: number }> } | null {
        const sizeX = Math.max(1, entity.sizeDef?.tilesX ?? 1);
        const sizeY = Math.max(1, entity.sizeDef?.tilesY ?? 1);
        const currentX = Math.round(entity.x);
        const currentY = Math.round(entity.y);

        let best: { x: number; y: number; path: Array<{ x: number; y: number }>; score: number } | null = null;

        for (let pivotY = 0; pivotY < sizeY; pivotY++) {
            for (let pivotX = 0; pivotX < sizeX; pivotX++) {
                const anchorX = selectedX - pivotX;
                const anchorY = selectedY - pivotY;
                if (!this.isFootprintClearAt(anchorX, anchorY, entity.sizeDef, entity.id)) continue;

                const path = this.findOpenPath(currentX, currentY, anchorX, anchorY, maxSteps, entity.sizeDef);
                if (!path) continue;

                const pivotDistance = Math.abs(pivotX - (sizeX - 1) / 2) + Math.abs(pivotY - (sizeY - 1) / 2);
                const score = path.length * 100 + pivotDistance;

                if (!best || score < best.score) {
                    best = { x: anchorX, y: anchorY, path, score };
                }
            }
        }

        return best ? { x: best.x, y: best.y, path: best.path } : null;
    }

    private isEntityOccupied(x: number, y: number, ignoreEntityId?: string): boolean {
        for (const entity of this.entities.values()) {
            if (ignoreEntityId && entity.id === ignoreEntityId) continue;
            if (entity.kind === 'worker' && entity.deployed !== true) continue;

            const sizeX = entity.sizeDef?.tilesX ?? 1;
            const sizeY = entity.sizeDef?.tilesY ?? 1;
            const ex = Math.round(entity.x);
            const ey = Math.round(entity.y);

            if (x >= ex && x < ex + sizeX && y >= ey && y < ey + sizeY) {
                return true;
            }
        }
        return false;
    }

    private canWorkerMineTileForWorker(worker: WorldEntity, x: number, y: number): boolean {
        const tool = worker.toolId ? getToolDefinition(worker.toolId) : undefined;
        if (!tool || tool.tileDamage <= 0) return false;

        const tile = this.getTile(x, y);
        if (!tile || !tile.solid || tile.visibility === 'Unknown') return false;
        if (!this.isMineableFrontierSolid(x, y)) return false;
        if (this.isMineTargetReserved(x, y, worker.id)) return false;
        return true;
    }

    private findMineApproachPath(worker: WorldEntity, targetX: number, targetY: number): { path: Array<{ x: number; y: number }>; approachX: number; approachY: number } | null {
        const sizeX = Math.max(1, worker.sizeDef?.tilesX ?? 1);
        const sizeY = Math.max(1, worker.sizeDef?.tilesY ?? 1);
        const currentX = Math.round(worker.x);
        const currentY = Math.round(worker.y);
        let best: { path: Array<{ x: number; y: number }>; approachX: number; approachY: number; score: number } | null = null;

        for (let fy = 0; fy < sizeY; fy++) {
            for (let fx = 0; fx < sizeX; fx++) {
                for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                    const approachX = targetX + ox - fx;
                    const approachY = targetY + oy - fy;
                    if (!this.isFootprintClearAt(approachX, approachY, worker.sizeDef, worker.id)) continue;
                    if (!this.footprintTouchesTile(approachX, approachY, worker.sizeDef, targetX, targetY)) continue;
                    const path = this.findOpenPath(currentX, currentY, approachX, approachY, 25000, worker.sizeDef);
                    if (!path) continue;
                    const score = path.length * 100 + Math.abs(approachX - currentX) + Math.abs(approachY - currentY);
                    if (!best || score < best.score) {
                        best = { path, approachX, approachY, score };
                    }
                }
            }
        }

        return best ? { path: best.path, approachX: best.approachX, approachY: best.approachY } : null;
    }

    private findClosestMineTargetPlan(
        worker: WorldEntity,
        options: {
            anchorX: number;
            anchorY: number;
            lastMinedX: number;
            lastMinedY: number;
        },
    ): ScanNearestPlan | null {
        const perfStart = performance.now();
        const home = worker.homeId ? this.entities.get(worker.homeId) : this.getBaseEntity();
        const baseX = Math.round(home?.x ?? this.baseX);
        const baseY = Math.round(home?.y ?? this.baseY);

        const plan = this.scanNearestBehavior.chooseNextPlan({
            workerX: worker.x,
            workerY: worker.y,
            anchorX: options.anchorX,
            anchorY: options.anchorY,
            lastMinedX: options.lastMinedX,
            lastMinedY: options.lastMinedY,
            baseX,
            baseY,
            isOpenTile: (x, y) => {
                const tile = this.getTile(x, y);
                return !!tile && !tile.solid;
            },
            canTargetTile: (x, y) => this.canWorkerMineTileForWorker(worker, x, y),
            countSolidNeighbors: (x, y) => this.countSolidNeighbors(x, y),
            buildPath: (fromX, fromY, toX, toY) => this.findOpenPath(fromX, fromY, toX, toY, 25000, worker.sizeDef),
        });
        const minePlanDurationMs = performance.now() - perfStart;
        this.performanceStats.minePlanMs += minePlanDurationMs;
        this.performanceStats.minePlanMaxMs = Math.max(this.performanceStats.minePlanMaxMs, minePlanDurationMs);
        this.performanceStats.minePlanCalls += 1;
        return plan;
    }

    private reserveMineTarget(x: number, y: number, workerId: string): boolean {
        const key = `${x},${y}`;
        const reservedBy = this.mineReservations.get(key);
        if (reservedBy && reservedBy !== workerId) return false;
        this.mineReservations.set(key, workerId);
        return true;
    }

    private isMineTargetReserved(x: number, y: number, workerId: string): boolean {
        const reservedBy = this.mineReservations.get(`${x},${y}`);
        return !!reservedBy && reservedBy !== workerId;
    }

    private releaseMineTarget(x: number, y: number, workerId?: string): void {
        const key = `${x},${y}`;
        const reservedBy = this.mineReservations.get(key);
        if (!reservedBy) return;
        if (workerId && reservedBy !== workerId) return;
        this.mineReservations.delete(key);
    }

    private clearWorkerMining(worker: WorldEntity): void {
        if (worker.mining) {
            this.releaseMineTarget(worker.mining.targetX, worker.mining.targetY, worker.id);
        }
        worker.mining = null;
    }

    private clearWorkerMovement(worker: WorldEntity): void {
        worker.movement = null;
    }

    private getEntityCommandList(entity: WorldEntity): CommandListComponent<'move' | 'mine' | 'recall', { x?: number; y?: number; repeat?: boolean }> {
        return new CommandListComponent<'move' | 'mine' | 'recall', { x?: number; y?: number; repeat?: boolean }>(
            entity.commandList as CommandListState<'move' | 'mine' | 'recall', { x?: number; y?: number; repeat?: boolean }> ?? undefined,
        );
    }

    private setEntityCommandList(entity: WorldEntity, commandList: CommandListComponent<'move' | 'mine' | 'recall', { x?: number; y?: number; repeat?: boolean }>): void {
        entity.commandList = commandList.snapshot();
    }

    private completeCurrentEntityCommand(entity: WorldEntity): void {
        const commandList = this.getEntityCommandList(entity);
        commandList.completeCurrent();
        this.setEntityCommandList(entity, commandList);
    }

    private tryStartNextEntityCommand(entity: WorldEntity): void {
        if (entity.movement || entity.mining) return;
        if (entity.commandsPaused) return;
        if ((entity.commandRetryCooldownMs ?? 0) > 0) return;

        const commandList = this.getEntityCommandList(entity);
        const state = commandList.snapshot();
        if (state.current) return;

        const next = commandList.shiftNext();
        if (!next) {
            this.setEntityCommandList(entity, commandList);
            return;
        }

        let result: WorkerActionResult;
        if (next.type === 'move') {
            if (!Number.isFinite(next.payload.x) || !Number.isFinite(next.payload.y)) {
                result = { ok: false, reason: 'invalid_target' };
            } else {
                result = this.beginMoveWorkerTo(entity, Number(next.payload.x), Number(next.payload.y));
            }
        } else if (next.type === 'mine') {
            if (!Number.isFinite(next.payload.x) || !Number.isFinite(next.payload.y)) {
                result = { ok: false, reason: 'invalid_target' };
            } else {
                result = this.beginWorkerMining(entity, Number(next.payload.x), Number(next.payload.y), next.payload.repeat !== false);
            }
        } else {
            result = this.beginRecallWorker(entity);
        }

        if (result.ok) {
            entity.commandRetryCooldownMs = 0;
            this.setEntityCommandList(entity, commandList);
            return;
        }

        // Preserve repeat mining loops across transient failures (reservation/path contention),
        // but do not let retries accumulate in queue.
        if (next.type === 'mine' && next.payload.repeat !== false && (result.reason === 'path_blocked' || result.reason === 'invalid_target')) {
            commandList.completeCurrent();
            if (commandList.snapshot().queue.length === 0) {
                commandList.enqueue('mine', {
                    x: next.payload.x,
                    y: next.payload.y,
                    repeat: true,
                }, 'append');
            }
            entity.commandRetryCooldownMs = 300;
            this.setEntityCommandList(entity, commandList);
            return;
        }

        commandList.completeCurrent();
        entity.commandRetryCooldownMs = Math.max(entity.commandRetryCooldownMs ?? 0, 100);
        this.setEntityCommandList(entity, commandList);
    }

    private enqueueEntityCommand(
        entityId: string,
        command: { type: 'move' | 'mine' | 'recall'; x?: number; y?: number; repeat?: boolean },
        mode: EnqueueMode = 'append',
    ): EntityActionResult {
        const entity = this.entities.get(entityId);
        if (!entity) return { ok: false, reason: 'not_found' };

        if (command.type === 'move') {
            if (!entity.walking) return { ok: false, reason: 'not_movable' };
            if (!Number.isFinite(command.x) || !Number.isFinite(command.y)) return { ok: false, reason: 'invalid_target' };
        }

        if (command.type === 'mine') {
            if (!entity.miningDef) return { ok: false, reason: 'not_miner' };
            if (!Number.isFinite(command.x) || !Number.isFinite(command.y)) return { ok: false, reason: 'invalid_target' };
        }

        if (command.type === 'recall' && entity.kind !== 'worker') {
            return { ok: false, reason: 'invalid_target' };
        }

        if (entity.kind === 'worker' && (command.type === 'move' || command.type === 'mine') && !entity.deployed) {
            return { ok: false, reason: 'already_recalled' };
        }

        const commandList = this.getEntityCommandList(entity);
        if (mode === 'replace') {
            commandList.interruptCurrent();
            commandList.clearAll();
            this.clearWorkerMining(entity);
            this.clearWorkerMovement(entity);
        }

        commandList.enqueue(command.type, { x: command.x, y: command.y, repeat: command.repeat }, 'append');
        this.setEntityCommandList(entity, commandList);
        entity.commandRetryCooldownMs = 0;
        if (entity.commandsPaused) entity.commandsPaused = false;
        this.tryStartNextEntityCommand(entity);
        this.markChunkDirtyAt(entity.x, entity.y);
        return { ok: true, entity: { ...entity } };
    }

    private interruptEntityCommand(entityId: string): EntityActionResult {
        const entity = this.entities.get(entityId);
        if (!entity) return { ok: false, reason: 'not_found' };
        const commandList = this.getEntityCommandList(entity);
        if (!commandList.snapshot().current && !entity.mining && !entity.movement) {
            return { ok: false, reason: 'already_recalled' };
        }

        commandList.interruptCurrent();
        this.setEntityCommandList(entity, commandList);
        this.clearWorkerMining(entity);
        this.clearWorkerMovement(entity);
        entity.commandsPaused = false;
        this.tryStartNextEntityCommand(entity);
        this.markChunkDirtyAt(entity.x, entity.y);
        return { ok: true, entity: { ...entity } };
    }

    private clearEntityCommands(entityId: string): EntityActionResult {
        const entity = this.entities.get(entityId);
        if (!entity) return { ok: false, reason: 'not_found' };

        const commandList = this.getEntityCommandList(entity);
        commandList.clearAll();
        this.setEntityCommandList(entity, commandList);
        this.clearWorkerMining(entity);
        this.clearWorkerMovement(entity);
        this.markChunkDirtyAt(entity.x, entity.y);
        return { ok: true, entity: { ...entity } };
    }

    private removeQueuedEntityCommand(entityId: string, commandId: string): { ok: true } | { ok: false; reason: 'not_found' | 'invalid_target' } {
        const entity = this.entities.get(entityId);
        if (!entity) return { ok: false, reason: 'not_found' };

        const commandList = this.getEntityCommandList(entity);
        const removed = commandList.removeQueued(commandId);
        if (!removed) return { ok: false, reason: 'invalid_target' };
        this.setEntityCommandList(entity, commandList);
        this.markChunkDirtyAt(entity.x, entity.y);
        return { ok: true };
    }

    private asWorkerFailureReason(reason: EntityActionFailureReason): 'not_found' | 'not_worker' | 'invalid_building' | 'already_deployed' | 'already_recalled' | 'no_deploy_space' | 'invalid_target' | 'path_blocked' {
        if (reason === 'not_movable' || reason === 'not_miner') return 'invalid_target';
        return reason;
    }

    private asPlayerFailureReason(reason: EntityActionFailureReason): 'not_found' | 'invalid_target' | 'path_blocked' {
        if (reason === 'not_movable' || reason === 'not_miner') return 'invalid_target';
        if (reason === 'not_worker' || reason === 'invalid_building' || reason === 'already_deployed' || reason === 'already_recalled' || reason === 'no_deploy_space') {
            return 'invalid_target';
        }
        return reason;
    }

    private isInBaseDropoffZone(base: WorldEntity, x: number, y: number, sizeDef?: EntitySizeDef): boolean {
        if (base.kind !== 'base') return false;
        const sizeX = Math.max(1, sizeDef?.tilesX ?? 1);
        const sizeY = Math.max(1, sizeDef?.tilesY ?? 1);
        for (let dy = 0; dy < sizeY; dy++) {
            for (let dx = 0; dx < sizeX; dx++) {
                if (Math.abs(x + dx - base.x) <= 3 && Math.abs(y + dy - base.y) <= 3) {
                    return true;
                }
            }
        }
        return false;
    }

    private findNearestDropoffTile(base: WorldEntity, fromX: number, fromY: number, sizeDef?: EntitySizeDef, ignoreEntityId?: string): { x: number; y: number } | null {
        const perfStart = performance.now();
        const startX = Math.round(fromX);
        const startY = Math.round(fromY);
        const maxRadius = 4;
        let best: { x: number; y: number; score: number } | null = null;

        for (let oy = -maxRadius; oy <= maxRadius; oy++) {
            for (let ox = -maxRadius; ox <= maxRadius; ox++) {
                const tx = base.x + ox;
                const ty = base.y + oy;
                if (Math.max(Math.abs(ox), Math.abs(oy)) > maxRadius) continue;
                if (!this.isInBaseDropoffZone(base, tx, ty, sizeDef)) continue;
                if (!this.isFootprintClearAt(tx, ty, sizeDef, ignoreEntityId)) continue;
                const score = Math.abs(tx - startX) + Math.abs(ty - startY);
                if (!best || score < best.score) {
                    best = { x: tx, y: ty, score };
                }
            }
        }

        const result = best ? { x: best.x, y: best.y } : this.findDeploymentTile(base, sizeDef, ignoreEntityId);
        this.performanceStats.dropoffSearchMs += performance.now() - perfStart;
        this.performanceStats.dropoffSearchCalls += 1;
        return result;
    }

    private rebuildMineReservationsFromEntities(): void {
        this.mineReservations.clear();
        for (const entity of this.entities.values()) {
            if (entity.kind !== 'worker') continue;
            if (!entity.mining) continue;
            this.mineReservations.set(`${entity.mining.targetX},${entity.mining.targetY}`, entity.id);
        }
    }

    private applyBeaconPathLighting(path: Array<{ x: number; y: number }>): void {
        for (const point of path) {
            const tile = this.getTile(point.x, point.y);
            if (!tile) continue;
            if (!tile.solid) {
                tile.visibility = 'Open';
                this.markModifiedAt(point.x, point.y);
            }

            this.revealAround(point.x, point.y, 3);
            this.markChunkDirtyAt(point.x, point.y);
        }
    }

    private rebuildBeaconLighting(): void {
        if (this.beacons.length === 0) return;
        const beaconMap = new Map<string, BeaconNode>(this.beacons.map((beacon) => [beacon.id, beacon]));

        for (const beacon of this.beacons) {
            const source = beacon.parentId && beaconMap.has(beacon.parentId)
                ? beaconMap.get(beacon.parentId)
                : { x: this.baseX, y: this.baseY };
            if (!source) continue;
            const path = this.findBeaconLinkPath(source.x, source.y, beacon.x, beacon.y, 8000);
            if (!path) continue;
            this.applyBeaconPathLighting(path);
        }
    }

    private recalculateVisibilityFromCurrentState(): void {
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const tile = this.getTile(x, y);
                if (!tile) continue;
                tile.visibility = tile.solid ? 'Unknown' : 'Open';
                this.markChunkDirtyAt(x, y);
            }
        }

        this.revealFromOpenTiles();
        this.rebuildBeaconLighting();
        this.applyEntityVisibility();
    }
}
