import { Application, BitmapFont, BitmapText, Container, FederatedPointerEvent, Graphics, Point } from 'pixi.js';
import {
    TILE_SIZE,
    ZOOM_IN_FACTOR,
    ZOOM_MAX,
    ZOOM_MIN,
    ZOOM_OUT_FACTOR
} from '../config';
import type { ToolDefinition } from '../core/ToolComponent';
import type { GameTransport, TileDamageHit } from '../core/protocol';
import { GameCamera, type WorldViewportRect } from '../camera/GameCamera';
import { ViewportSpace } from '../core/ViewportSpace';
import { WorldRenderer } from '../render/WorldRenderer';
import { WorldModel } from '../world/WorldModel';
import { createContextMenuTemplate } from '../ui/ContextMenuTemplate';

export class GameScene {
    private static damagePopupFontInstalled = false;

    private readonly camera = new Container();
    private readonly backgroundLayer = new Container();
    private readonly worldLayer = new Container();
    private readonly worldOverlayLayer = new Container();
    private readonly damageOverlayLayer = new Container();
    private readonly screenOverlayLayer = new Container();
    private readonly debugScreenCenter = new Graphics();
    private readonly debugWorldCenter = new Graphics();
    private readonly debugCenterDelta = new Graphics();

    private readonly gameCamera: GameCamera;
    private readonly viewportSpace: ViewportSpace;
    private readonly renderer: WorldRenderer;
    private readonly cameraChangedListeners = new Set<() => void>();
    private debugOverlayEnabled = false;
    private isMiddlePanning = false;
    private readonly lastPanPointer = new Point();
    private isPrimaryMining = false;
    private readonly primaryMiningPointer = new Point();
    private primaryHoldMineCooldownMs = 0;
    private readonly damagePopups: Array<{ sprite: BitmapText; ttlMs: number; ageMs: number; velocityY: number }> = [];
    private readonly worldContextMenu = createContextMenuTemplate();

    constructor(
        private readonly app: Application,
        private readonly world: WorldModel,
        private readonly transport: GameTransport,
        private readonly getPrimaryTool: () => ToolDefinition,
        private readonly onToolSelected: (toolId: string) => void,
        private readonly getAvailableOre: () => number = () => 0,
    ) {
        this.gameCamera = new GameCamera(this.app, this.camera);
        this.viewportSpace = ViewportSpace.initialize(this.app, this.gameCamera);
        this.renderer = new WorldRenderer(this.world, this.worldLayer, this.worldOverlayLayer);
    }

    getViewportWorldRectTiles(): WorldViewportRect {
        const rect = this.viewportSpace.getWorldRect();
        return {
            left: rect.left / TILE_SIZE,
            top: rect.top / TILE_SIZE,
            right: rect.right / TILE_SIZE,
            bottom: rect.bottom / TILE_SIZE,
        };
    }

    centerCameraOnTile(tileX: number, tileY: number): void {
        const screenCenter = this.viewportSpace.getScreenCenter();
        this.gameCamera.centerOnWorldAtStage(
            (tileX + 0.5) * TILE_SIZE,
            (tileY + 0.5) * TILE_SIZE,
            screenCenter.x,
            screenCenter.y,
        );
        this.notifyCameraChanged();
    }

    centerCameraOnBase(): void {
        this.centerCameraOnTile(this.world.baseX, this.world.baseY);
    }

    initialize(): void {
        document.body.appendChild(this.worldContextMenu.getRoot());
        this.mountLayers();
        this.setupBackground();
        this.setupCameraStart();
        this.world.ensureChunksAround(this.world.baseX, this.world.baseY, 1);
        this.world.ensureChunksForViewport(this.getViewportWorldRectTiles(), 1);
        this.setupInput();
        this.setupTransport();
        this.setupDebugOverlay();

        this.renderer.flushDirtyChunks(this.camera.scale.x);
        this.app.ticker.add(() => {
            this.world.ensureChunksForViewport(this.getViewportWorldRectTiles(), 1);
            this.renderer.flushDirtyChunks(this.camera.scale.x);
            this.updateHoldMining(this.app.ticker.deltaMS);
            this.updateDamagePopups(this.app.ticker.deltaMS);
            if (this.debugOverlayEnabled) {
                this.updateDebugOverlay();
            }
        });
    }

