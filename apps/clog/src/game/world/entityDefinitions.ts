/**
 * Entity Definitions
 * Centralized data for entity types: costs, build capabilities, limits, and properties.
 * This decouples entity data from behavior logic and makes capabilities explicit.
 */

export type EntityDefinitionId = 'base' | 'outpost' | 'player' | 'worker-miner' | 'beacon';

export type BuildCapability = 'beacon' | 'outpost' | 'worker-miner';

export interface BuilderDefinition {
    buildable: BuildCapability[];
    buildLimit?: Record<string, number>; // Max of each type this builder can have
}

export interface SpawnerDefinition {
    spawnable: BuildCapability[];
    spawnLimit?: Record<string, number>; // Max of each type this spawner can host
}

export interface CostDefinition {
    ore: number;
}

export interface EntityDefinition {
    id: EntityDefinitionId;
    displayName: string;
    cost: CostDefinition;
    mobility: 'static' | 'dynamic';
    baseVisibilityRadius: number;
    components: {
        movement?: { baseSpeedTilesPerSecond: number };
        mining?: { minePower: number; mineCooldownMs: number; carryCapacity: number };
        inventory?: { capacity: number };
        life?: { maxHp: number };
        builder?: BuilderDefinition;
        spawner?: SpawnerDefinition;
    };
}

export const ENTITY_DEFINITIONS: Record<EntityDefinitionId, EntityDefinition> = {
    'base': {
        id: 'base',
        displayName: 'Space Station',
        cost: { ore: 0 },
        mobility: 'static',
        baseVisibilityRadius: 7,
        components: {
            life: { maxHp: 500 },
            spawner: {
                spawnable: ['worker-miner'],
                spawnLimit: { 'worker-miner': 10 },
            },
        },
    },

    'outpost': {
        id: 'outpost',
        displayName: 'Outpost',
        cost: { ore: 20 },
        mobility: 'static',
        baseVisibilityRadius: 5,
        components: {
            life: { maxHp: 150 },
            spawner: {
                spawnable: ['worker-miner'],
                spawnLimit: { 'worker-miner': 4 },
            },
        },
    },

    'player': {
        id: 'player',
        displayName: 'Hero',
        cost: { ore: 0 },
        mobility: 'dynamic',
        baseVisibilityRadius: 14,
        components: {
            movement: { baseSpeedTilesPerSecond: 2.5 },
            mining: { minePower: 1, mineCooldownMs: 160, carryCapacity: 999 },
            inventory: { capacity: 12 },
            life: { maxHp: 100 },
            builder: {
                buildable: ['beacon', 'outpost'],
            },
        },
    },

    'worker-miner': {
        id: 'worker-miner',
        displayName: 'Basic Worker',
        cost: { ore: 5 },
        mobility: 'dynamic',
        baseVisibilityRadius: 8,
        components: {
            movement: { baseSpeedTilesPerSecond: 2.0 },
            mining: { minePower: 1, mineCooldownMs: 200, carryCapacity: 1 },
            inventory: { capacity: 1 },
            life: { maxHp: 50 },
        },
    },

    'beacon': {
        id: 'beacon',
        displayName: 'Beacon',
        cost: { ore: 10 },
        mobility: 'static',
        baseVisibilityRadius: 10,
        components: {
            life: { maxHp: 100 },
        },
    },
};

export function getEntityDefinition(id: EntityDefinitionId): EntityDefinition {
    const def = ENTITY_DEFINITIONS[id];
    if (!def) {
        throw new Error(`Unknown entity definition: ${id}`);
    }
    return def;
}

export function getEntityCost(id: EntityDefinitionId): CostDefinition {
    return getEntityDefinition(id).cost;
}

export function getBuilderSpawnLimit(
    builderId: EntityDefinitionId,
    spawnableType: BuildCapability,
): number | undefined {
    const builder = getEntityDefinition(builderId);
    return builder.components.spawner?.spawnLimit?.[spawnableType];
}

export function getBuilderBuildLimit(
    builderId: EntityDefinitionId,
    buildableType: BuildCapability,
): number | undefined {
    const builder = getEntityDefinition(builderId);
    return builder.components.builder?.buildLimit?.[buildableType];
}
