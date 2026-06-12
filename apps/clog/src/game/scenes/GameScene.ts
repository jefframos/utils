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
import type { EntityDetailsWindowMeta } from '../meta/GameMetaStore';
import { GameCamera, type WorldViewportRect } from '../camera/GameCamera';
import { ViewportSpace } from '../core/ViewportSpace';
import { WorldRenderer } from '../render/WorldRenderer';
import { WorldModel, type WorldEntity } from '../world/WorldModel';
import { createContextMenuTemplate } from '../ui/ContextMenuTemplate';
import { createEntityDetailsWindow, type EntityInventoryAdapter } from '../ui/EntityDetailsWindow';
import { createEntityFooter, type EntityFooter } from '../ui/EntityFooter';
import { createBuildPanel, type BuildPanel, type BuildPanelMeta } from '../ui/BuildPanel';
import type { BuildableEntityType } from '../content/buildables';
import { addInventoryItem, getInventoryItemDefinition, normalizeInventoryId } from '../inventory/InventoryModel';

export class GameScene {
    private static damagePopupFontInstalled = false;
    private static readonly FIXED_STEP_MS = 1000 / 60;
    private static readonly MAX_FIXED_STEPS_PER_FRAME = 5;

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
    private readonly entityDetails: ReturnType<typeof createEntityDetailsWindow>;
    private readonly entityFooter: EntityFooter;
    private selectedEntityId: string | null = null;
    private fixedUpdateAccumulatorMs = 0;
    private readonly onWorkerOreDelivered: (amount: number) => void;
    private readonly onPlayerOreCollected: (oreDefinitionId: string, amount: number) => void;
    private readonly onPlayerDropoffArrived: (homeId: string | null) => void;
    private buildMode: {
        builderEntityId: string;
        selectedBuildableType: BuildableEntityType | null;
        previewX: number;
        previewY: number;
    } | null = null;
    private readonly buildModeOverlay = new Graphics();
    private buildPanel: BuildPanel | null = null;
    private initialBuildPanelState: BuildPanelMeta;
    private pausedWalkingEntityId: string | null = null;
    private readonly pendingDepositOrders = new Map<string, { storageId: string }>();
    private readonly tileTooltip: HTMLDivElement;
    private getTileInfoForDisplay?: (tileX: number, tileY: number) => string | null;

