export type WorkerUnitType = 'basic-worker' | 'large-worker';

export type WorkerDefinition = {
    id: WorkerUnitType;
    name: string;
    maxHp: number;
    moveSpeedTilesPerSecond: number;
    spawnTimeMs: number;
    toolId: string;
    minePower: number;
    mineCooldownMs: number;
    carryCapacity: number;
    visibilityRadius: number;
    /** Footprint in tiles (default 1×1). Large workers occupy 2×2. */
    sizeX: number;
    sizeY: number;
    /** Inventory slots this unit can carry. */
    inventoryCapacity: number;
};

export const WORKER_DEFINITIONS: Record<WorkerUnitType, WorkerDefinition> = {
    'basic-worker': {
        id: 'basic-worker',
        name: 'Basic Worker',
        maxHp: 60,
        moveSpeedTilesPerSecond: 1.15,
        spawnTimeMs: 1800,
        toolId: 'starter-cutter',
        minePower: 1,
        mineCooldownMs: 1400,
        carryCapacity: 99,
        visibilityRadius: 6,
        sizeX: 1,
        sizeY: 1,
        inventoryCapacity: 1,
    },
    'large-worker': {
        id: 'large-worker',
        name: 'Heavy Excavator',
        maxHp: 200,
        moveSpeedTilesPerSecond: 0.5,
        spawnTimeMs: 5000,
        toolId: 'starter-cutter',
        minePower: 4,
        mineCooldownMs: 2200,
        carryCapacity: 99,
        visibilityRadius: 10,
        sizeX: 2,
        sizeY: 2,
        inventoryCapacity: 4,
    },
};

export function getWorkerDefinition(workerType: WorkerUnitType): WorkerDefinition {
    return WORKER_DEFINITIONS[workerType];
}
