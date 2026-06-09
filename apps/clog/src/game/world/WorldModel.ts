import { BASE_START_X, BASE_START_Y, CHUNK_SIZE, GAME_RULES, WORLD_HEIGHT, WORLD_WIDTH } from '../config';
import { BIOME_DEFINITIONS } from '../content/biomes';
import { carveOpen, createSolidTile, damageTile } from '../content/tiles';
import type { TileDamageHit } from '../core/protocol';
import type { Tile, VisibilityState } from '../types';
import { chooseBiomeForPosition } from './noise';

export type SavedTile = {
    x: number;
    y: number;
    solid: boolean;
    hp: number;
    visibility: VisibilityState;
};

export type WorldSnapshot = {
    version: 1;
    seed: number;
    savedTiles: SavedTile[];
};

type WorldRules = {
    persistentTileDamage: boolean;
    transientDamageWindowMs: number;
};

export class WorldModel {
    readonly width = WORLD_WIDTH;
    readonly height = WORLD_HEIGHT;
    readonly chunkSize = CHUNK_SIZE;
    readonly baseX = BASE_START_X;
    readonly baseY = BASE_START_Y;

    private seed: number;
    private readonly tiles: Tile[] = [];
    private readonly dirtyChunks = new Set<string>();
    private readonly rules: WorldRules;
    private transientMineState: { x: number; y: number; time: number } | null = null;
    private transientDamageTiles = new Set<string>();

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
        this.generate();
    }

    toSnapshot(): WorldSnapshot {
        const savedTiles: SavedTile[] = [];

        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const tile = this.getTile(x, y);
                if (!tile) continue;

                const defaultHp = BIOME_DEFINITIONS[tile.biome].defaultHp;
                const hpChanged = this.rules.persistentTileDamage && tile.hp !== defaultHp;
                const shouldPersist = tile.visibility !== 'Unknown' || !tile.solid || hpChanged;
                if (!shouldPersist) continue;

                savedTiles.push({
                    x,
                    y,
                    solid: tile.solid,
                    hp: tile.hp,
                    visibility: tile.visibility,
                });
            }
        }

        return {
            version: 1,
            seed: this.seed,
            savedTiles,
        };
    }

    applySnapshot(snapshot: WorldSnapshot): void {
        this.reset(snapshot.seed);

        for (const saved of snapshot.savedTiles) {
            const tile = this.getTile(saved.x, saved.y);
            if (!tile) continue;
            tile.solid = saved.solid;
            tile.hp = this.rules.persistentTileDamage || !saved.solid
                ? saved.hp
                : BIOME_DEFINITIONS[tile.biome].defaultHp;
            tile.visibility = saved.visibility;
            this.markChunkDirtyAt(saved.x, saved.y);
        }

        this.markAllDirty();
    }

    getDirtyChunkKeys(): string[] {
        this.expireTransientDamageIfNeeded();
        return Array.from(this.dirtyChunks.values());
    }

    clearDirtyChunks(): void {
        this.dirtyChunks.clear();
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
                const biome = chooseBiomeForPosition(x, y, this.seed);
                this.tiles.push(createSolidTile(biome));
            }
        }

        this.createStartCave();
        this.revealFromOpenTiles();
        this.markAllDirty();
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

    private revealFrom(x: number, y: number): void {
        const source = this.getTile(x, y);
        const baseRadius = source ? BIOME_DEFINITIONS[source.biome].revealRadius : 1;

        for (let oy = -6; oy <= 6; oy++) {
            for (let ox = -6; ox <= 6; ox++) {
                const tx = x + ox;
                const ty = y + oy;
                const tile = this.getTile(tx, ty);
                if (!tile) continue;

                const revealRadius = Math.max(baseRadius, BIOME_DEFINITIONS[tile.biome].revealRadius);
                if (ox * ox + oy * oy <= revealRadius * revealRadius) {
                    if (tile.visibility !== 'Open') tile.visibility = 'Revealed';
                    this.markChunkDirtyAt(tx, ty);
                }
            }
        }
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
        this.markChunkDirtyAt(x, y);
    }

    private markChunkDirtyAt(x: number, y: number): void {
        if (!this.isInBounds(x, y)) return;
        const cx = Math.floor(x / this.chunkSize);
        const cy = Math.floor(y / this.chunkSize);
        this.dirtyChunks.add(`${cx},${cy}`);
    }

    private markAllDirty(): void {
        for (let cy = 0; cy < this.height / this.chunkSize; cy++) {
            for (let cx = 0; cx < this.width / this.chunkSize; cx++) {
                this.dirtyChunks.add(`${cx},${cy}`);
            }
        }
    }
}