    setDebugOverlayEnabled(enabled: boolean): void {
        this.debugOverlayEnabled = enabled;
        this.screenOverlayLayer.visible = enabled;
        if (enabled) {
            this.updateDebugOverlay();
        }
    }

    isDebugOverlayVisible(): boolean {
        return this.debugOverlayEnabled;
    }

    onCameraChanged(listener: () => void): () => void {
        this.cameraChangedListeners.add(listener);
        return () => {
            this.cameraChangedListeners.delete(listener);
        };
    }

    private notifyCameraChanged(): void {
        for (const listener of this.cameraChangedListeners) {
            listener();
        }
    }

    private setupTransport(): void {
        this.transport.onEvent((event) => {
            if (event.type === 'WorldChunkDirty') {
                this.renderer.flushDirtyChunks(this.camera.scale.x);
            } else if (event.type === 'TileDamaged') {
                this.spawnDamagePopups(event.hits);
            }
        });
    }

    private mountLayers(): void {
        this.camera.addChild(this.backgroundLayer);
        this.camera.addChild(this.worldLayer);
        this.camera.addChild(this.worldOverlayLayer);
        this.camera.addChild(this.damageOverlayLayer);

        this.app.stage.addChild(this.camera);
        this.app.stage.addChild(this.screenOverlayLayer);
    }

    private setupBackground(): void {
        const backdrop = new Graphics();
        const marginTiles = 120;
        const width = this.world.width * TILE_SIZE + marginTiles * TILE_SIZE;
        const height = this.world.height * TILE_SIZE + marginTiles * TILE_SIZE;
        const startX = -marginTiles * TILE_SIZE * 0.5;
        const startY = -marginTiles * TILE_SIZE * 0.5;

        backdrop.rect(startX, startY, width, height).fill(0x04050a);
        this.backgroundLayer.addChild(backdrop);
    }

    private setupDebugOverlay(): void {
        this.screenOverlayLayer.addChild(this.debugScreenCenter);
        this.screenOverlayLayer.addChild(this.debugWorldCenter);
        this.screenOverlayLayer.addChild(this.debugCenterDelta);
        this.screenOverlayLayer.visible = false;
    }

    private updateDebugOverlay(): void {
        const snapshot = this.viewportSpace.getSnapshot();
        const centerX = snapshot.screen.center.x;
        const centerY = snapshot.screen.center.y;
        const baseWorldX = (this.world.baseX + 0.5) * TILE_SIZE;
        const baseWorldY = (this.world.baseY + 0.5) * TILE_SIZE;
        const baseOnScreen = this.gameCamera.worldToStage(new Point(baseWorldX, baseWorldY));

        this.debugScreenCenter.clear();
        this.debugScreenCenter.moveTo(centerX - 16, centerY).lineTo(centerX + 16, centerY).stroke({ color: 0x22c55e, width: 2, alpha: 0.95 });
        this.debugScreenCenter.moveTo(centerX, centerY - 16).lineTo(centerX, centerY + 16).stroke({ color: 0x22c55e, width: 2, alpha: 0.95 });

        this.debugWorldCenter.clear();
        this.debugWorldCenter.moveTo(baseOnScreen.x - 10, baseOnScreen.y).lineTo(baseOnScreen.x + 10, baseOnScreen.y).stroke({ color: 0xf59e0b, width: 2, alpha: 0.95 });
        this.debugWorldCenter.moveTo(baseOnScreen.x, baseOnScreen.y - 10).lineTo(baseOnScreen.x, baseOnScreen.y + 10).stroke({ color: 0xf59e0b, width: 2, alpha: 0.95 });
        this.debugWorldCenter.circle(baseOnScreen.x, baseOnScreen.y, 4).stroke({ color: 0xf59e0b, width: 2, alpha: 0.95 });

        this.debugCenterDelta.clear();
        this.debugCenterDelta.moveTo(centerX, centerY).lineTo(baseOnScreen.x, baseOnScreen.y).stroke({ color: 0xef4444, width: 1, alpha: 0.85 });
    }

