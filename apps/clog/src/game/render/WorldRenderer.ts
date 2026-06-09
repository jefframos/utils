import { Container, Graphics } from 'pixi.js';
import { LOD_TILE_DETAIL_MIN_ZOOM, TILE_SIZE } from '../config';
import { BIOME_DEFINITIONS } from '../content/biomes';
import { spaceDustStrength, surfaceNoise } from '../world/noise';
import { WorldModel } from '../world/WorldModel';

export class WorldRenderer {
    private readonly chunkViews = new Map<string, Graphics>();
    private readonly entityOverlay = new Graphics();

    constructor(
        private readonly world: WorldModel,
        private readonly worldLayer: Container,
        private readonly worldOverlayLayer: Container,
    ) {
        this.worldOverlayLayer.addChild(this.entityOverlay);
        this.drawEntityMarkers();
    }

    flushDirtyChunks(cameraZoom: number): void {
        for (const key of this.world.getDirtyChunkKeys()) {
            const [cx, cy] = key.split(',').map(Number);
            let chunkGraphic = this.chunkViews.get(key);
            if (!chunkGraphic) {
                chunkGraphic = new Graphics();
                this.chunkViews.set(key, chunkGraphic);
                this.worldLayer.addChild(chunkGraphic);
            }
            if (cameraZoom < LOD_TILE_DETAIL_MIN_ZOOM) {
                this.drawChunkSummary(cx, cy, chunkGraphic);
            } else {
                this.drawChunk(cx, cy, chunkGraphic);
            }
        }

        this.drawEntityMarkers();
        this.world.clearDirtyChunks();
    }

