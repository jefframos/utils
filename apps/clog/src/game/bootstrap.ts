import { Application } from 'pixi.js';
import { LocalTransport } from './core/LocalTransport';
import { GameSimulation } from './core/GameSimulation';
import type { GameEvent } from './core/protocol';
import { WEAPON_DEFINITIONS } from './core/ToolComponent';
import { GameScene } from './scenes/GameScene';
import { GameMetaStore } from './meta/GameMetaStore';
import { createMapControlPanel } from './ui/MapControlPanel';
import { createInventoryPanel } from './ui/inventory/InventoryPanel';
import { createInventoryItemDetailsWindow } from './ui/inventory/InventoryItemDetailsWindow';
import { createResourcesPanel } from './ui/ResourcesPanel';
import type { MinimapWindow } from './ui/MinimapWindow';
import { createToolInspectorPanel } from './ui/ToolInspectorPanel';
import { createWindowControlRail } from './ui/WindowControlRail';
import { createDebugGraphWindow } from './ui/DebugGraphWindow';
import { ViewportSpace } from './core/ViewportSpace';
import { createDebugInventoryState, getInventoryItemDefinition, getTotalResourceCount, type InventoryState } from './inventory/InventoryModel';
import {
    createWorldAutosave,
    loadInventoryState,
    loadMetaFromCookie,
    loadSnapshot, normalizeEntityDetailsMeta,
    normalizeInventoryItemDetailsMeta,
    normalizeInventoryMeta,
    normalizeMapControlsMeta,
    normalizeMinimapMeta,
    normalizeToolInspectorMeta,
    saveInventoryState,
    saveMetaToCookie,
    saveSnapshot
} from './bootstrap/storage';
import { createActionButton, getToolIconSvg, makeIconSvg } from './bootstrap/icons';
import { createTopMenu } from './bootstrap/topMenu';
import { createGameEngine } from './engine/GameEngine';
import { ModuleHost } from './modules/ModuleHost';
import { createCanvasSurfaceModule } from './modules/builtin/CanvasSurfaceModule';
import { createMinimapUiModule } from './modules/builtin/MinimapUiModule';
import { getBiomeGenerationNodeGraphMermaid } from './world/noise';
import type { EntityInventoryAdapter } from './ui/EntityDetailsWindow';
import type { WorldEntity } from './world/WorldModel';

