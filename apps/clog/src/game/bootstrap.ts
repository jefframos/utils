import { Application } from 'pixi.js';
import { LocalTransport } from './core/LocalTransport';
import { GameSimulation } from './core/GameSimulation';
import { WEAPON_DEFINITIONS } from './core/ToolComponent';
import { GameScene } from './scenes/GameScene';
import type { WorldSnapshot } from './world/WorldModel';
import { GameMetaStore, type GameMeta, type MapControlsWindowMeta, type MinimapWindowMeta } from './meta/GameMetaStore';
import { createMapControlPanel } from './ui/MapControlPanel';
import { createMinimapWindow } from './ui/MinimapWindow';
import { createToolInspectorPanel } from './ui/ToolInspectorPanel';
import { createWindowControlRail } from './ui/WindowControlRail';
import { ViewportSpace } from './core/ViewportSpace';

const SAVE_KEY = 'asteroid-valley-save-v1';
const META_COOKIE_KEY = 'asteroid-valley-meta-v1';

function getCookie(name: string): string | null {
    const key = `${name}=`;
    for (const chunk of document.cookie.split(';')) {
        const trimmed = chunk.trim();
        if (trimmed.startsWith(key)) {
            return trimmed.slice(key.length);
        }
    }
    return null;
}

function normalizeMinimapMeta(candidate: Partial<MinimapWindowMeta>): MinimapWindowMeta {
    const safeMarkers = Array.isArray(candidate.markers)
        ? candidate.markers
            .slice(0, 8)
            .map((marker, index) => ({
                id: typeof marker?.id === 'string' && marker.id.length > 0 ? marker.id : `marker-${index + 1}`,
                label: typeof marker?.label === 'string' && marker.label.length > 0 ? marker.label : `Marker ${index + 1}`,
                x: Number.isFinite(marker?.x) ? Number(marker.x) : 0,
                y: Number.isFinite(marker?.y) ? Number(marker.y) : 0,
                colorKey: marker?.colorKey === 'color2' || marker?.colorKey === 'color3' ? marker.colorKey : 'color1',
            }))
        : [];

    return {
        open: candidate.open === true,
        minimized: candidate.minimized === true,
        left: Number.isFinite(candidate.left) ? Number(candidate.left) : Math.max(16, window.innerWidth - 360),
        top: Number.isFinite(candidate.top) ? Number(candidate.top) : 88,
        width: Number.isFinite(candidate.width) ? Number(candidate.width) : 320,
        height: Number.isFinite(candidate.height) ? Number(candidate.height) : 340,
        showFullMap: candidate.showFullMap === true,
        zoomLevel: Number.isFinite(candidate.zoomLevel) ? Number(candidate.zoomLevel) : 0,
        centerX: Number.isFinite(candidate.centerX) ? Number(candidate.centerX) : Number.NaN,
        centerY: Number.isFinite(candidate.centerY) ? Number(candidate.centerY) : Number.NaN,
        markers: safeMarkers,
    };
}

function normalizeMapControlsMeta(candidate: Partial<MapControlsWindowMeta>): MapControlsWindowMeta {
    return {
        open: candidate.open !== false,
        minimized: candidate.minimized === true,
        left: Number.isFinite(candidate.left) ? Number(candidate.left) : Math.max(16, window.innerWidth - 336),
        top: Number.isFinite(candidate.top) ? Number(candidate.top) : 16,
        width: Number.isFinite(candidate.width) ? Number(candidate.width) : 320,
        height: Number.isFinite(candidate.height) ? Number(candidate.height) : 236,
    };
}

function loadMetaFromCookie(): GameMeta | null {
    try {
        const raw = getCookie(META_COOKIE_KEY);
        if (!raw) return null;
        const decoded = decodeURIComponent(raw);
        const parsed = JSON.parse(decoded) as Partial<GameMeta>;
        const minimap = normalizeMinimapMeta(parsed?.windows?.minimap ?? {});
        const mapControls = normalizeMapControlsMeta(parsed?.windows?.mapControls ?? {});
        return { windows: { minimap, mapControls } };
    } catch {
        return null;
    }
}

