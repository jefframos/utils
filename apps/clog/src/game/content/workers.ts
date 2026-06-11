export type WorkerDefinition = {
    id: 'basic-worker';
    name: string;
    maxHp: number;
    moveSpeedTilesPerSecond: number;
    spawnTimeMs: number;
    toolId: string;
    minePower: number;
    mineCooldownMs: number;
    carryCapacity: number;
    visibilityRadius: number;
};

export const WORKER_DEFINITIONS: Record<WorkerDefinition['id'], WorkerDefinition> = {
    'basic-worker': {
        id: 'basic-worker',
        name: 'Basic Worker',
        maxHp: 60,
        moveSpeedTilesPerSecond: 1.15,
        spawnTimeMs: 1800,
        toolId: 'starter-cutter',
        minePower: 1,
        mineCooldownMs: 1400,
        carryCapacity: 6,
        visibilityRadius: 8,
    },
};

export function getWorkerDefinition(workerType: WorkerDefinition['id']): WorkerDefinition {
    return WORKER_DEFINITIONS[workerType];
}
