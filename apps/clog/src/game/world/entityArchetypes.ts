import { getWorkerDefinition } from '../content/workers';
import { CommandListComponent } from '../core/CommandListComponent';
import type {
    PlayerEntityCommandList,
    PlayerEntityCommandPayload,
    PlayerEntityCommandType,
    WorkerEntityCommandList,
    WorkerEntityCommandPayload,
    WorkerEntityCommandType,
    WorldEntity,
} from './WorldModel';

export type VisibilityComponent = {
    radius: number;
};

export type WalkingComponent = {
    speedTilesPerSecond: number;
};

export type BuilderComponent = {
    buildRadius: number;
    buildables: Array<'beacon'>;
};

export type MiningComponent = {
    minePower: number;
    mineCooldownMs: number;
    carryCapacity: number;
};

export type InventoryComponent = {
    capacity: number;
    sharedId?: string;
};

export type LifeComponent = {
    hp: number;
    maxHp: number;
};

export type EntityComponents = {
    visibility: VisibilityComponent;
    walking?: WalkingComponent;
    builder?: BuilderComponent;
    mining?: MiningComponent;
    inventory?: InventoryComponent;
    life?: LifeComponent;
};

export type EntityDefaults = {
    baseVisibilityRadius: number;
    playerVisibilityRadius: number;
    playerMoveSpeedTilesPerSecond: number;
    playerBuildRadius: number;
    beaconVisibilityRadius: number;
};

export function getEntityComponents(entity: WorldEntity): EntityComponents {
    return {
        visibility: { radius: entity.visibilityRadius },
        walking: entity.walking
            ? {
                speedTilesPerSecond: entity.walking.speedTilesPerSecond,
            }
            : undefined,
        builder: entity.builder
            ? {
                buildRadius: entity.builder.buildRadius,
                buildables: [...entity.builder.buildables],
            }
            : undefined,
        mining: entity.miningDef
            ? {
                minePower: entity.miningDef.minePower,
                mineCooldownMs: entity.miningDef.mineCooldownMs,
                carryCapacity: entity.miningDef.carryCapacity,
            }
            : undefined,
        inventory: entity.inventoryDef
            ? {
                capacity: entity.inventoryDef.capacity,
                sharedId: entity.inventoryDef.sharedId,
            }
            : undefined,
        life: Number.isFinite(entity.hp) && Number.isFinite(entity.maxHp)
            ? {
                hp: Number(entity.hp),
                maxHp: Number(entity.maxHp),
            }
            : undefined,
    };
}

export function createBaseEntity(id: string, x: number, y: number, defaults: EntityDefaults): WorldEntity {
    return {
        id,
        kind: 'base',
        mobility: 'static',
        x,
        y,
        visibilityRadius: defaults.baseVisibilityRadius,
        parentId: null,
    };
}

export function createPlayerEntity(id: string, x: number, y: number, defaults: EntityDefaults): WorldEntity {
    return {
        id,
        kind: 'player',
        mobility: 'dynamic',
        x,
        y,
        visibilityRadius: defaults.playerVisibilityRadius,
        moveSpeedTilesPerSecond: defaults.playerMoveSpeedTilesPerSecond,
        parentId: null,
        walking: {
            speedTilesPerSecond: defaults.playerMoveSpeedTilesPerSecond,
        },
        builder: {
            buildRadius: defaults.playerBuildRadius,
            buildables: ['beacon'],
        },
        inventoryDef: {
            capacity: 999,
            sharedId: 'main-player',
        },
        miningDef: {
            minePower: 1,
            mineCooldownMs: 160,
            carryCapacity: 999,
        },
        hp: 100,
        maxHp: 100,
    };
}

export function createWorkerMinerEntity(id: string, homeId: string, x: number, y: number): WorldEntity {
    const definition = getWorkerDefinition('basic-worker');
    return {
        id,
        kind: 'worker',
        mobility: 'dynamic',
        x,
        y,
        visibilityRadius: definition.visibilityRadius,
        parentId: homeId,
        unitType: 'basic-worker',
        homeId,
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
            capacity: 1,
        },
        commandList: CommandListComponent.createEmpty<WorkerEntityCommandType, WorkerEntityCommandPayload>(),
    };
}

export function normalizeEntityByKind(entity: WorldEntity, defaults: EntityDefaults): WorldEntity {
    if (entity.kind === 'beacon') {
        return {
            ...entity,
            visibilityRadius: defaults.beaconVisibilityRadius,
        };
    }

    if (entity.kind === 'player') {
        const moveSpeed = entity.moveSpeedTilesPerSecond ?? defaults.playerMoveSpeedTilesPerSecond;
        return {
            ...entity,
            x: Math.round(entity.x),
            y: Math.round(entity.y),
            visibilityRadius: defaults.playerVisibilityRadius,
            mobility: 'dynamic',
            parentId: null,
            moveSpeedTilesPerSecond: moveSpeed,
            walking: entity.walking ?? {
                speedTilesPerSecond: moveSpeed,
            },
            builder: entity.builder ?? {
                buildRadius: defaults.playerBuildRadius,
                buildables: ['beacon'],
            },
            inventoryDef: entity.inventoryDef ?? {
                capacity: 999,
                sharedId: 'main-player',
            },
            miningDef: entity.miningDef ?? {
                minePower: 1,
                mineCooldownMs: 160,
                carryCapacity: 999,
            },
            hp: entity.hp ?? 100,
            maxHp: entity.maxHp ?? 100,
            commandList: new CommandListComponent<PlayerEntityCommandType, PlayerEntityCommandPayload>(
                entity.commandList as PlayerEntityCommandList ?? undefined,
            ).snapshot(),
        };
    }

    if (entity.kind === 'worker') {
        const definition = getWorkerDefinition(entity.unitType ?? 'basic-worker');
        const moveSpeed = entity.moveSpeedTilesPerSecond ?? definition.moveSpeedTilesPerSecond;
        const minePower = entity.minePower ?? definition.minePower;
        const mineCooldownMs = entity.mineCooldownMs ?? definition.mineCooldownMs;
        const carryCapacity = entity.carryCapacity ?? definition.carryCapacity;
        const normalizedMining = entity.mining
            ? {
                ...entity.mining,
                anchorX: entity.mining.anchorX ?? entity.mining.targetX,
                anchorY: entity.mining.anchorY ?? entity.mining.targetY,
                lastMinedX: entity.mining.lastMinedX ?? entity.mining.targetX,
                lastMinedY: entity.mining.lastMinedY ?? entity.mining.targetY,
            }
            : null;

        return {
            ...entity,
            visibilityRadius: definition.visibilityRadius,
            hp: entity.hp ?? definition.maxHp,
            maxHp: entity.maxHp ?? definition.maxHp,
            moveSpeedTilesPerSecond: moveSpeed,
            spawnTimeMs: entity.spawnTimeMs ?? definition.spawnTimeMs,
            toolId: entity.toolId ?? definition.toolId,
            minePower,
            mineCooldownMs,
            carryCapacity,
            mining: normalizedMining,
            walking: entity.walking ?? {
                speedTilesPerSecond: moveSpeed,
            },
            miningDef: entity.miningDef ?? {
                minePower,
                mineCooldownMs,
                carryCapacity,
            },
            inventoryDef: entity.inventoryDef ?? {
                capacity: 1,
            },
            commandList: new CommandListComponent<WorkerEntityCommandType, WorkerEntityCommandPayload>(
                entity.commandList as WorkerEntityCommandList ?? undefined,
            ).snapshot(),
        };
    }

    return entity;
}
