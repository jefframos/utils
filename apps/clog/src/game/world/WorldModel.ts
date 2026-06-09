import { BASE_START_X, BASE_START_Y, CHUNK_SIZE, GAME_RULES, WORLD_HEIGHT, WORLD_WIDTH } from '../config';
import { BIOME_DEFINITIONS } from '../content/biomes';
import { carveOpen, createHiddenSpaceTile, createSolidTile, damageTile } from '../content/tiles';
import type { TileDamageHit } from '../core/protocol';
import type { Tile, VisibilityState } from '../types';
import {
    chooseBiomeForPosition,
    getSpaceAreaTypeAtPosition,
    shouldGenerateAsteroidBody,
    surfaceNoise,
    type SpaceAreaType,
} from './noise';
import type { WorldViewportRect } from '../camera/GameCamera';

export type SavedTile = {
    x: number;
    y: number;
    solid: boolean;
    hp: number;
    visibility: VisibilityState;
};

export type WorldEntityKind = 'base' | 'beacon';
export type WorldEntityMobility = 'static' | 'dynamic';

export type WorldEntity = {
    id: string;
    kind: WorldEntityKind;
    mobility: WorldEntityMobility;
    x: number;
    y: number;
    visibilityRadius: number;
    parentId: string | null;
};

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
const BASE_VISIBILITY_RADIUS = 7;
const BEACON_VISIBILITY_RADIUS = 4;

type BeaconNode = SavedBeacon;

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
    private readonly rules: WorldRules;
    private transientMineState: { x: number; y: number; time: number } | null = null;
    private transientDamageTiles = new Set<string>();
    private baseXValue = BASE_START_X;
    private baseYValue = BASE_START_Y;
    private nextBeaconIndex = 1;

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
        this.nextBeaconIndex = 1;
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
                this.entities.set(entity.id, { ...entity });
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
            }
            this.syncBaseFromEntity();
        }

        this.ensureBaseEntity();
        this.rebuildBeaconLighting();
        this.applyEntityVisibility();
        this.markAllDirty();
    }

    getBeaconPlacementFailureReason(x: number, y: number): 'too_far' | 'not_open' | 'already_exists' | 'unknown_tile' {
        const tile = this.getTile(x, y);
        if (!tile) return 'unknown_tile';
        // Allow placement on open tiles or mineable frontier solids (breakable tiles)
        if (tile.solid && !this.isMineableFrontierSolid(x, y)) return 'not_open';
        if (tile.visibility === 'Unknown') return 'not_open';
        if (this.beacons.some((entry) => entry.x === x && entry.y === y)) return 'already_exists';

        const MAX_LINK_DISTANCE = 56;
        const parent = this.findNearestBeacon(x, y);
        const source = parent
            ? { x: parent.x, y: parent.y }
            : { x: this.baseX, y: this.baseY };
        const distance = Math.hypot(x - source.x, y - source.y);
        if (distance > MAX_LINK_DISTANCE) return 'too_far';

        return 'unknown_tile';
    }

    placeBeacon(x: number, y: number): SavedBeacon | null {
        this.ensureWorldContainsTile(x, y);
        const tile = this.getTile(x, y);
        // Allow placement on open tiles or mineable frontier solids (breakable tiles)
        if (!tile || (tile.solid && !this.isMineableFrontierSolid(x, y))) return null;
        if (tile.visibility === 'Unknown') return null;
        if (this.beacons.some((entry) => entry.x === x && entry.y === y)) return null;

        const MAX_LINK_DISTANCE = 56;
        const parent = this.findNearestBeacon(x, y);
        const source = parent
            ? { id: parent.id, x: parent.x, y: parent.y }
            : { id: null as string | null, x: this.baseX, y: this.baseY };

        const distance = Math.hypot(x - source.x, y - source.y);
        if (distance > MAX_LINK_DISTANCE) return null;

        // For open tiles, require a path; for breakable tiles, skip path requirement
        let path: Array<{ x: number; y: number }> | null = null;
        if (!tile.solid) {
            path = this.findOpenPath(source.x, source.y, x, y, MAX_LINK_DISTANCE * 6);
            if (!path) return null;
        }

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

        if (path) {
            this.applyBeaconPathLighting(path);
        }
        this.applyEntityVisibility();
        this.markModifiedAt(x, y);
        return { ...beacon };
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

        return {
            x,
            y,
            damage: dealt,
            remainingHp: tile.hp,
            opened,
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
        });
    }

    private getBaseEntity(): WorldEntity | null {
        return this.entities.get(BASE_ENTITY_ID) ?? null;
    }

    private syncBaseFromEntity(): void {
        const base = this.getBaseEntity();
        if (!base) return;
        this.baseXValue = base.x;
        this.baseYValue = base.y;
    }

    private applyEntityVisibility(): void {
        for (const entity of this.entities.values()) {
            this.revealAround(entity.x, entity.y, Math.max(1, Math.floor(entity.visibilityRadius)));
        }
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

    private findOpenPath(fromX: number, fromY: number, toX: number, toY: number, maxSteps: number): Array<{ x: number; y: number }> | null {
        const startTile = this.getTile(fromX, fromY);
        const targetTile = this.getTile(toX, toY);
        if (!startTile || !targetTile || startTile.solid || targetTile.solid) return null;

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
                return path;
            }

            for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                const nx = current.x + ox;
                const ny = current.y + oy;
                const key = `${nx},${ny}`;
                if (previous.has(key)) continue;
                const nextTile = this.getTile(nx, ny);
                if (!nextTile || nextTile.solid) continue;
                previous.set(key, `${current.x},${current.y}`);
                queue.push({ x: nx, y: ny });
            }
        }

        return null;
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
            const path = this.findOpenPath(source.x, source.y, beacon.x, beacon.y, 8000);
            if (!path) continue;
            this.applyBeaconPathLighting(path);
        }
    }
}