    private drawChunk(cx: number, cy: number, graphic: Graphics): void {
        graphic.clear();
        const startX = cx * this.world.chunkSize;
        const startY = cy * this.world.chunkSize;

        for (let y = startY; y < startY + this.world.chunkSize; y++) {
            for (let x = startX; x < startX + this.world.chunkSize; x++) {
                const tile = this.world.getTile(x, y);
                if (!tile) continue;
                const visibility = this.world.getTileVisibility(x, y);
                if (visibility === 'Unknown') continue;

                const px = x * TILE_SIZE;
                const py = y * TILE_SIZE;

                if (!tile.solid) {
                    graphic.rect(px, py, TILE_SIZE, TILE_SIZE).fill(0x090b12);

                    const dust = spaceDustStrength(x, y, this.world.getSeed());
                    if (dust > 0.8) {
                        const dustAlpha = Math.min(0.4, 0.08 + (dust - 0.8) * 1.1);
                        graphic.rect(px + 6, py + 6, 2, 2).fill({ color: 0x6ee7f9, alpha: dustAlpha });
                    } else if (dust > 0.67) {
                        const hazeAlpha = Math.min(0.18, 0.04 + (dust - 0.67) * 0.5);
                        graphic.rect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4).fill({ color: 0x0f172a, alpha: hazeAlpha });
                    }
                    continue;
                }

                const biome = BIOME_DEFINITIONS[tile.biome];
                const edgeOnly = visibility === 'EdgeHint';
                graphic.rect(px, py, TILE_SIZE, TILE_SIZE).fill(edgeOnly ? 0x08090e : biome.fill);

                if (!edgeOnly && tile.hp > 0 && tile.hp < biome.defaultHp) {
                    const damageAlpha = Math.min(0.55, 0.12 + (1 - tile.hp / biome.defaultHp) * 0.45);
                    graphic.rect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2).fill({ color: 0x000000, alpha: damageAlpha });
                }

                if (!edgeOnly && surfaceNoise(x, y, this.world.getSeed()) > 0.78) {
                    graphic.rect(px + 5, py + 5, 3, 3).fill(biome.glow);
                }

                if (this.world.isMineableFrontierSolid(x, y)) {
                    const mask = this.world.edgeMaskSolid8(x, y);
                    const thickness = 2;
                    if (!mask.n) graphic.rect(px, py, TILE_SIZE, thickness).fill(biome.edge);
                    if (!mask.e) graphic.rect(px + TILE_SIZE - thickness, py, thickness, TILE_SIZE).fill(biome.edge);
                    if (!mask.s) graphic.rect(px, py + TILE_SIZE - thickness, TILE_SIZE, thickness).fill(biome.edge);
                    if (!mask.w) graphic.rect(px, py, thickness, TILE_SIZE).fill(biome.edge);

                    const c = 4;
                    if (mask.n && mask.e && !mask.ne) graphic.poly([px + TILE_SIZE, py, px + TILE_SIZE, py + c, px + TILE_SIZE - c, py]).fill(biome.edge);
                    if (mask.s && mask.e && !mask.se) graphic.poly([px + TILE_SIZE, py + TILE_SIZE, px + TILE_SIZE - c, py + TILE_SIZE, px + TILE_SIZE, py + TILE_SIZE - c]).fill(biome.edge);
                    if (mask.s && mask.w && !mask.sw) graphic.poly([px, py + TILE_SIZE, px, py + TILE_SIZE - c, px + c, py + TILE_SIZE]).fill(biome.edge);
                    if (mask.n && mask.w && !mask.nw) graphic.poly([px, py, px + c, py, px, py + c]).fill(biome.edge);
                }

                const fogAlpha = this.fogAlphaForVisibility(visibility, x, y);
                if (fogAlpha > 0) {
                    graphic.rect(px, py, TILE_SIZE, TILE_SIZE).fill({ color: 0x030712, alpha: fogAlpha });
                }
            }
        }
    }

    private fogAlphaForVisibility(visibility: 'Open' | 'Revealed' | 'EdgeHint', x: number, y: number): number {
        if (visibility === 'Open') return 0;

        const base = visibility === 'EdgeHint' ? 0.66 : 0.34;
        const mist = (surfaceNoise(x + 17, y - 29, this.world.getSeed()) - 0.5) * 0.12;
        return Math.max(0, Math.min(0.78, base + mist));
    }

    private drawChunkSummary(cx: number, cy: number, graphic: Graphics): void {
        graphic.clear();
        const bounds = this.world.getChunkBounds(cx, cy);
        let visible = 0;
        let open = 0;
        const biomeCounts = new Map<number, number>();

        for (let y = bounds.startY; y < bounds.endY; y++) {
            for (let x = bounds.startX; x < bounds.endX; x++) {
                const tile = this.world.getTile(x, y);
                if (!tile) continue;
                const visibility = this.world.getTileVisibility(x, y);
                if (visibility === 'Unknown') continue;
                visible++;
                if (!tile.solid) open++;
                biomeCounts.set(tile.biome, (biomeCounts.get(tile.biome) ?? 0) + 1);
            }
        }

        if (visible === 0) return;

        let dominantBiome = 0;
        let maxCount = -1;
        for (const [biomeId, count] of biomeCounts) {
            if (count > maxCount) {
                maxCount = count;
                dominantBiome = biomeId;
            }
        }

        const biome = BIOME_DEFINITIONS[dominantBiome as keyof typeof BIOME_DEFINITIONS];
        const chunkWorldSize = this.world.chunkSize * TILE_SIZE;
        const px = bounds.startX * TILE_SIZE;
        const py = bounds.startY * TILE_SIZE;
        const openness = open / visible;

        graphic.rect(px, py, chunkWorldSize, chunkWorldSize).fill(openness > 0.4 ? 0x0c1220 : biome.fill);
        graphic.rect(px, py, chunkWorldSize, chunkWorldSize).stroke({ color: biome.edge, width: 1, alpha: 0.4 });
    }

    private drawEntityMarkers(): void {
        this.entityOverlay.clear();

        for (const entity of this.world.getEntities()) {
            const px = entity.x * TILE_SIZE;
            const py = entity.y * TILE_SIZE;

            if (entity.kind === 'base') {
                this.entityOverlay.rect((entity.x - 2) * TILE_SIZE, (entity.y - 2) * TILE_SIZE, TILE_SIZE * 5, TILE_SIZE * 5).fill(0x1d4ed8);
                this.entityOverlay.rect((entity.x - 1) * TILE_SIZE, (entity.y - 1) * TILE_SIZE, TILE_SIZE * 3, TILE_SIZE * 3).fill(0x93c5fd);
                continue;
            }

            if (entity.kind === 'beacon') {
                this.entityOverlay.rect(px + 4, py + 4, TILE_SIZE - 8, TILE_SIZE - 8).fill(0xf59e0b);
                this.entityOverlay.rect(px + 6, py + 6, TILE_SIZE - 12, TILE_SIZE - 12).fill(0xfbbf24);
            }
        }
    }
}
