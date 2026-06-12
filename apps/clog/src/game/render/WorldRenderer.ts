import { Container, Graphics } from 'pixi.js';
import { LOD_TILE_DETAIL_MIN_ZOOM, TILE_SIZE } from '../config';
import { BIOME_DEFINITIONS } from '../content/biomes';
import { getEntityDefinition } from '../content/entityDefinitions';
import { spaceDustStrength, surfaceNoise } from '../world/noise';
import { WorldModel } from '../world/WorldModel';

export class WorldRenderer {
    private readonly chunkViews = new Map<string, Graphics>();
    private readonly entityOverlay = new Graphics();
    private selectedEntityId: string | null = null;

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

    setSelectedEntity(entityId: string | null): void {
        if (this.selectedEntityId === entityId) return;
        this.selectedEntityId = entityId;
        this.drawEntityMarkers();
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
            const isSelected = entity.id === this.selectedEntityId;

            // Always read from the entity's stamped definitions (falls back to registry lookup)
            const def = getEntityDefinition(entity.kind, entity.unitType);
            const sizeDef = entity.sizeDef ?? def.sizeDef;
            const viewDef = entity.viewDef ?? def.viewDef;

            const color = parseInt(viewDef.color.replace('#', ''), 16);

            const px = entity.x * TILE_SIZE;
            const py = entity.y * TILE_SIZE;
            const w = sizeDef.tilesX * TILE_SIZE;
            const h = sizeDef.tilesY * TILE_SIZE;

            if (entity.kind === 'base') {
                // Base uses a fixed decorative two-layer rect; respect its sizeDef for selection ring
                const bx = (Math.round(entity.x) - 2) * TILE_SIZE;
                const by = (Math.round(entity.y) - 2) * TILE_SIZE;
                this.entityOverlay.rect(bx, by, TILE_SIZE * 5, TILE_SIZE * 5).fill(0x1d4ed8);
                this.entityOverlay.rect(bx + TILE_SIZE, by + TILE_SIZE, TILE_SIZE * 3, TILE_SIZE * 3).fill(0x93c5fd);
                if (isSelected) {
                    this.entityOverlay.rect(bx, by, TILE_SIZE * 5, TILE_SIZE * 5).stroke({ color: 0xffffff, width: 3, alpha: 0.9 });
                }
                continue;
            }

            if (entity.kind === 'beacon') {
                const margin = 4;
                this.entityOverlay.rect(px + margin, py + margin, TILE_SIZE - margin * 2, TILE_SIZE - margin * 2).fill(color);
                this.entityOverlay.rect(px + margin + 2, py + margin + 2, TILE_SIZE - margin * 2 - 4, TILE_SIZE - margin * 2 - 4).fill(0xfbbf24);
                if (isSelected) {
                    this.entityOverlay.rect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4).stroke({ color: 0xffffff, width: 2, alpha: 0.95 });
                }
                continue;
            }

            if (entity.kind === 'player') {
                const cx = px + TILE_SIZE * 0.5;
                const cy = py + TILE_SIZE * 0.5;
                this.entityOverlay.circle(cx, cy, 6).fill(color);
                this.entityOverlay.circle(cx, cy, 3).fill(0xf3e8ff);
                if (isSelected) {
                    this.entityOverlay.circle(cx, cy, 8).stroke({ color: 0xffffff, width: 2, alpha: 0.95 });
                }
                continue;
            }

            if (entity.kind === 'worker' && entity.deployed) {
                const margin = 3;
                // Filled body sized to footprint
                this.entityOverlay.rect(px + margin, py + margin, w - margin * 2, h - margin * 2).fill(color);
                // Inner highlight dot at top-left cell center
                const dotR = Math.max(2, Math.min(4, (TILE_SIZE - 8) / 2));
                this.entityOverlay.circle(px + TILE_SIZE * 0.5, py + TILE_SIZE * 0.5, dotR).fill(0xffffff);
                if (isSelected) {
                    this.entityOverlay.rect(px + 1, py + 1, w - 2, h - 2).stroke({ color: 0xffffff, width: 2, alpha: 0.95 });
                }
            }
        }
    }
}