function saveMetaToCookie(meta: GameMeta): void {
    const value = encodeURIComponent(JSON.stringify(meta));
    document.cookie = `${META_COOKIE_KEY}=${value}; path=/; max-age=31536000; samesite=lax`;
}

function loadSnapshot(): WorldSnapshot | null {
    try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as WorldSnapshot;
        if (parsed && parsed.version === 1 && Number.isFinite(parsed.seed) && Array.isArray(parsed.savedTiles)) {
            return parsed;
        }
        return null;
    } catch {
        return null;
    }
}

function saveSnapshot(snapshot: WorldSnapshot): void {
    localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot));
}

function makeIconSvg(type: 'target' | 'map' | 'debug'): string {
    if (type === 'target') {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="square"/></svg>';
    }
    if (type === 'map') {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5l5-2 5 2 8-3v14l-8 3-5-2-5 2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 4.5v15M13 6.5v15" stroke="currentColor" stroke-width="1.6"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16M4 12h16" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="5.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>';
}

function createActionButton(icon: 'target' | 'map' | 'debug', label: string, tooltip: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ui95-button action-button';
    button.title = tooltip;
    button.setAttribute('aria-label', label);
    button.innerHTML = `<span class="action-button-icon">${makeIconSvg(icon)}</span><span class="action-button-label">${label}</span>`;
    return button;
}

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

    const simulation = new GameSimulation();
    const transport = new LocalTransport(simulation);

    const saved = loadSnapshot();
    if (saved) {
        transport.send({ type: 'LoadWorldSnapshot', snapshot: saved });
    }

    const scene = new GameScene(app, simulation.world, transport, () => simulation.tools.getActiveTool());
    scene.initialize();
    const viewportSpace = ViewportSpace.get();

    // Ensure render systems are alive before mounting windowed UI.
    await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
    });

    const persistedMeta = loadMetaFromCookie();
    const initialMinimap = normalizeMinimapMeta(persistedMeta?.windows?.minimap ?? {});
    const initialMapControls = normalizeMapControlsMeta(persistedMeta?.windows?.mapControls ?? {});

    const metaStore = new GameMetaStore({
        windows: {
            minimap: initialMinimap,
            mapControls: initialMapControls,
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
        }
    ).asteroidValleyMeta = metaStore;
    (
        window as Window & {
            asteroidValleyMeta?: GameMetaStore;
            asteroidValleyViewport?: ViewportSpace;
        }
    ).asteroidValleyViewport = viewportSpace;

    const minimap = createMinimapWindow({
        world: simulation.world,
        metaStore,
        getViewportRect: () => scene.getViewportWorldRectTiles(),
        onNavigate: (tileX, tileY) => {
            scene.centerCameraOnTile(tileX, tileY);
            minimap.refresh();
        },
    });
    minimap.refresh();
    scene.onCameraChanged(() => {
        minimap.refresh();
    });
    window.addEventListener('resize', () => {
        minimap.refresh();
    });

    const actionBar = createWindowControlRail({ orientation: 'horizontal', className: 'bottom-action-bar' });
    actionBar.root.setAttribute('aria-label', 'Game quick actions');

    const snapBaseButton = createActionButton('target', 'Snap To Base', 'Center camera on base tile');
    snapBaseButton.addEventListener('click', () => {
        scene.centerCameraOnBase();
        minimap.refresh();
    });

    const mapToggleButton = minimap.getToggleButton();
    mapToggleButton.classList.add('action-button');
    mapToggleButton.title = 'Open or close the minimap window';
    mapToggleButton.setAttribute('aria-label', 'Toggle map window');
    mapToggleButton.innerHTML = `<span class="action-button-icon">${makeIconSvg('map')}</span><span class="action-button-label">Map</span>`;

    const debugToggleButton = createActionButton('debug', 'Debug', 'Show or hide camera debug crosshair');
    const updateDebugToggleState = () => {
        debugToggleButton.classList.toggle('is-active', scene.isDebugOverlayVisible());
    };
    debugToggleButton.addEventListener('click', () => {
        scene.setDebugOverlayEnabled(!scene.isDebugOverlayVisible());
        updateDebugToggleState();
    });
    updateDebugToggleState();

    actionBar.root.append(snapBaseButton, mapToggleButton, debugToggleButton);
    document.body.appendChild(actionBar.root);

    transport.onEvent((event) => {
        if (event.type === 'WorldChunkDirty' || event.type === 'WorldGenerated') {
            minimap.refresh();
        }
    });

    let toolInspector: ReturnType<typeof createToolInspectorPanel> | null = null;

    const panel = createMapControlPanel({
        initialSeed: simulation.world.getSeed(),
        initialWindowState: initialMapControls,
        weapons: WEAPON_DEFINITIONS,
        initialWeaponId: simulation.tools.getActiveTool().id,
        onWindowStateChange: (state) => {
            metaStore.updateMapControls(state);
        },
        onSelectWeapon: (weaponId) => {
            const next = WEAPON_DEFINITIONS.find((entry) => entry.id === weaponId);
            if (!next) return;
            simulation.tools.setActiveTool(next);
            toolInspector?.setActiveTool(next.id);
            panel.setStatus(`Selected weapon: ${next.name}.`);
        },
        onGenerate: (seed) => {
            transport.send({ type: 'GenerateWorld', seed });
            panel.setStatus(`Generated map with seed ${seed}.`);
        },
        onSave: () => {
            saveSnapshot(simulation.world.toSnapshot());
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
    });

    const topToolbar = document.createElement('nav');
    topToolbar.className = 'top-menu-bar';
    topToolbar.setAttribute('aria-label', 'Game menu bar');

    const mapMenu = document.createElement('div');
    mapMenu.className = 'top-menu';

    const mapMenuButton = document.createElement('button');
    mapMenuButton.type = 'button';
    mapMenuButton.className = 'top-menu-button';
    mapMenuButton.textContent = 'Map';
    mapMenuButton.title = 'Map menu';
    mapMenuButton.setAttribute('aria-haspopup', 'menu');
    mapMenuButton.setAttribute('aria-expanded', 'false');

    const mapMenuList = document.createElement('div');
    mapMenuList.className = 'top-menu-list';
    mapMenuList.setAttribute('role', 'menu');

    const openMapControlsItem = document.createElement('button');
    openMapControlsItem.type = 'button';
    openMapControlsItem.className = 'top-menu-item';
    openMapControlsItem.textContent = 'Open Map Controls';
    openMapControlsItem.title = 'Open the map controls window';
    openMapControlsItem.setAttribute('role', 'menuitem');

    const openToolInspectorItem = document.createElement('button');
    openToolInspectorItem.type = 'button';
    openToolInspectorItem.className = 'top-menu-item';
    openToolInspectorItem.textContent = 'Open Tool Inspector';
    openToolInspectorItem.title = 'Open the tool inspector window';
    openToolInspectorItem.setAttribute('role', 'menuitem');

    mapMenuList.append(openMapControlsItem, openToolInspectorItem);
    mapMenu.append(mapMenuButton, mapMenuList);
    topToolbar.append(mapMenu);
    document.body.appendChild(topToolbar);

    const closeMapMenu = () => {
        mapMenu.classList.remove('is-open');
        mapMenuButton.setAttribute('aria-expanded', 'false');
    };

    mapMenuButton.addEventListener('click', (event) => {
        event.stopPropagation();
        const willOpen = !mapMenu.classList.contains('is-open');
        closeMapMenu();
        if (willOpen) {
            mapMenu.classList.add('is-open');
            mapMenuButton.setAttribute('aria-expanded', 'true');
        }
    });

    openMapControlsItem.addEventListener('click', () => {
        panel.open();
        closeMapMenu();
        updateOverlayInsets();
    });

    openToolInspectorItem.addEventListener('click', () => {
        toolInspector.open();
        closeMapMenu();
    });

    window.addEventListener('click', (event) => {
        if (!mapMenu.contains(event.target as Node)) {
            closeMapMenu();
        }
    });

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
}