    private setupCameraStart(): void {
        this.gameCamera.setScale(1.4);
        this.centerCameraOnBase();
        this.setupDamagePopupFont();
    }

    private setupDamagePopupFont(): void {
        if (GameScene.damagePopupFontInstalled) return;

        BitmapFont.install({
            name: 'DamagePopupFont',
            style: {
                fontFamily: 'Verdana',
                fontSize: 14,
                fill: '#f8fafc',
                stroke: { color: '#111827', width: 3 },
            },
        });

        GameScene.damagePopupFontInstalled = true;
    }

    private setupInput(): void {
        this.app.stage.eventMode = 'static';
        this.app.stage.hitArea = this.app.screen;

        this.app.stage.on('pointerdown', this.onPointerDown, this);
        this.app.stage.on('pointermove', this.onPointerMove, this);
        this.app.stage.on('pointerup', this.onPointerUp, this);
        this.app.stage.on('pointerupoutside', this.onPointerUp, this);

        // Prevent browser auto-scroll when middle mouse is pressed over the canvas.
        this.app.canvas.addEventListener('mousedown', this.onCanvasMouseDown);
        this.app.canvas.addEventListener('auxclick', this.onCanvasAuxClick);
        this.app.canvas.addEventListener('contextmenu', this.onCanvasContextMenu);
        this.app.canvas.addEventListener('wheel', this.onWheelZoom, { passive: false });
    }

    private onPointerDown(event: FederatedPointerEvent): void {
        if (event.button === 0) {
            this.isPrimaryMining = true;
            this.primaryMiningPointer.copyFrom(event.global);
            this.primaryHoldMineCooldownMs = 0;
            const weapon = this.getPrimaryTool();
            this.onToolSelected(weapon.id);
            if (weapon.hitOnClick) {
                this.mineAtPointer(this.primaryMiningPointer, 'click');
            }
            return;
        }

        if (event.button !== 1) return;
        this.isMiddlePanning = true;
        this.lastPanPointer.copyFrom(event.global);
    }

    private onPointerMove(event: FederatedPointerEvent): void {
        if (this.isPrimaryMining) {
            this.primaryMiningPointer.copyFrom(event.global);
        }

        if (!this.isMiddlePanning) return;

        const dx = event.global.x - this.lastPanPointer.x;
        const dy = event.global.y - this.lastPanPointer.y;
        this.gameCamera.panByScreen(dx, dy);
        this.lastPanPointer.copyFrom(event.global);
        this.notifyCameraChanged();
    }

    private onPointerUp(event: FederatedPointerEvent): void {
        if (event.button === 0) {
            this.isPrimaryMining = false;
            this.primaryHoldMineCooldownMs = 0;
            return;
        }

        if (event.button !== 1) return;
        this.isMiddlePanning = false;
    }

    private mineAtPointer(pointer: Point, trigger: 'click' | 'hold'): void {
        const worldPos = this.gameCamera.stageToWorld(pointer);
        const tx = Math.floor(worldPos.x / TILE_SIZE);
        const ty = Math.floor(worldPos.y / TILE_SIZE);
        this.transport.send({ type: 'MineTile', x: tx, y: ty, trigger });
    }

    private updateHoldMining(deltaMs: number): void {
        if (this.isPrimaryMining) {
            const primary = this.getPrimaryTool();
            if (primary.hitOnHold && primary.hitsPerSecond > 0) {
                this.onToolSelected(primary.id);
                this.primaryHoldMineCooldownMs -= deltaMs;
                const primaryIntervalMs = 1000 / primary.hitsPerSecond;
                while (this.primaryHoldMineCooldownMs <= 0) {
                    this.mineAtPointer(this.primaryMiningPointer, 'hold');
                    this.primaryHoldMineCooldownMs += primaryIntervalMs;
                }
            }
        }
    }

