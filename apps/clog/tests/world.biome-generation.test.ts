import { describe, expect, it } from 'vitest';
import { WorldModel } from '../src/game/world/WorldModel';
import { getBiomeGenerationNodeGraphMermaid, sampleBiomeAtPosition } from '../src/game/world/noise';
import { getWorkerDefinition } from '../src/game/content/workers';

describe('biome graph generation', () => {
    it('produces asteroid-dominant worlds with themed asteroid families', () => {
        const world = new WorldModel(1337);
        const biomes = new Set<number>();

        for (let y = 0; y < world.height; y += 4) {
            for (let x = 0; x < world.width; x += 4) {
                const tile = world.getTile(x, y);
                if (!tile?.solid) continue;
                biomes.add(tile.biome);
            }
        }

        expect(biomes.has(0)).toBe(true);
        expect(biomes.size).toBeGreaterThanOrEqual(2);
    });

    it('keeps the base inside a mostly safe asteroid region', () => {
        const world = new WorldModel(1337);
        expect(world.getTile(world.baseX, world.baseY)?.solid).toBe(false);

        let solidNearBase = 0;
        let safeNearBase = 0;
        let dangerNearBase = 0;

        for (let y = world.baseY - 18; y <= world.baseY + 18; y++) {
            for (let x = world.baseX - 18; x <= world.baseX + 18; x++) {
                const tile = world.getTile(x, y);
                if (!tile?.solid) continue;
                solidNearBase++;
                if (tile.biome === 0 || tile.biome === 2 || tile.biome === 5) safeNearBase++;
                if (tile.biome === 8 || tile.biome === 4) dangerNearBase++;
            }
        }

        expect(solidNearBase).toBeGreaterThan(80);
        expect(safeNearBase).toBeGreaterThan(Math.floor(solidNearBase * 0.7));
        expect(dangerNearBase).toBeLessThan(Math.ceil(solidNearBase * 0.08));
    });

    it('creates distinct danger asteroid zones', () => {
        const world = new WorldModel(1337);
        let dangerTiles = 0;

        for (let y = 0; y < world.height; y++) {
            for (let x = 0; x < world.width; x++) {
                const tile = world.getTile(x, y);
                if (tile?.solid && tile.biome === 8) {
                    dangerTiles++;
                }
            }
        }

        expect(dangerTiles).toBeGreaterThan(40);
    });

    it('activates a 3x3 chunk region around the base at start', () => {
        const world = new WorldModel(1337);
        const baseChunkX = Math.floor(world.baseX / world.chunkSize);
        const baseChunkY = Math.floor(world.baseY / world.chunkSize);
        const maxChunkX = Math.ceil(world.width / world.chunkSize) - 1;
        const maxChunkY = Math.ceil(world.height / world.chunkSize) - 1;

        for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
                const chunkX = baseChunkX + ox;
                const chunkY = baseChunkY + oy;
                if (chunkX < 0 || chunkY < 0 || chunkX > maxChunkX || chunkY > maxChunkY) {
                    continue;
                }
                expect(world.isChunkActive(baseChunkX + ox, baseChunkY + oy)).toBe(true);
            }
        }
    });

    it('expands world bounds when activating chunks beyond current edges', () => {
        const world = new WorldModel(1337);
        const initialWidth = world.width;
        const initialHeight = world.height;
        const outsideTileX = initialWidth + world.chunkSize * 2;
        const outsideTileY = initialHeight + world.chunkSize * 2;

        world.ensureChunksAround(outsideTileX, outsideTileY, 1);

        expect(world.width).toBeGreaterThan(initialWidth);
        expect(world.height).toBeGreaterThan(initialHeight);
        expect(world.getTile(outsideTileX, outsideTileY)).toBeDefined();
    });

    it('places beacons on carved paths and restores them from snapshot', () => {
        const world = new WorldModel(1337);
        const beacon = world.placeBeacon(world.baseX + 2, world.baseY);
        expect(beacon).toBeTruthy();
        expect(world.getBeacons().length).toBe(1);

        const baseEntity = world.getEntities().find((entry) => entry.kind === 'base');
        const beaconEntity = world.getEntities().find((entry) => entry.kind === 'beacon');
        expect(baseEntity).toBeTruthy();
        expect(baseEntity?.mobility).toBe('static');
        expect(beaconEntity).toBeTruthy();
        expect(beaconEntity?.parentId).toBe(baseEntity?.id ?? null);

        const snapshot = world.toSnapshot();
        const restored = new WorldModel(42);
        restored.applySnapshot(snapshot);

        expect(restored.getBeacons().length).toBe(1);
        expect(restored.getBeacons()[0].x).toBe(world.baseX + 2);
        expect(restored.getTile(world.baseX + 1, world.baseY)?.visibility).not.toBe('Unknown');
    });

    it('finds entities from tile hit tests', () => {
        const world = new WorldModel(1337);
        const placed = world.placeBeacon(world.baseX + 2, world.baseY);
        expect(placed).toBeTruthy();

        const beaconEntity = world.getEntities().find((entry) => entry.kind === 'beacon');
        expect(beaconEntity).toBeTruthy();
        expect(world.getEntityAtTile(world.baseX + 2, world.baseY)?.id).toBe(beaconEntity?.id);

        const baseEntity = world.getEntities().find((entry) => entry.kind === 'base');
        expect(baseEntity).toBeTruthy();
        expect(world.getEntityAtTile(world.baseX + 1, world.baseY + 1)?.id).toBe(baseEntity?.id);
    });

    it('removes beacons and reparents children to preserve links', () => {
        const world = new WorldModel(1337);
        const first = world.placeBeacon(world.baseX + 2, world.baseY);
        const second = world.placeBeacon(world.baseX + 4, world.baseY);
        expect(first).toBeTruthy();
        expect(second).toBeTruthy();

        const firstEntityId = `entity-${first?.id}`;
        const secondEntityId = `entity-${second?.id}`;
        const beforeParent = world.getEntityById(secondEntityId);
        expect(beforeParent?.parentId).toBe(firstEntityId);

        const removed = world.removeBeaconByEntityId(firstEntityId);
        expect(removed.ok).toBe(true);
        expect(world.getEntityById(firstEntityId)).toBeNull();

        const secondEntity = world.getEntityById(secondEntityId);
        expect(secondEntity).toBeTruthy();
        expect(secondEntity?.parentId).toBe('entity-base');
    });

    it('allows placing a beacon on an explored solid tile', () => {
        const world = new WorldModel(1337);
        const x = Math.min(world.width - 3, world.baseX + 22);
        const y = world.baseY;
        const tile = world.getTile(x, y);
        expect(tile).toBeTruthy();
        if (!tile) return;

        tile.solid = true;
        tile.visibility = 'Revealed';

        const beacon = world.placeBeacon(x, y);
        expect(beacon).toBeTruthy();
        expect(world.getEntities().some((entry) => entry.kind === 'beacon' && entry.x === x && entry.y === y)).toBe(true);
    });

    it('recalculates visibility when beacon is deleted', () => {
        const world = new WorldModel(1337);
        const x = Math.min(world.width - 3, world.baseX + 24);
        const y = world.baseY;

        const placementTile = world.getTile(x, y);
        const probeTile = world.getTile(x + 2, y);
        expect(placementTile).toBeTruthy();
        expect(probeTile).toBeTruthy();
        if (!placementTile || !probeTile) return;

        for (let oy = -10; oy <= 10; oy++) {
            for (let ox = -10; ox <= 10; ox++) {
                const local = world.getTile(x + ox, y + oy);
                if (!local) continue;
                local.solid = true;
                local.visibility = 'Unknown';
            }
        }

        placementTile.solid = true;
        placementTile.visibility = 'Revealed';
        probeTile.solid = true;
        probeTile.visibility = 'Unknown';

        const baseline = new Map<string, string>();
        for (let oy = -10; oy <= 10; oy++) {
            for (let ox = -10; ox <= 10; ox++) {
                const tx = x + ox;
                const ty = y + oy;
                const tile = world.getTile(tx, ty);
                if (!tile) continue;
                baseline.set(`${tx},${ty}`, tile.visibility);
            }
        }

        const beacon = world.placeBeacon(x, y);
        expect(beacon).toBeTruthy();

        const becameVisible = new Set<string>();
        for (const key of baseline.keys()) {
            const [tx, ty] = key.split(',').map(Number);
            const before = baseline.get(key);
            const after = world.getTile(tx, ty)?.visibility;
            if (before === 'Unknown' && after && after !== 'Unknown') {
                becameVisible.add(key);
            }
        }
        expect(becameVisible.size).toBeGreaterThan(0);

        const removed = world.removeBeaconByEntityId(`entity-${beacon?.id}`);
        expect(removed.ok).toBe(true);

        let reverted = 0;
        for (const key of becameVisible) {
            const [tx, ty] = key.split(',').map(Number);
            const now = world.getTile(tx, ty)?.visibility;
            if (now === 'Unknown') {
                reverted++;
            }
        }
        expect(reverted).toBeGreaterThan(0);
    });

    it('spawns workers at base and keeps them docked until deployment', () => {
        const world = new WorldModel(1337);
        const definition = getWorkerDefinition('basic-worker');
        const spawned = world.spawnWorkerAtBuilding('entity-base');
        expect(spawned.ok).toBe(true);
        if (!spawned.ok) return;

        const workers = world.getWorkersForBuilding('entity-base');
        expect(workers.length).toBe(1);
        expect(workers[0].kind).toBe('worker');
        expect(workers[0].deployed).toBe(false);
        expect(workers[0].hp).toBe(definition.maxHp);
        expect(workers[0].maxHp).toBe(definition.maxHp);
        expect(workers[0].moveSpeedTilesPerSecond).toBe(definition.moveSpeedTilesPerSecond);
        expect(workers[0].spawnTimeMs).toBe(definition.spawnTimeMs);
        expect(workers[0].toolId).toBe(definition.toolId);
        expect(workers[0].minePower).toBe(definition.minePower);
        expect(workers[0].mineCooldownMs).toBe(definition.mineCooldownMs);
        expect(workers[0].carryCapacity).toBe(definition.carryCapacity);
        expect(workers[0].visibilityRadius).toBe(8);

        const beacon = world.placeBeacon(world.baseX + 2, world.baseY);
        expect(beacon).toBeTruthy();
        const beaconEntity = world.getEntities().find((entry) => entry.kind === 'beacon');
        expect(beaconEntity?.visibilityRadius).toBe(10);
    });

    it('deploys and recalls worker units', () => {
        const world = new WorldModel(1337);
        world.clearDirtyChunks();

        const spawned = world.spawnWorkerAtBuilding('entity-base');
        expect(spawned.ok).toBe(true);
        if (!spawned.ok) return;

        const deployed = world.deployWorker(spawned.worker.id);
        expect(deployed.ok).toBe(true);
        if (!deployed.ok) return;
        expect(deployed.worker.deployed).toBe(true);
        expect(world.getEntityAtTile(deployed.worker.x, deployed.worker.y)?.id).toBe(deployed.worker.id);
        expect(world.getDirtyChunkKeys().length).toBeLessThan(20);

        const recalled = world.recallWorker(spawned.worker.id);
        expect(recalled.ok).toBe(true);
        if (!recalled.ok) return;
        expect(recalled.worker.deployed).toBe(false);

        const recallAll = world.recallWorkersForBuilding('entity-base');
        expect(recallAll.ok).toBe(true);
    });

    it('moves selected workers to reachable visible open tiles', () => {
        const world = new WorldModel(1337);
        const spawned = world.spawnWorkerAtBuilding('entity-base');
        expect(spawned.ok).toBe(true);
        if (!spawned.ok) return;

        const deployed = world.deployWorker(spawned.worker.id);
        expect(deployed.ok).toBe(true);
        if (!deployed.ok) return;

        let targetX = deployed.worker.x;
        let targetY = deployed.worker.y;
        for (let oy = -8; oy <= 8; oy++) {
            for (let ox = -8; ox <= 8; ox++) {
                const tx = deployed.worker.x + ox;
                const ty = deployed.worker.y + oy;
                const tile = world.getTile(tx, ty);
                if (!tile || tile.solid || tile.visibility === 'Unknown') continue;
                if (tx === deployed.worker.x && ty === deployed.worker.y) continue;
                if (world.getEntityAtTile(tx, ty)) continue;
                targetX = tx;
                targetY = ty;
                oy = 999;
                break;
            }
        }

        expect(targetX !== deployed.worker.x || targetY !== deployed.worker.y).toBe(true);

        const startX = deployed.worker.x;
        const startY = deployed.worker.y;
        const moved = world.moveWorkerTo(spawned.worker.id, targetX, targetY);
        expect(moved.ok).toBe(true);
        if (!moved.ok) return;

        const movingWorker = world.getEntityById(spawned.worker.id);
        expect(movingWorker).toBeTruthy();
        expect(movingWorker?.x).toBe(startX);
        expect(movingWorker?.y).toBe(startY);
        expect(movingWorker?.movement).toBeTruthy();

        let steps = 0;
        while (steps < 240) {
            world.tickFixed(100);
            const current = world.getEntityById(spawned.worker.id);
            expect(current).toBeTruthy();
            if (!current?.movement) break;
            steps++;
        }

        const arrived = world.getEntityById(spawned.worker.id);
        expect(arrived?.movement).toBeNull();
        expect(Math.round(arrived?.x ?? NaN)).toBe(targetX);
        expect(Math.round(arrived?.y ?? NaN)).toBe(targetY);
    });

    it('supports chained biome rules including cave and crystal cave', () => {
        const seen = new Set<number>();
        let sawCrystalType = false;

        for (let y = 0; y < 256; y++) {
            for (let x = 0; x < 256; x++) {
                const sample = sampleBiomeAtPosition(x, y, 1337);
                seen.add(sample.biome);
                if (sample.crystalType) {
                    sawCrystalType = true;
                }
            }
        }

        expect(seen.has(6)).toBe(true);
        expect(seen.has(7)).toBe(true);
        expect(sawCrystalType).toBe(true);
    });

    it('exports biome generation graph as mermaid', () => {
        const mermaid = getBiomeGenerationNodeGraphMermaid();
        expect(mermaid.startsWith('graph TD')).toBe(true);
        expect(mermaid.includes('Asteroid -> Lava Belts')).toBe(true);
        expect(mermaid.includes('Cave -> Crystal Caves')).toBe(true);
    });
});