export async function bootstrapGame(): Promise<void> {
    const app = new Application();
    await app.init({
        resizeTo: window,
        background: 0x05060a,
        antialias: false,
        autoDensity: true,
        resolution: Math.min(devicePixelRatio, 2),
    });

    document.body.appendChild(app.canvas);

    const engine = createGameEngine({ useWorker: true });

    const simulation = new GameSimulation();
    const transport = new LocalTransport(simulation);
    const worldAutosave = createWorldAutosave(simulation.world);

    const saved = loadSnapshot();
    if (saved) {
        transport.send({ type: 'LoadWorldSnapshot', snapshot: saved });
    }

    let mainActionToolId = simulation.tools.getActiveTool().id;
    let pendingWorkerOreDelivered = 0;

    const persistedMeta = loadMetaFromCookie();
    const initialMinimap = normalizeMinimapMeta(persistedMeta?.windows?.minimap ?? {});
    const initialMapControls = normalizeMapControlsMeta(persistedMeta?.windows?.mapControls ?? {});
    const initialInventory = normalizeInventoryMeta(persistedMeta?.windows?.inventory ?? {});
    const initialToolInspector = normalizeToolInspectorMeta(persistedMeta?.windows?.toolInspector ?? {});
    const initialInventoryItemDetails = normalizeInventoryItemDetailsMeta(persistedMeta?.windows?.inventoryItemDetails ?? {});
    const initialEntityDetails = normalizeEntityDetailsMeta(persistedMeta?.windows?.entityDetails ?? {});
    const initialBuildPanel = persistedMeta?.windows?.buildPanel ?? {
        open: false,
        minimized: false,
        left: 16,
        top: 100,
        width: 400,
        height: 320,
    };

    const metaStore = new GameMetaStore({
        windows: {
            minimap: initialMinimap,
            mapControls: initialMapControls,
            inventory: initialInventory,
            toolInspector: initialToolInspector,
            inventoryItemDetails: initialInventoryItemDetails,
            entityDetails: initialEntityDetails,
            buildPanel: initialBuildPanel,
        },
    });

    const ENTITY_INVENTORY_COLUMNS = 8;
    const ENTITY_INVENTORY_DEFAULT_VISIBLE = 12;
    const inventoryChangeListeners = new Set<() => void>();

    const notifyInventoryChanged = () => {
        for (const listener of inventoryChangeListeners) {
            listener();
        }
    };

    const sanitizeInventoryItemLocations = (state: InventoryState): boolean => {
        let changed = false;

        for (const item of state.items) {
            const definition = getInventoryItemDefinition(item.definitionId);
            if (!definition) continue;

            const inventoryId = item.location.inventoryId ?? 'player';
            const container = state.containers[inventoryId];
            if (!container) continue;
            const sectionSize = container.sections[item.location.section];
            if (!sectionSize) continue;

            const maxX = Math.max(0, sectionSize.columns - definition.shape.width);
            const maxY = Math.max(0, sectionSize.rows - definition.shape.height);
            const nextX = Math.min(maxX, Math.max(0, Math.floor(item.location.x)));
            const nextY = Math.min(maxY, Math.max(0, Math.floor(item.location.y)));
            if (nextX !== item.location.x || nextY !== item.location.y) {
                item.location.x = nextX;
                item.location.y = nextY;
                changed = true;
            }
        }

        return changed;
    };

    const getEntityInventoryCapacity = (entity: WorldEntity): number => {
        if (entity.kind === 'worker') return 1;
        if (entity.kind === 'player') return 24;
        if (entity.kind === 'base') return 48;
        return 0;
    };

    const ensureEntityInventoryContainer = (
        entity: WorldEntity,
        state: InventoryState,
    ): { inventoryId: string; maxSlots: number } | null => {
        const maxSlots = getEntityInventoryCapacity(entity);
        if (maxSlots <= 0) return null;

        const inventoryId = `entity:${entity.id}`;
        const visibleSlots = Math.max(ENTITY_INVENTORY_DEFAULT_VISIBLE, maxSlots);
        const rows = Math.max(1, Math.ceil(visibleSlots / ENTITY_INVENTORY_COLUMNS));
        const existing = state.containers[inventoryId];
        if (
            !existing
            || existing.sections.storage.columns !== ENTITY_INVENTORY_COLUMNS
            || existing.sections.storage.rows !== rows
            || existing.sections.hotbar.columns !== ENTITY_INVENTORY_COLUMNS
            || existing.sections.hotbar.rows !== 0
        ) {
            state.containers[inventoryId] = {
                id: inventoryId,
                sections: {
                    storage: { columns: ENTITY_INVENTORY_COLUMNS, rows },
                    hotbar: { columns: ENTITY_INVENTORY_COLUMNS, rows: 0 },
                },
            };
        }

        return { inventoryId, maxSlots };
    };

    const upsertOreItem = (
        state: InventoryState,
        inventoryId: string,
        quantity: number,
    ): boolean => {
        const itemId = `${inventoryId}:ore`;
        const existing = state.items.find((item) => item.id === itemId);
        if (quantity <= 0) {
            if (!existing) return false;
            state.items = state.items.filter((item) => item.id !== itemId);
            return true;
        }

        if (existing) {
            if (existing.quantity === quantity) return false;
            existing.quantity = quantity;
            return true;
        }

        state.items.push({
            id: itemId,
            definitionId: 'debug-asteroid-ore',
            quantity,
            durability: 1,
            location: {
                inventoryId,
                section: 'storage',
                x: 0,
                y: 0,
            },
        });
        return true;
    };

    let toolInspector: ReturnType<typeof createToolInspectorPanel> | null = null;
    let onToolEquippedExternally: (toolId: string) => void = () => { };
    const entityInventoryAdapter: EntityInventoryAdapter = {
        getState: () => inventoryPanel?.getState() ?? null,
        ensureEntityInventory: (entity, state) => ensureEntityInventoryContainer(entity, state),
        syncEntityInventory: (entity, state, binding) => {
            if (entity.kind !== 'worker') return false;
            const carriedOre = Math.max(0, Math.floor(entity.mining?.carriedOre ?? 0));
            const oreChanged = upsertOreItem(state, binding.inventoryId, carriedOre);
            const posChanged = sanitizeInventoryItemLocations(state);
            return oreChanged || posChanged;
        },
        onDidChange: (listener) => {
            inventoryChangeListeners.add(listener);
            return () => {
                inventoryChangeListeners.delete(listener);
            };
        },
        onStateChange: (state) => {
            sanitizeInventoryItemLocations(state);
            if (inventoryPanel) {
                inventoryPanel.replaceState(state);
            }
            saveInventoryState(state);
            resourcesPanel?.update();
            notifyInventoryChanged();
        },
        onInspectItem: (selection) => {
            inventoryItemDetails?.setSelection(selection);
            inventoryItemDetails?.open();
        },
        onEquipTool: (toolId) => {
            const next = WEAPON_DEFINITIONS.find((entry) => entry.id === toolId);
            if (!next) return;
            simulation.tools.setActiveTool(next);
            inventoryPanel?.setEquippedTool(next.id);
            toolInspector?.setActiveTool(next.id);
            onToolEquippedExternally(next.id);
        },
    };
    const scene = new GameScene(
        app,
        simulation.world,
        transport,
        () => WEAPON_DEFINITIONS.find((entry) => entry.id === mainActionToolId) ?? simulation.tools.getActiveTool(),
        (toolId) => {
            const next = WEAPON_DEFINITIONS.find((entry) => entry.id === toolId);
            if (!next) return;
            simulation.tools.setActiveTool(next);
            inventoryPanel?.setEquippedTool(next.id);
            toolInspector?.setActiveTool(next.id);
            onToolEquippedExternally(next.id);
        },
        () => {
            // Get available ore - will be set when inventory panel is created
            if (!inventoryPanel) return 0;
            return getTotalResourceCount(inventoryPanel.getState(), 'debug-asteroid-ore') ?? 0;
        },
        (amount) => {
            pendingWorkerOreDelivered += amount;
            // Worker deliveries only happen when a mining tile was opened.
            // Flush immediately so opened tiles do not reappear after refresh.
            worldAutosave.flush();
            if (!inventoryPanel) return;
            const added = inventoryPanel.addItem('debug-asteroid-ore', pendingWorkerOreDelivered);
            pendingWorkerOreDelivered -= added;

            const state = inventoryPanel.getState();
            const base = simulation.world.getEntities().find((entry) => entry.kind === 'base');
            if (base) {
                const binding = ensureEntityInventoryContainer(base, state);
                if (binding) {
                    const existingOre = state.items.find((item) => item.id === `${binding.inventoryId}:ore`)?.quantity ?? 0;
                    upsertOreItem(state, binding.inventoryId, existingOre + added);
                    sanitizeInventoryItemLocations(state);
                    inventoryPanel.replaceState(state);
                    saveInventoryState(state);
                    notifyInventoryChanged();
                }
            }

            resourcesPanel?.update();
            panel.setStatus(`Collected ${added} ore from worker delivery.`);
        },
        // Player mines directly into their own inventory — no carry/return cycle.
        (oreDefinitionId, amount) => {
            if (!inventoryPanel || amount <= 0) return;
            let added = inventoryPanel.addItem(oreDefinitionId, amount);
            if (added === 0 && oreDefinitionId !== 'debug-asteroid-ore') {
                // Fallback so player mining never silently drops yield if a drop id is missing.
                added = inventoryPanel.addItem('debug-asteroid-ore', amount);
            }
            if (added > 0) {
                worldAutosave.flush();
                resourcesPanel?.update();
                panel.setStatus(`Collected ${added} ore.`);
            }
        },
        entityInventoryAdapter,
        initialEntityDetails,
        (state) => {
            metaStore.updateEntityDetails(state);
        },
        initialBuildPanel,
        (state) => {
            metaStore.updateBuildPanel(state);
        },
    );
    scene.initialize();
    const viewportSpace = ViewportSpace.get();

    // Ensure render systems are alive before mounting windowed UI.
    await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
    });

    let persistTimer: ReturnType<typeof setTimeout> | null = null;
    metaStore.subscribe((meta) => {
        if (persistTimer) {
            clearTimeout(persistTimer);
        }
        persistTimer = setTimeout(() => {
            saveMetaToCookie(meta);
            persistTimer = null;
        }, 120);
    });

    // -------------------------------------------------------------------------
    // Debug helpers — callable from the browser console.
    // asteroidValleyDebug.player()   → dump player entity state as a string
    // asteroidValleyDebug.entity(id) → dump any entity by id
    // asteroidValleyDebug.log()      → print player trace to console
    // -------------------------------------------------------------------------
    const buildEntityTrace = (entityId: string): string => {
        const entity = simulation.world.getEntityById(entityId);
        if (!entity) return `[debug] entity "${entityId}" not found`;

        const lines: string[] = [];
        lines.push(`=== Entity: ${entity.id} (kind=${entity.kind}) ===`);
        lines.push(`  pos        : (${entity.x.toFixed(2)}, ${entity.y.toFixed(2)})`);
        lines.push(`  deployed   : ${entity.deployed ?? 'n/a'}`);
        lines.push(`  paused     : ${entity.commandsPaused ?? false}`);
        lines.push(`  toolId     : ${entity.toolId ?? 'none'}`);
        lines.push(`  miningDef  : ${entity.miningDef ? `power=${entity.miningDef.minePower} cooldown=${entity.miningDef.mineCooldownMs}ms carry=${entity.miningDef.carryCapacity}` : 'none'}`);
        lines.push(`  walking    : ${entity.walking ? `speed=${entity.walking.speedTilesPerSecond}t/s` : 'none'}`);

        const cmdList = entity.commandList as { current?: { id: string; type: string; payload: object } | null; queue?: Array<{ id: string; type: string; payload: object }> } | null;
        if (cmdList) {
            const cur = cmdList.current;
            lines.push(`  cmd.current: ${cur ? `[${cur.id}] ${cur.type} ${JSON.stringify(cur.payload)}` : 'none'}`);
            const q = cmdList.queue ?? [];
            lines.push(`  cmd.queue  : ${q.length === 0 ? 'empty' : q.map((c) => `[${c.id}] ${c.type} ${JSON.stringify(c.payload)}`).join(' | ')}`);
        } else {
            lines.push(`  cmd        : no command list`);
        }

        if (entity.movement) {
            const mv = entity.movement;
            lines.push(`  movement   : mode=${mv.mode} step=${mv.stepIndex}/${mv.path.length} homeId=${mv.homeId ?? 'n/a'}`);
            const dest = mv.path[mv.path.length - 1];
            lines.push(`  move dest  : (${dest?.x ?? '?'}, ${dest?.y ?? '?'})`);
        } else {
            lines.push(`  movement   : none`);
        }

        if (entity.mining) {
            const m = entity.mining;
            lines.push(`  mining     : target=(${m.targetX},${m.targetY}) approach=(${m.approachX},${m.approachY}) anchor=(${m.anchorX},${m.anchorY})`);
            lines.push(`  mining     : lastMined=(${m.lastMinedX},${m.lastMinedY}) carried=${m.carriedOre} cooldown=${m.cooldownMs.toFixed(0)}ms repeat=${m.repeat}`);
        } else {
            lines.push(`  mining     : none`);
        }

        const frontier = entity.mining
            ? simulation.world.isMineableFrontierSolid(entity.mining.targetX, entity.mining.targetY)
            : null;
        if (frontier !== null) {
            lines.push(`  target ok  : ${frontier ? 'YES - tile is mineable frontier' : 'NO - tile not on frontier!'}`);
        }

        return lines.join('\n');
    };

    const debugApi = {
        player: () => buildEntityTrace(simulation.world.getMainPlayerEntityId()),
        entity: (id: string) => buildEntityTrace(id),
        log: () => {
            const trace = buildEntityTrace(simulation.world.getMainPlayerEntityId());
            console.log(trace);
            return trace;
        },
        logAll: () => {
            const entities = simulation.world.getEntities();
            const traces = entities.map((e) => buildEntityTrace(e.id));
            console.log(traces.join('\n\n'));
            return traces.join('\n\n');
        },
    };

    (window as Window & { asteroidValleyDebug?: typeof debugApi }).asteroidValleyDebug = debugApi;

    // Expose game meta for quick inspection in devtools.
    (
        window as Window & {
            asteroidValleyMeta?: GameMetaStore;
            asteroidValleyViewport?: ViewportSpace;
            asteroidValleyEngine?: ReturnType<typeof createGameEngine>;
        }
    ).asteroidValleyMeta = metaStore;
    (
        window as Window & {
            asteroidValleyMeta?: GameMetaStore;
            asteroidValleyViewport?: ViewportSpace;
            asteroidValleyEngine?: ReturnType<typeof createGameEngine>;
        }
    ).asteroidValleyViewport = viewportSpace;
    (
        window as Window & {
            asteroidValleyMeta?: GameMetaStore;
            asteroidValleyViewport?: ViewportSpace;
            asteroidValleyEngine?: ReturnType<typeof createGameEngine>;
        }
    ).asteroidValleyEngine = engine;
    (
        window as Window & {
            asteroidValleyBiomeGraphMermaid?: string;
        }
    ).asteroidValleyBiomeGraphMermaid = getBiomeGenerationNodeGraphMermaid();

    const minimapRef: { current: MinimapWindow | null } = { current: null };

    const moduleHost = new ModuleHost<{
        engine: ReturnType<typeof createGameEngine>;
        simulation: GameSimulation;
        transport: LocalTransport;
        scene: GameScene;
        metaStore: GameMetaStore;
        minimapRef: { current: MinimapWindow | null };
    }>();
    moduleHost.register(createCanvasSurfaceModule({
        id: 'world-main',
        moduleId: 'surface:world-main',
        canvas: app.canvas,
        role: 'world',
        pixelRatioCap: 2,
    }));
    moduleHost.register(createMinimapUiModule());
    await moduleHost.startAll({
        engine,
        simulation,
        transport,
        scene,
        metaStore,
        minimapRef,
    });
    engine.start();

    const minimap = minimapRef.current;
    if (!minimap) {
        throw new Error('Minimap module failed to initialize.');
    }

    const actionBar = createWindowControlRail({ orientation: 'vertical', className: 'bottom-action-bar' });
    actionBar.root.setAttribute('aria-label', 'Game quick actions');

    const actionHotbar = document.createElement('div');
    actionHotbar.className = 'action-hotbar';
    actionHotbar.setAttribute('aria-label', 'Action hotbar');

    const mainActionButton = document.createElement('button');
    mainActionButton.type = 'button';
    mainActionButton.className = 'ui95-button action-hotbar-slot';

    actionHotbar.append(mainActionButton);

    const renderActionHotbar = () => {
        const equippedId = simulation.tools.getActiveTool().id;
        const mainTool = WEAPON_DEFINITIONS.find((entry) => entry.id === mainActionToolId);

        if (mainTool) {
            mainActionButton.title = `Active tool: ${mainTool.name}`;
            mainActionButton.innerHTML = `<span class="action-hotbar-slot-label">Tool</span><span class="action-hotbar-slot-icon">${getToolIconSvg(mainTool.id)}</span>`;
            const mainItemDef = getInventoryItemDefinition(mainTool.id);
            if (mainItemDef) {
                mainActionButton.style.setProperty('--slot-backdrop', mainItemDef.view.backdrop);
                mainActionButton.style.setProperty('--slot-tint', mainItemDef.view.tint);
            }
            mainActionButton.classList.toggle('is-equipped', mainTool.id === equippedId);
        }
    };

    const setMainActionTool = (toolId: string) => {
        mainActionToolId = toolId;
        renderActionHotbar();
    };

    const applyEquippedTool = (toolId: string, setMainSlot: boolean): void => {
        const next = WEAPON_DEFINITIONS.find((entry) => entry.id === toolId);
        if (!next) return;
        simulation.tools.setActiveTool(next);
        inventoryPanel?.setEquippedTool(next.id);
        toolInspector?.setActiveTool(next.id);
        if (setMainSlot) {
            setMainActionTool(next.id);
        } else {
            renderActionHotbar();
        }
    };

    onToolEquippedExternally = (toolId: string) => {
        void toolId;
        renderActionHotbar();
    };

    mainActionButton.addEventListener('click', () => {
        applyEquippedTool(mainActionToolId, true);
    });

    const snapBaseButton = createActionButton('target', 'Snap To Base', 'Center camera on base tile');
    snapBaseButton.addEventListener('click', () => {
        scene.centerCameraOnBase();
        minimap.refresh();
    });

    const inventoryButton = createActionButton('inventory', 'Inventory', 'Open the inventory window');
    inventoryButton.addEventListener('click', () => {
        inventoryPanel?.open();
    });

    const mapToggleButton = minimap.getToggleButton();
    mapToggleButton.classList.add('action-button');
    mapToggleButton.title = 'Open or close the minimap window';
    mapToggleButton.setAttribute('aria-label', 'Toggle map window');
    mapToggleButton.innerHTML = `<span class="action-button-icon" aria-hidden="true">${makeIconSvg('map')}</span>`;

    const debugToggleButton = createActionButton('debug', 'Debug', 'Show or hide camera debug crosshair');
    const debugWindow = createDebugGraphWindow({
        initialWindowState: {
            open: false,
            minimized: false,
            left: Math.max(16, window.innerWidth - 640),
            top: 112,
            width: 560,
            height: 440,
        },
        onWindowStateChange: () => {
            debugToggleButton.classList.toggle('is-active', scene.isDebugOverlayVisible());
        },
        getModuleIds: () => moduleHost.listModuleIds(),
        getBehaviorIds: () => engine.listBehaviorIds(),
        getBiomeGraphMermaid: () => getBiomeGenerationNodeGraphMermaid(),
        isOverlayEnabled: () => scene.isDebugOverlayVisible(),
        onToggleOverlay: (enabled) => {
            scene.setDebugOverlayEnabled(enabled);
        },
    });

    debugToggleButton.addEventListener('click', () => {
        debugWindow.toggle();
        debugToggleButton.classList.toggle('is-active', scene.isDebugOverlayVisible());
    });
    debugToggleButton.classList.toggle('is-active', scene.isDebugOverlayVisible());

    actionBar.root.append(snapBaseButton, inventoryButton, mapToggleButton, debugToggleButton);
    document.body.appendChild(actionBar.root);
    document.body.appendChild(actionHotbar);

    let inventoryItemDetails: ReturnType<typeof createInventoryItemDetailsWindow> | null = null;
    let inventoryPanel: ReturnType<typeof createInventoryPanel> | null = null;
    let resourcesPanel: ReturnType<typeof createResourcesPanel> | null = null;

    const panel = createMapControlPanel({
        initialSeed: simulation.world.getSeed(),
        weapons: WEAPON_DEFINITIONS,
        initialWeaponId: simulation.tools.getActiveTool().id,
        initialWindowState: initialMapControls,
        onWindowStateChange: (state) => {
            metaStore.updateMapControls(state);
        },
        onSelectWeapon: (weaponId) => {
            applyEquippedTool(weaponId, true);
            const next = WEAPON_DEFINITIONS.find((entry) => entry.id === weaponId);
            if (!next) return;
            panel.setStatus(`Selected weapon: ${next.name}.`);
        },
        onGenerate: (seed) => {
            transport.send({ type: 'GenerateWorld', seed });
            pendingWorkerOreDelivered = 0;
            if (inventoryPanel) {
                const freshInventory = createDebugInventoryState();
                freshInventory.equippedToolId = simulation.tools.getActiveTool().id;
                inventoryPanel.replaceState(freshInventory);
                sanitizeInventoryItemLocations(freshInventory);
                saveInventoryState(freshInventory);
                notifyInventoryChanged();
                resourcesPanel?.update();
            }
            panel.setStatus(`Generated fresh map with seed ${seed}. Resources reset.`);
        },
        onSave: () => {
            saveSnapshot(simulation.world.toSnapshot());
            if (inventoryPanel) {
                saveInventoryState(inventoryPanel.getState());
            }
            panel.setStatus(`Saved map with seed ${simulation.world.getSeed()}.`);
        },
        onCenterBase: () => {
            scene.centerCameraOnBase();
            minimap.refresh();
        },
    });

    toolInspector = createToolInspectorPanel({
        tools: WEAPON_DEFINITIONS,
        initialToolId: simulation.tools.getActiveTool().id,
        initialWindowState: initialToolInspector,
        onWindowStateChange: (state) => {
            metaStore.updateToolInspector(state);
        },
    });

    inventoryItemDetails = createInventoryItemDetailsWindow({
        initialWindowState: initialInventoryItemDetails,
        onWindowStateChange: (state) => {
            metaStore.updateInventoryItemDetails(state);
        },
        onEquipTool: (toolId) => {
            applyEquippedTool(toolId, true);
        },
    });
    inventoryItemDetails.clearSelection();

    inventoryPanel = createInventoryPanel({
        initialEquippedToolId: simulation.tools.getActiveTool().id,
        initialWindowState: initialInventory,
        onWindowStateChange: (state) => {
            metaStore.updateInventory(state);
        },
        onStateChange: (state) => {
            sanitizeInventoryItemLocations(state);
            saveInventoryState(state);
            notifyInventoryChanged();
        },
        onEquipTool: (toolId) => {
            applyEquippedTool(toolId, true);
        },
        onInspectItem: (selection) => {
            inventoryItemDetails?.setSelection(selection);
            inventoryItemDetails?.open();
        },
    });

    // Set inventory on simulation for beacon cost checks
    simulation.inventory = inventoryPanel.getState();

    const persistedInventory = loadInventoryState();
    if (persistedInventory) {
        sanitizeInventoryItemLocations(persistedInventory);
        inventoryPanel.replaceState(persistedInventory);
        applyEquippedTool(persistedInventory.equippedToolId, false);
        notifyInventoryChanged();
    } else {
        saveInventoryState(inventoryPanel.getState());
    }

    // Create resources panel in top-left corner
    resourcesPanel = createResourcesPanel({
        inventoryState: inventoryPanel.getState(),
        getInventoryBucket: (inventoryId) => {
            if (inventoryId === 'player') return 'held';
            if (!inventoryId.startsWith('entity:')) return 'ignore';

            const entityId = inventoryId.slice('entity:'.length);
            const entity = simulation.world.getEntityById(entityId);
            if (!entity) return 'ignore';
            if (entity.mobility === 'static') return 'storage';
            return 'held';
        },
    });

    if (pendingWorkerOreDelivered > 0) {
        const added = inventoryPanel.addItem('debug-asteroid-ore', pendingWorkerOreDelivered);
        pendingWorkerOreDelivered -= added;
        resourcesPanel?.update();
        panel.setStatus(`Collected ${added} ore from worker delivery.`);
    }

    // Refresh resources panel when inventory changes
    const inventoryAddItem = inventoryPanel.addItem.bind(inventoryPanel);
    inventoryPanel.addItem = (definitionId: string, quantity: number) => {
        const added = inventoryAddItem(definitionId, quantity);
        if (added > 0) {
            sanitizeInventoryItemLocations(inventoryPanel.getState());
            resourcesPanel?.update();
            saveInventoryState(inventoryPanel.getState());
            notifyInventoryChanged();
        }
        return added;
    };

    // NOW set up event handler after all UI is created
    transport.onEvent((event: GameEvent) => {
        if (event.type === 'WorldChunkDirty' || event.type === 'WorldGenerated') {
            minimap.refresh();

            // Visibility-only exploration changes emit dirty chunks without TileMined/TileDamaged.
            // Autosave here to persist fog-of-war progress from reveal actions.
            worldAutosave.schedule();
        }

        if (event.type === 'TileDamaged') {
            // TileDamaged is emitted only for direct left-click tool mining (MineTile command).
            // Entity-assigned mining (workers, player Mine Here) deliver via ore delivery callbacks.
            let collected = 0;
            for (const hit of event.hits) {
                if (hit.oreYield <= 0) continue;
                const added = inventoryPanel?.addItem(hit.oreDefinitionId, hit.oreYield) ?? 0;
                collected += added;
            }

            if (collected > 0) {
                panel.setStatus(`Collected ${collected} ore from mined tiles.`);
            }

            if (event.hits.some((hit) => hit.opened)) {
                worldAutosave.flush();
            } else if (event.hits.length > 0) {
                worldAutosave.schedule();
            }
        }

        if (event.type === 'TileMined') {
            worldAutosave.schedule();
        }

        if (event.type === 'EntityPlacementFailed') {
            const reasonText = {
                'too_far': 'Beacon is out of builder range',
                'not_open': 'Beacon must be placed in open space',
                'already_exists': 'Beacon already exists at this location',
                'unknown_tile': 'Cannot place beacon here',
                'insufficient_ore': 'Not enough ore (need 10)',
                'not_builder': 'Selected entity cannot build beacons',
            }[event.reason];
            panel.setStatus(`Cannot place beacon: ${reasonText}`);
        }

        if (event.type === 'EntityPlaced') {
            panel.setStatus(`Beacon placed at (${event.x}, ${event.y}) - Cost: 10 ore`);
            resourcesPanel?.update();
            minimap.refresh();
            if (inventoryPanel) {
                saveInventoryState(inventoryPanel.getState());
            }
            worldAutosave.flush();
        }

        if (event.type === 'EntityRemoved') {
            const refundText = event.refundOre > 0
                ? `Refunded ${event.refundOre} ore.`
                : 'No ore refunded (inventory full).';
            panel.setStatus(`Beacon removed at (${event.x}, ${event.y}). ${refundText}`);
            resourcesPanel?.update();
            minimap.refresh();
            if (inventoryPanel) {
                saveInventoryState(inventoryPanel.getState());
            }
            worldAutosave.flush();
        }

        if (event.type === 'EntityRemovalFailed') {
            const reasonText = event.reason === 'not_beacon'
                ? 'Selected entity is not a beacon'
                : 'Beacon not found';
            panel.setStatus(`Cannot remove beacon: ${reasonText}.`);
        }

        if (event.type === 'WorkerSpawned') {
            panel.setStatus(`Worker created at station (${event.buildingId}).`);
            worldAutosave.schedule();
        }

        if (event.type === 'WorkerDeployed') {
            panel.setStatus(`Worker deployed to (${event.x}, ${event.y}).`);
            minimap.refresh();
            worldAutosave.schedule();
        }

        if (event.type === 'WorkerRecalled') {
            panel.setStatus('Worker is returning to station.');
            minimap.refresh();
            worldAutosave.schedule();
        }

        if (event.type === 'WorkersRecalled') {
            panel.setStatus(`Returning ${event.count} worker(s) to station.`);
            minimap.refresh();
            worldAutosave.schedule();
        }

        if (event.type === 'WorkerMiningStarted') {
            panel.setStatus(`Worker is mining (${event.x}, ${event.y}).`);
            minimap.refresh();
            worldAutosave.schedule();
        }

        if (event.type === 'WorkerMoved') {
            panel.setStatus(`Worker is moving to (${event.x}, ${event.y}).`);
            minimap.refresh();
            worldAutosave.schedule();
        }

        if (event.type === 'WorkerCommandInterrupted') {
            panel.setStatus(`Interrupted current command for ${event.workerId}.`);
            minimap.refresh();
            worldAutosave.schedule();
        }

        if (event.type === 'WorkerCommandsCleared') {
            panel.setStatus(`Cleared command queue for ${event.workerId}.`);
            minimap.refresh();
            worldAutosave.schedule();
        }

        if (event.type === 'WorkerQueuedCommandRemoved') {
            panel.setStatus(`Removed queued command ${event.commandId} from ${event.workerId}.`);
            minimap.refresh();
            worldAutosave.schedule();
        }

        if (event.type === 'PlayerQueuedCommandRemoved') {
            panel.setStatus(`Removed queued walk command.`);
            worldAutosave.schedule();
        }

        if (event.type === 'PlayerCommandInterrupted') {
            panel.setStatus('Player movement interrupted.');
            worldAutosave.schedule();
        }

        if (event.type === 'PlayerCommandsCleared') {
            panel.setStatus('Player command queue cleared.');
            worldAutosave.schedule();
        }

        if (event.type === 'PlayerCommandsPaused') {
            panel.setStatus('Player queue paused.');
        }

        if (event.type === 'PlayerCommandsResumed') {
            panel.setStatus('Player queue resumed.');
        }

        if (event.type === 'WorkerCommandsPaused') {
            panel.setStatus(`Worker queue paused.`);
        }

        if (event.type === 'WorkerCommandsResumed') {
            panel.setStatus(`Worker queue resumed.`);
            worldAutosave.schedule();
        }

        if (event.type === 'WorkerActionFailed') {
            const reasonText = {
                not_found: 'entity not found',
                not_worker: 'selected entity is not a worker',
                invalid_building: 'building cannot host workers',
                already_deployed: 'worker is already deployed',
                already_recalled: 'worker is already docked',
                no_deploy_space: 'no clear tile near station for deployment',
                invalid_target: 'target tile is invalid or occupied',
                path_blocked: 'worker cannot reach that location',
            }[event.reason];
            panel.setStatus(`Worker action failed: ${reasonText}.`);
        }
    });

    const topMenu = createTopMenu({
        onOpenMapControls: () => {
            panel.open();
            updateOverlayInsets();
        },
        onOpenToolInspector: () => {
            toolInspector.open();
        },
    });
    document.body.appendChild(topMenu.root);

    const updateOverlayInsets = () => {
        const canvasRect = app.canvas.getBoundingClientRect();
        const panelElement = panel.getRootElement();
        const panelRect = panelElement.getBoundingClientRect();
        const panelVisible = !panelElement.hidden && panelRect.width > 0 && panelRect.height > 0;
        const rightInset = panelVisible ? Math.max(0, canvasRect.right - panelRect.left) : 0;
        viewportSpace.setOverlayPadding({ right: rightInset });
    };

    updateOverlayInsets();
    window.addEventListener('resize', updateOverlayInsets);

    const panelResizeObserver = new ResizeObserver(() => {
        updateOverlayInsets();
    });
    panelResizeObserver.observe(panel.getRootElement());

    const panelVisibilityObserver = new MutationObserver(() => {
        updateOverlayInsets();
    });
    panelVisibilityObserver.observe(panel.getRootElement(), { attributes: true, attributeFilter: ['hidden', 'class', 'style'] });

    if (saved) {
        panel.setStatus(`Loaded saved map with seed ${saved.seed}.`);
        minimap.refresh();
    }

    renderActionHotbar();
}