    private spawnDamagePopups(hits: TileDamageHit[]): void {
        for (const hit of hits) {
            if (hit.damage <= 0) continue;
            const sprite = new BitmapText({
                text: `${hit.damage}`,
                style: {
                    fontFamily: 'DamagePopupFont',
                    fontSize: 14,
                },
            });
            sprite.tint = hit.opened ? 0x93c5fd : 0xf8fafc;

            sprite.pivot.set(sprite.width * 0.5, sprite.height);

            sprite.position.set((hit.x + 0.5) * TILE_SIZE, (hit.y + 0.25) * TILE_SIZE);
            this.damageOverlayLayer.addChild(sprite);
            this.damagePopups.push({ sprite, ttlMs: 520, ageMs: 0, velocityY: 0.03 });
        }

        if (this.damagePopups.length > 120) {
            const overflow = this.damagePopups.splice(0, this.damagePopups.length - 120);
            for (const entry of overflow) {
                entry.sprite.destroy();
            }
        }
    }

    private updateDamagePopups(deltaMs: number): void {
        for (let i = this.damagePopups.length - 1; i >= 0; i--) {
            const popup = this.damagePopups[i];
            popup.ageMs += deltaMs;
            popup.sprite.position.y -= popup.velocityY * deltaMs;
            const t = Math.max(0, 1 - popup.ageMs / popup.ttlMs);
            popup.sprite.alpha = t;
            if (popup.ageMs >= popup.ttlMs) {
                popup.sprite.destroy();
                this.damagePopups.splice(i, 1);
            }
        }
    }

    private onCanvasMouseDown = (event: MouseEvent): void => {
        if (event.button === 1) {
            event.preventDefault();
        }
    };

    private onCanvasAuxClick = (event: MouseEvent): void => {
        if (event.button === 1) {
            event.preventDefault();
        }
    };

    private onCanvasContextMenu = (event: MouseEvent): void => {
        event.preventDefault();

        const stagePoint = new Point();
        this.app.renderer.events.mapPositionToPoint(stagePoint, event.clientX, event.clientY);
        const worldPos = this.gameCamera.stageToWorld(stagePoint);
        const tileX = Math.floor(worldPos.x / TILE_SIZE);
        const tileY = Math.floor(worldPos.y / TILE_SIZE);

        const tile = this.world.getTile(tileX, tileY);
        const isExplored = tile && tile.visibility !== 'Unknown';
        const hasEnoughOre = this.getAvailableOre() >= 10;
        const canPlaceBeacon = isExplored && hasEnoughOre;

        this.worldContextMenu.open({
            x: event.clientX,
            y: event.clientY,
            items: [
                {
                    id: 'place-beacon',
                    label: 'Add Beacon',
                    disabled: !canPlaceBeacon,
                    disabledReason: !isExplored ? 'Area not explored' : !hasEnoughOre ? 'Need 10 ore' : undefined,
                    onSelect: () => {
                        this.transport.send({ type: 'PlaceBeacon', x: tileX, y: tileY });
                    },
                },
            ],
        });
    };

    private onWheelZoom = (event: WheelEvent): void => {
        event.preventDefault();

        const stagePointer = this.getStagePointer(event);
        const factor = event.deltaY > 0 ? ZOOM_OUT_FACTOR : ZOOM_IN_FACTOR;
        this.gameCamera.zoomAtStagePoint(stagePointer, factor, ZOOM_MIN, ZOOM_MAX);
        this.notifyCameraChanged();
    };

    private getStagePointer(event: WheelEvent): Point {
        const stagePoint = new Point();
        this.app.renderer.events.mapPositionToPoint(stagePoint, event.clientX, event.clientY);
        return stagePoint;
    }
}
