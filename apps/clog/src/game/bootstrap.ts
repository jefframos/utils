import { Application } from 'pixi.js';
import { LocalTransport } from './core/LocalTransport';
import { GameSimulation } from './core/GameSimulation';
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
import { getInventoryItemDefinition, getTotalResourceCount, createDebugInventoryState } from './inventory/InventoryModel';
import {
    createWorldAutosave,
    getDropDefinitionIdForBiome,
    loadMetaFromCookie,
    loadSnapshot,
    normalizeInventoryItemDetailsMeta,
    normalizeInventoryMeta,
    normalizeMapControlsMeta,
    normalizeMinimapMeta,
    normalizeToolInspectorMeta,
    saveMetaToCookie,
    saveSnapshot,
} from './bootstrap/storage';
import { createActionButton, getToolIconSvg, makeIconSvg } from './bootstrap/icons';
import { createTopMenu } from './bootstrap/topMenu';
import { createGameEngine } from './engine/GameEngine';
import { ModuleHost } from './modules/ModuleHost';
import { createCanvasSurfaceModule } from './modules/builtin/CanvasSurfaceModule';
import { createMinimapUiModule } from './modules/builtin/MinimapUiModule';
import { getBiomeGenerationNodeGraphMermaid } from './world/noise';

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

    let toolInspector: ReturnType<typeof createToolInspectorPanel> | null = null;
    let onToolEquippedExternally: (toolId: string) => void = () => { };
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
    );
    scene.initialize();
    const viewportSpace = ViewportSpace.get();

    // Ensure render systems are alive before mounting windowed UI.
    await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
    });

    const persistedMeta = loadMetaFromCookie();
    const initialMinimap = normalizeMinimapMeta(persistedMeta?.windows?.minimap ?? {});
    const initialMapControls = normalizeMapControlsMeta(persistedMeta?.windows?.mapControls ?? {});
    const initialInventory = normalizeInventoryMeta(persistedMeta?.windows?.inventory ?? {});
    const initialToolInspector = normalizeToolInspectorMeta(persistedMeta?.windows?.toolInspector ?? {});
    const initialInventoryItemDetails = normalizeInventoryItemDetailsMeta(persistedMeta?.windows?.inventoryItemDetails ?? {});

    const metaStore = new GameMetaStore({
        windows: {
            minimap: initialMinimap,
            mapControls: initialMapControls,
            inventory: initialInventory,
            toolInspector: initialToolInspector,
            inventoryItemDetails: initialInventoryItemDetails,
        },
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
    let panel: ReturnType<typeof createMapControlPanel> | null = null;

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

    // Now create the map panel UI with the inventory
    panel = createMapControlPanel({
        initialSeed: simulation.world.getSeed(),
        weapons: WEAPON_DEFINITIONS,
        initialWeaponId: simulation.tools.getActiveTool().id,
        initialWindowState: initialMapControls,
        inventory: inventoryPanel?.getState() ?? createDebugInventoryState(),
        onWindowStateChange: (state) => {
            metaStore.updateMapControls(state);
        },
        onSelectWeapon: (weaponId) => {
            applyEquippedTool(weaponId, true);
            const next = WEAPON_DEFINITIONS.find((entry) => entry.id === weaponId);
            if (!next) return;
            panel?.setStatus(`Selected weapon: ${next.name}.`);
        },
        onGenerate: (seed) => {
            transport.send({ type: 'GenerateWorld', seed });
            panel?.setStatus(`Generated map with seed ${seed}.`);
        },
        onSave: () => {
            saveSnapshot(simulation.world.toSnapshot());
            panel?.setStatus(`Saved map with seed ${simulation.world.getSeed()}.`);
        },
        onCenterBase: () => {
            scene.centerCameraOnBase();
            minimap.refresh();
        },
        onBuild: (itemId: string) => {
            if (itemId === 'beacon') {
                panel?.setStatus('Click right on a tile to place a beacon in build mode');
            }
        },
    });

    // Create resources panel in top-left corner
    resourcesPanel = createResourcesPanel({
        inventoryState: inventoryPanel.getState(),
    });

    // Refresh resources panel when inventory changes
    const inventoryAddItem = inventoryPanel.addItem.bind(inventoryPanel);
    inventoryPanel.addItem = (definitionId: string, quantity: number) => {
        const added = inventoryAddItem(definitionId, quantity);
        if (added > 0) {
            resourcesPanel?.update();
        }
        return added;
    };

    // NOW set up event handler after all UI is created
    transport.onEvent((event) => {
        if (event.type === 'WorldChunkDirty' || event.type === 'WorldGenerated') {
            minimap.refresh();

            // Visibility-only exploration changes emit dirty chunks without TileMined/TileDamaged.
            // Autosave here to persist fog-of-war progress from reveal actions.
            worldAutosave.schedule();
        }

        if (event.type === 'TileDamaged') {
            let collected = 0;
            for (const hit of event.hits) {
                if (!hit.opened) continue;
                const tile = simulation.world.getTile(hit.x, hit.y);
                if (!tile) continue;
                const dropId = getDropDefinitionIdForBiome(tile.biome);
                const added = inventoryPanel?.addItem(dropId, 1) ?? 0;
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

        if (event.type === 'BeaconPlacementFailed') {
            const reasonText = {
                'too_far': 'Beacon too far from base or nearest beacon',
                'not_open': 'Beacon must be placed in open space',
                'already_exists': 'Beacon already exists at this location',
                'unknown_tile': 'Cannot place beacon here',
                'insufficient_ore': 'Not enough ore (need 10)',
            }[event.reason];
            panel.setStatus(`Cannot place beacon: ${reasonText}`);
        }

        if (event.type === 'BeaconPlaced') {
            panel.setStatus(`Beacon placed at (${event.x}, ${event.y}) - Cost: 10 ore`);
            resourcesPanel?.update();
            minimap.refresh();
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