    constructor(
        private readonly app: Application,
        private readonly world: WorldModel,
        private readonly transport: GameTransport,
        private readonly getPrimaryTool: () => ToolDefinition,
        private readonly onToolSelected: (toolId: string) => void,
        private readonly getAvailableOre: () => number = () => 0,
        onWorkerOreDelivered: (amount: number) => void = () => { },
        onPlayerOreCollected: (oreDefinitionId: string, amount: number) => void = () => { },
        onPlayerDropoffArrived: (homeId: string | null) => void = () => { },
        private readonly inventoryAdapter?: EntityInventoryAdapter,
        initialEntityDetailsWindowState?: EntityDetailsWindowMeta,
        onEntityDetailsWindowStateChange?: (state: EntityDetailsWindowMeta) => void,
        initialBuildPanelState?: BuildPanelMeta,
        onBuildPanelStateChange?: (state: BuildPanelMeta) => void,
        private readonly onTileClicked?: (tileX: number, tileY: number) => void,
    ) {
        this.initialBuildPanelState = initialBuildPanelState ?? {
            open: false,
            minimized: false,
            left: 16,
            top: 100,
            width: 400,
            height: 320,
        };
        this.onWorkerOreDelivered = onWorkerOreDelivered;
        this.onPlayerOreCollected = onPlayerOreCollected;
        this.onPlayerDropoffArrived = onPlayerDropoffArrived;
        this.gameCamera = new GameCamera(this.app, this.camera);
        this.viewportSpace = ViewportSpace.initialize(this.app, this.gameCamera);
        this.renderer = new WorldRenderer(this.world, this.worldLayer, this.worldOverlayLayer);
        this.entityDetails = createEntityDetailsWindow({
            onDeleteBeacon: (entityId) => {
                this.transport.send({ type: 'RemoveBeacon', entityId });
            },
            onSpawnWorker: (buildingId) => {
                this.transport.send({ type: 'SpawnWorker', buildingId });
            },
            onDeployWorker: (workerId) => {
                this.transport.send({ type: 'DeployWorker', workerId });
            },
            onRecallWorker: (workerId) => {
                this.transport.send({ type: 'RecallWorker', workerId });
            },
            onRecallAllWorkers: (buildingId) => {
                this.transport.send({ type: 'RecallWorkers', buildingId });
            },
            onInterruptWorkerCommand: (workerId) => {
                this.transport.send({ type: 'InterruptWorkerCommand', workerId });
            },
            onClearWorkerCommands: (workerId) => {
                this.transport.send({ type: 'ClearWorkerCommands', workerId });
            },
            onRemoveQueuedWorkerCommand: (workerId, commandId) => {
                this.transport.send({ type: 'RemoveQueuedWorkerCommand', workerId, commandId });
            },
            onBuild: (entityId) => {
                this.enterBuildMode(entityId);
            },
            getWorkersForBuilding: (buildingId) => {
                return this.world.getWorkersForBuilding(buildingId);
            },
            inventoryAdapter: this.inventoryAdapter,
            initialWindowState: initialEntityDetailsWindowState ?? {
                open: false,
                minimized: false,
                left: Math.max(16, window.innerWidth - 300),
                top: 120,
                width: 280,
                height: 240,
            },
            onWindowStateChange: (state) => {
                onEntityDetailsWindowStateChange?.(state);
            },
        });

        this.buildPanel = createBuildPanel({
            initialWindowState: this.initialBuildPanelState,
            onWindowStateChange: (state) => {
                this.initialBuildPanelState = state;
                onBuildPanelStateChange?.(state);
            },
            onSelectionChange: (entityType) => {
                if (this.buildMode) {
                    this.buildMode.selectedBuildableType = entityType;
                    this.updateBuildModeOverlay();
                }
            },
            onClose: () => {
                this.exitBuildMode();
            },
            getAvailableOre: this.getAvailableOre,
        });

        this.entityFooter = createEntityFooter({
            onBuild: () => {
                const entity = this.selectedEntityId ? this.world.getEntityById(this.selectedEntityId) : null;
                if (entity) {
                    this.enterBuildMode(entity.id);
                }
            },
            onDeploy: () => {
                const entity = this.selectedEntityId ? this.world.getEntityById(this.selectedEntityId) : null;
                if (entity) {
                    this.transport.send({ type: 'DeployWorker', workerId: entity.id });
                }
            },
            onRecall: () => {
                const entity = this.selectedEntityId ? this.world.getEntityById(this.selectedEntityId) : null;
                if (entity) {
                    this.transport.send({ type: 'RecallWorker', workerId: entity.id });
                }
            },
            onRemoveQueuedCommand: (commandId) => {
                const entity = this.selectedEntityId ? this.world.getEntityById(this.selectedEntityId) : null;
                if (entity) {
                    if (entity.kind === 'player') {
                        this.transport.send({ type: 'RemoveQueuedPlayerCommand', commandId });
                    } else {
                        this.transport.send({ type: 'RemoveQueuedWorkerCommand', workerId: entity.id, commandId });
                    }
                }
            },
            onInterruptCurrentCommand: () => {
                const entity = this.selectedEntityId ? this.world.getEntityById(this.selectedEntityId) : null;
                if (entity) {
                    if (entity.kind === 'player') {
                        this.transport.send({ type: 'InterruptPlayerCommand' });
                    } else if (entity.kind === 'worker') {
                        this.transport.send({ type: 'InterruptWorkerCommand', workerId: entity.id });
                    }
                }
            },
            onTogglePauseCommands: () => {
                const entity = this.selectedEntityId ? this.world.getEntityById(this.selectedEntityId) : null;
                if (entity) {
                    const paused = entity.commandsPaused ?? false;
                    if (entity.kind === 'player') {
                        this.transport.send({ type: paused ? 'ResumePlayerCommands' : 'PausePlayerCommands' });
                    } else if (entity.kind === 'worker') {
                        this.transport.send({ type: paused ? 'ResumeWorkerCommands' : 'PauseWorkerCommands', workerId: entity.id });
                    }
                }
            },
            onClearCommands: () => {
                const entity = this.selectedEntityId ? this.world.getEntityById(this.selectedEntityId) : null;
                if (entity?.kind === 'player') {
                    this.transport.send({ type: 'ClearPlayerCommands' });
                } else if (entity?.kind === 'worker') {
                    this.transport.send({ type: 'ClearWorkerCommands', workerId: entity.id });
                }
            },
        });

        // Create tile tooltip
        this.tileTooltip = document.createElement('div');
        this.tileTooltip.className = 'tile-tooltip';
        this.tileTooltip.textContent = 'Tile: move cursor over map';
        document.body.appendChild(this.tileTooltip);
    }

