import { describe, expect, it } from 'vitest';
import { WorldModel } from '../src/game/world/WorldModel';
import { getBiomeGenerationNodeGraphMermaid, sampleBiomeAtPosition } from '../src/game/world/noise';

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