    public getViewportWorldRectTiles(): WorldViewportRect {
        const rect = this.viewportSpace.getWorldRect();
        return {
            left: rect.left / TILE_SIZE,
            top: rect.top / TILE_SIZE,
            right: rect.right / TILE_SIZE,
            bottom: rect.bottom / TILE_SIZE,
        };
    }

    public centerCameraOnTile(tileX: number, tileY: number): void {
        const screenCenter = this.viewportSpace.getScreenCenter();
        this.gameCamera.centerOnWorldAtStage(
            (tileX + 0.5) * TILE_SIZE,
            (tileY + 0.5) * TILE_SIZE,
            screenCenter.x,
            screenCenter.y,
        );
        this.notifyCameraChanged();
    }

    public centerCameraOnBase(): void {
        this.centerCameraOnTile(this.world.baseX, this.world.baseY);
    }

    public initialize(): void {
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
            this.runFixedUpdates(this.app.ticker.deltaMS);
            this.world.ensureChunksForViewport(this.getViewportWorldRectTiles(), 1);
            this.renderer.flushDirtyChunks(this.camera.scale.x);
            this.updateHoldMining(this.app.ticker.deltaMS);
            this.updateDamagePopups(this.app.ticker.deltaMS);
            this.updateBuildModeOverlay();
            if (this.debugOverlayEnabled) {
                this.updateDebugOverlay();
            }
        });
    }

    public setTileInfoDisplayFn(fn: (tileX: number, tileY: number) => string | null): void {
        this.getTileInfoForDisplay = fn;
    }

    public setDebugOverlayEnabled(enabled: boolean): void {
        this.debugOverlayEnabled = enabled;
        this.screenOverlayLayer.visible = enabled;
        if (enabled) {
            this.updateDebugOverlay();
        }
    }

    public isDebugOverlayVisible(): boolean {
        return this.debugOverlayEnabled;
    }

    public onCameraChanged(listener: () => void): () => void {
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
            } else if (event.type === 'EntityRemoved') {
                if (this.selectedEntityId === event.id) {
                    this.clearEntitySelection();
                }
            } else if (event.type === 'WorkerActionFailed' || event.type === 'WorkerSpawned' || event.type === 'WorkerDeployed' || event.type === 'WorkerRecalled' || event.type === 'WorkersRecalled' || event.type === 'WorkerMoved' || event.type === 'WorkerMiningStarted') {
                this.refreshSelectedEntityDetails();
            } else if (event.type === 'WorkerCommandInterrupted' || event.type === 'WorkerCommandsCleared' || event.type === 'WorkerQueuedCommandRemoved') {
                this.refreshSelectedEntityDetails();
            } else if (event.type === 'WorkerCommandsPaused' || event.type === 'WorkerCommandsResumed') {
                this.refreshSelectedEntityDetails();
            } else if (event.type === 'PlayerCommandInterrupted' || event.type === 'PlayerCommandsCleared' || event.type === 'PlayerQueuedCommandRemoved' || event.type === 'PlayerCommandsPaused' || event.type === 'PlayerCommandsResumed') {
                this.refreshSelectedEntityDetails();
            } else if (event.type === 'PlayerMoved' || event.type === 'PlayerMiningStarted') {
                this.refreshSelectedEntityDetails();
            } else if (event.type === 'WorldGenerated') {
                this.clearEntitySelection();
            }
        });
    }

    private mountLayers(): void {
        this.camera.addChild(this.backgroundLayer);
        this.camera.addChild(this.worldLayer);
        this.camera.addChild(this.worldOverlayLayer);
        this.camera.addChild(this.buildModeOverlay);
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
        this.app.stage.on('pointerout', () => {
            this.tileTooltip.style.display = 'none';
        });

        // Prevent browser auto-scroll when middle mouse is pressed over the canvas.
        this.app.canvas.addEventListener('mousedown', this.onCanvasMouseDown);
        this.app.canvas.addEventListener('auxclick', this.onCanvasAuxClick);
        this.app.canvas.addEventListener('contextmenu', this.onCanvasContextMenu);
        this.app.canvas.addEventListener('wheel', this.onWheelZoom, { passive: false });
    }

    private onPointerDown(event: FederatedPointerEvent): void {
        if (event.button === 0) {
            // Handle build mode placement
            if (this.buildMode) {
                // Only place if a buildable type is selected
                if (this.buildMode.selectedBuildableType) {
                    const worldPos = this.gameCamera.stageToWorld(event.global);
                    const tx = Math.floor(worldPos.x / TILE_SIZE);
                    const ty = Math.floor(worldPos.y / TILE_SIZE);
                    if (this.buildMode.selectedBuildableType === 'beacon') {
                        this.transport.send({ type: 'PlaceBeacon', x: tx, y: ty, builderEntityId: this.buildMode.builderEntityId });
                    }
                }
                return;
            }

            const selected = this.selectEntityAtPointer(event.global);
            if (selected) {
                this.isPrimaryMining = false;
                this.primaryHoldMineCooldownMs = 0;
                return;
            }

            this.clearEntitySelection();

            // Show tile information on click instead of mining
            const worldPos = this.gameCamera.stageToWorld(event.global);
            const tx = Math.floor(worldPos.x / TILE_SIZE);
            const ty = Math.floor(worldPos.y / TILE_SIZE);
            this.onTileClicked?.(tx, ty);

            // Keep mining state for possible future use but don't mine on click
            this.isPrimaryMining = true;
            this.primaryMiningPointer.copyFrom(event.global);
            this.primaryHoldMineCooldownMs = 0;
            const weapon = this.getPrimaryTool();
            this.onToolSelected(weapon.id);
            // Don't call mineAtPointer - we only show tile info on click now
            return;
        }

        if (event.button !== 1) return;
        this.isMiddlePanning = true;
        this.lastPanPointer.copyFrom(event.global);
    }

    private onPointerMove(event: FederatedPointerEvent): void {
        // Update build mode preview position
        if (this.buildMode) {
            const worldPos = this.gameCamera.stageToWorld(event.global);
            const tx = Math.floor(worldPos.x / TILE_SIZE);
            const ty = Math.floor(worldPos.y / TILE_SIZE);
            this.buildMode.previewX = tx;
            this.buildMode.previewY = ty;
            this.updateBuildModeOverlay();
            return;
        }

        if (this.isPrimaryMining) {
            this.primaryMiningPointer.copyFrom(event.global);
        }

        // Update tile tooltip
        const worldPos = this.gameCamera.stageToWorld(event.global);
        const tx = Math.floor(worldPos.x / TILE_SIZE);
        const ty = Math.floor(worldPos.y / TILE_SIZE);
        const tileInfo = this.getTileInfoForDisplay?.(tx, ty);

        if (tileInfo) {
            this.tileTooltip.textContent = tileInfo;
        } else {
            this.tileTooltip.textContent = 'Tile: outside world bounds';
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
        // Hold mining disabled - only entities can destroy tiles now
        // if (this.isPrimaryMining) {
        //     const primary = this.getPrimaryTool();
        //     if (primary.hitOnHold && primary.hitsPerSecond > 0) {
        //         this.onToolSelected(primary.id);
        //         this.primaryHoldMineCooldownMs -= deltaMs;
        //         const primaryIntervalMs = 1000 / primary.hitsPerSecond;
        //         while (this.primaryHoldMineCooldownMs <= 0) {
        //             this.mineAtPointer(this.primaryMiningPointer, 'hold');
        //             this.primaryHoldMineCooldownMs += primaryIntervalMs;
        //         }
        //     }
        // }
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
        // Cancel build mode on right-click
        if (this.buildMode) {
            this.exitBuildMode();
            return;
        }

        if (event.button === 1) {
            event.preventDefault();
        }
    };

    private onCanvasContextMenu = (event: MouseEvent): void => {
        event.preventDefault();

        // Don't show context menu in build mode
        if (this.buildMode) {
            return;
        }

        const stagePoint = new Point();
        this.app.renderer.events.mapPositionToPoint(stagePoint, event.clientX, event.clientY);
        const worldPos = this.gameCamera.stageToWorld(stagePoint);
        const tileX = Math.floor(worldPos.x / TILE_SIZE);
        const tileY = Math.floor(worldPos.y / TILE_SIZE);

        const tile = this.world.getTile(tileX, tileY);
        const clickedEntity = this.world.getEntityAtTile(tileX, tileY);
        const selectedEntity = this.selectedEntityId ? this.world.getEntityById(this.selectedEntityId) : null;

        type MenuItem = {
            id: string;
            label: string;
            disabled?: boolean;
            disabledReason?: string;
            onSelect?: () => void;
        };

        const items: MenuItem[] = [];

        // ---------- behaviour-driven items for the selected entity ----------
        if (selectedEntity) {
            const isDeployed = selectedEntity.deployed !== false || selectedEntity.kind === 'player';

            // Walk / Move action — any entity with a walking component
            if (selectedEntity.walking) {
                const isSelf = clickedEntity?.id === selectedEntity.id;
                const canMove = isDeployed && this.world.canEntityMoveTo(selectedEntity.id, tileX, tileY);
                const walkDisabledReason = !tile
                    ? 'Out of world bounds'
                    : tile.solid
                        ? 'Tile is blocked'
                        : tile.visibility === 'Unknown'
                            ? 'Tile is unexplored'
                            : !isDeployed
                                ? 'Unit is not deployed'
                                : clickedEntity && !isSelf
                                    ? 'Tile is occupied'
                                    : undefined;

                items.push({
                    id: 'action-walk-here',
                    label: 'Walk Here',
                    disabled: !canMove,
                    disabledReason: walkDisabledReason,
                    onSelect: canMove ? () => {
                        this.transport.send({ type: 'MoveEntity', entityId: selectedEntity.id, x: tileX, y: tileY });
                    } : undefined,
                });
            }

            // Mine action — any entity with a miningDef component
            if (selectedEntity.miningDef && isDeployed) {
                const canMine = this.world.canEntityMineTile(selectedEntity.id, tileX, tileY);
                const mineDisabledReason = !tile
                    ? 'Out of world bounds'
                    : !tile.solid
                        ? 'No ore here — target a solid tile'
                        : tile.visibility === 'Unknown'
                            ? 'Tile is unexplored'
                            : undefined;

                items.push({
                    id: 'action-mine-here',
                    label: 'Mine Here',
                    disabled: !canMine,
                    disabledReason: mineDisabledReason,
                    onSelect: canMine ? () => {
                        this.transport.send({ type: 'MineEntity', entityId: selectedEntity.id, x: tileX, y: tileY });
                    } : undefined,
                });
            }

            const clickedIsStorage = !!clickedEntity && clickedEntity.inventoryDef != null && clickedEntity.mobility === 'static';
            if (clickedIsStorage && clickedEntity && clickedEntity.id !== selectedEntity.id) {
                const canDeposit = !!selectedEntity.inventoryDef;
                const hasResources = canDeposit && this.entityHasDepositableResources(selectedEntity);
                items.push({
                    id: 'action-deposit-resources',
                    label: 'Order Deposit Resources',
                    disabled: !canDeposit || !hasResources,
                    disabledReason: !canDeposit
                        ? 'Selected entity has no inventory'
                        : hasResources
                            ? undefined
                            : 'No resources to deposit',
                    onSelect: hasResources
                        ? () => {
                            this.queueDepositResourcesOrder(selectedEntity, clickedEntity);
                        }
                        : undefined,
                });
            }
        }

        // ---------- right-clicked on a deployed worker (not already selected) ----------
        if (clickedEntity?.kind === 'worker' && clickedEntity.deployed && clickedEntity.id !== selectedEntity?.id) {
            items.push({
                id: 'worker-return-to-base',
                label: 'Return Worker To Base',
                onSelect: () => {
                    this.transport.send({ type: 'RecallWorker', workerId: clickedEntity.id });
                },
            });
        }

        if (items.length === 0) {
            return;
        }

        this.worldContextMenu.open({
            x: event.clientX,
            y: event.clientY,
            items,
        });
    };

    private entityHasDepositableResources(entity: WorldEntity): boolean {
        const adapter = this.inventoryAdapter;
        if (!adapter) return false;
        const state = adapter.getState();
        if (!state) return false;
        const binding = adapter.ensureEntityInventory(entity, state);
        if (!binding) return false;

        return state.items.some((item) => {
            if (normalizeInventoryId(item.location.inventoryId) !== binding.inventoryId) return false;
            const definition = getInventoryItemDefinition(item.definitionId);
            return !!definition && definition.itemType === 'resource' && item.quantity > 0;
        });
    }

    private depositEntityResourcesToStorage(entity: WorldEntity, storage: WorldEntity): void {
        const adapter = this.inventoryAdapter;
        if (!adapter) return;

        const state = adapter.getState();
        if (!state) return;

        const sourceBinding = adapter.ensureEntityInventory(entity, state);
        const targetBinding = adapter.ensureEntityInventory(storage, state);
        if (!sourceBinding || !targetBinding) return;
        if (sourceBinding.inventoryId === targetBinding.inventoryId) return;

        const sourceItems = state.items.filter((item) => normalizeInventoryId(item.location.inventoryId) === sourceBinding.inventoryId);
        let movedTotal = 0;

        for (const item of sourceItems) {
            const definition = getInventoryItemDefinition(item.definitionId);
            if (!definition || definition.itemType !== 'resource') continue;
            if (item.quantity <= 0) continue;

            const added = addInventoryItem(state, item.definitionId, item.quantity, targetBinding.inventoryId);
            if (added <= 0) continue;

            item.quantity -= added;
            movedTotal += added;
        }

        if (movedTotal <= 0) return;

        state.items = state.items.filter((item) => item.quantity > 0);
        adapter.onStateChange(state);
    }

    private queueDepositResourcesOrder(entity: WorldEntity, storage: WorldEntity): void {
        this.pendingDepositOrders.set(entity.id, { storageId: storage.id });
        this.tryAdvanceDepositOrder(entity.id);
    }

    private isEntityInDepositRange(entity: WorldEntity, storage: WorldEntity): boolean {
        const dx = Math.abs(entity.x - storage.x);
        const dy = Math.abs(entity.y - storage.y);
        if (storage.kind === 'base') {
            return dx <= 3 && dy <= 3;
        }
        return Math.max(dx, dy) <= 1;
    }

    private findDepositApproachTile(entity: WorldEntity, storage: WorldEntity): { x: number; y: number } | null {
        const reach = storage.kind === 'base' ? 3 : 1;
        let best: { x: number; y: number; score: number } | null = null;

        for (let oy = -reach; oy <= reach; oy++) {
            for (let ox = -reach; ox <= reach; ox++) {
                const tx = storage.x + ox;
                const ty = storage.y + oy;
                if (!this.world.canEntityMoveTo(entity.id, tx, ty)) continue;
                const score = Math.abs(tx - Math.round(entity.x)) + Math.abs(ty - Math.round(entity.y));
                if (!best || score < best.score) {
                    best = { x: tx, y: ty, score };
                }
            }
        }

        return best ? { x: best.x, y: best.y } : null;
    }

    private tryAdvanceDepositOrder(entityId: string): void {
        const order = this.pendingDepositOrders.get(entityId);
        if (!order) return;

        const entity = this.world.getEntityById(entityId);
        const storage = this.world.getEntityById(order.storageId);
        if (!entity || !storage) {
            this.pendingDepositOrders.delete(entityId);
            return;
        }

        if (!this.entityHasDepositableResources(entity)) {
            this.pendingDepositOrders.delete(entityId);
            return;
        }

        if (this.isEntityInDepositRange(entity, storage)) {
            this.depositEntityResourcesToStorage(entity, storage);
            this.pendingDepositOrders.delete(entityId);
            if (this.selectedEntityId === entity.id) {
                this.refreshSelectedEntityDetails();
            }
            return;
        }

        if (!entity.walking) {
            this.pendingDepositOrders.delete(entityId);
            return;
        }

        if (entity.movement) {
            return;
        }

        const target = this.findDepositApproachTile(entity, storage);
        if (!target) {
            return;
        }

        this.transport.send({ type: 'MoveEntity', entityId: entity.id, x: target.x, y: target.y });
    }

    private advanceDepositOrders(): void {
        const orderEntityIds = Array.from(this.pendingDepositOrders.keys());
        for (const entityId of orderEntityIds) {
            this.tryAdvanceDepositOrder(entityId);
        }
    }

    private selectEntityAtPointer(pointer: Point): WorldEntity | null {
        const worldPos = this.gameCamera.stageToWorld(pointer);
        const tileX = Math.floor(worldPos.x / TILE_SIZE);
        const tileY = Math.floor(worldPos.y / TILE_SIZE);
        const entity = this.world.getEntityAtTile(tileX, tileY);
        if (!entity) return null;

        this.selectedEntityId = entity.id;
        this.renderer.setSelectedEntity(entity.id);
        this.entityDetails.openForEntity(entity);
        this.entityFooter.setEntity(entity);
        this.entityFooter.show();
        return entity;
    }

    private clearEntitySelection(): void {
        if (!this.selectedEntityId) return;
        this.selectedEntityId = null;
        this.renderer.setSelectedEntity(null);
        this.entityDetails.close();
        this.entityDetails.clearSelection();
        this.entityFooter.setEntity(null);
        this.entityFooter.hide();
    }

    private refreshSelectedEntityDetails(): void {
        if (!this.selectedEntityId) return;
        const selected = this.world.getEntityById(this.selectedEntityId);
        if (!selected) {
            this.clearEntitySelection();
            return;
        }
        this.entityDetails.openForEntity(selected);
        this.entityFooter.setEntity(selected);
    }

    private runFixedUpdates(deltaMs: number): void {
        this.fixedUpdateAccumulatorMs += deltaMs;
        let steps = 0;

        while (this.fixedUpdateAccumulatorMs >= GameScene.FIXED_STEP_MS && steps < GameScene.MAX_FIXED_STEPS_PER_FRAME) {
            this.world.tickFixed(GameScene.FIXED_STEP_MS);
            this.advanceDepositOrders();
            const damageHits = this.world.drainWorkerDamageHits();
            if (damageHits.length > 0) {
                this.spawnDamagePopups(damageHits);
            }
            const deliveries = this.world.drainWorkerOreDeliveries();
            if (deliveries.length > 0) {
                const totalOre = deliveries.reduce((sum, delivery) => sum + delivery.amount, 0);
                this.onWorkerOreDelivered(totalOre);
            }
            const playerOre = this.world.drainPlayerOreCollected();
            for (const { oreDefinitionId, amount } of playerOre) {
                if (amount > 0) this.onPlayerOreCollected(oreDefinitionId, amount);
            }
            const playerDropoffs = this.world.drainPlayerDropoffArrivals();
            for (const { homeId } of playerDropoffs) {
                this.onPlayerDropoffArrived(homeId);
            }
            // Refresh selected entity details if entity is mining or moving
            if (this.selectedEntityId) {
                const selectedEntity = this.world.getEntityById(this.selectedEntityId);
                if (selectedEntity && (selectedEntity.mining || selectedEntity.movement)) {
                    this.refreshSelectedEntityDetails();
                }
            }
            this.fixedUpdateAccumulatorMs -= GameScene.FIXED_STEP_MS;
            steps++;
        }

        if (steps === GameScene.MAX_FIXED_STEPS_PER_FRAME) {
            this.fixedUpdateAccumulatorMs = Math.min(this.fixedUpdateAccumulatorMs, GameScene.FIXED_STEP_MS);
        }
    }

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

    private enterBuildMode(entityId: string): void {
        const entity = this.world.getEntityById(entityId);
        if (!entity || !entity.builder || !entity.builder.buildables.includes('beacon')) {
            return;
        }

        // Pause any active walking by pausing the movement
        if (entity.movement && entity.movement.mode === 'move') {
            this.pausedWalkingEntityId = entityId;
            // The movement will remain until the command resumes or the next action
        }

        // Enter build mode
        this.buildMode = {
            builderEntityId: entityId,
            selectedBuildableType: null,
            previewX: entity.x,
            previewY: entity.y,
        };
        this.buildPanel?.setOpen(true);
        this.updateBuildModeOverlay();
    }

    private exitBuildMode(): void {
        this.buildMode = null;
        this.buildModeOverlay.clear();
        this.buildPanel?.setOpen(false);
        this.pausedWalkingEntityId = null;
    }

    private updateBuildModeOverlay(): void {
        this.buildModeOverlay.clear();

        if (!this.buildMode) return;

        const builder = this.world.getEntityById(this.buildMode.builderEntityId);
        if (!builder || !builder.builder) return;

        // Get all buildable tiles for the entity (currently only beacon type is supported)
        const buildableTiles = this.world.getBuildableTilesForEntity(this.buildMode.builderEntityId, 'beacon');

        // Draw range highlighting
        for (const tile of buildableTiles) {
            const px = tile.x * TILE_SIZE;
            const py = tile.y * TILE_SIZE;
            this.buildModeOverlay.rect(px, py, TILE_SIZE, TILE_SIZE).fill({ color: 0x6366f1, alpha: 0.15 });
            this.buildModeOverlay.rect(px, py, TILE_SIZE, TILE_SIZE).stroke({ color: 0x6366f1, width: 1, alpha: 0.3 });
        }

        // Draw entity preview at mouse position (only if a buildable type is selected)
        if (this.buildMode.selectedBuildableType) {
            const previewX = this.buildMode.previewX * TILE_SIZE;
            const previewY = this.buildMode.previewY * TILE_SIZE;
            const failureReason = this.world.getBeaconPlacementFailureReason(this.buildMode.previewX, this.buildMode.previewY, this.buildMode.builderEntityId);
            const isValid = failureReason === 'unknown_tile';
            const previewColor = isValid ? 0x10b981 : 0xef4444;
            const previewAlpha = isValid ? 0.4 : 0.3;

            this.buildModeOverlay.rect(previewX, previewY, TILE_SIZE, TILE_SIZE).fill({ color: previewColor, alpha: previewAlpha });
            this.buildModeOverlay.rect(previewX, previewY, TILE_SIZE, TILE_SIZE).stroke({ color: previewColor, width: 2, alpha: 0.7 });
        }
    }
}
