import { BIOME_DEFINITIONS } from '../content/biomes';
import type { WorldViewportRect } from '../camera/GameCamera';
import { GameMetaStore } from '../meta/GameMetaStore';
import { GAME_COLORS } from '../config';
import { createFloatingWindow } from './FloatingWindow';
import { createContextMenuTemplate } from './ContextMenuTemplate';
import { createWindowControlRail } from './WindowControlRail';
import { WorldModel } from '../world/WorldModel';

type MinimapWindowOptions = {
    world: WorldModel;
    metaStore: GameMetaStore;
    getViewportRect: () => WorldViewportRect;
    onNavigate: (tileX: number, tileY: number) => void;
};

type MinimapWindow = {
    refresh: () => void;
    getToggleButton: () => HTMLButtonElement;
    destroy: () => void;
};

export function createMinimapWindow(options: MinimapWindowOptions): MinimapWindow {
    const { world, metaStore, getViewportRect, onNavigate } = options;
    // Start at a pannable minimap zoom instead of full-world fit.
    const zoomSteps = [0.25, 0.5, 1, 2, 4, 8] as const;
    const BASE_VIEW_HEIGHT_TILES = 80;
    const initialMeta = metaStore.getMeta().windows.minimap;
    const initialViewport = getViewportRect();
    let minimapCenterX = Number.isFinite(initialMeta.centerX)
        ? initialMeta.centerX
        : (initialViewport.left + initialViewport.right) * 0.5;
    let minimapCenterY = Number.isFinite(initialMeta.centerY)
        ? initialMeta.centerY
        : (initialViewport.top + initialViewport.bottom) * 0.5;
    let markers = initialMeta.markers.slice(0, 8);
    let selectedMarkerId: string | null = null;
    let isMiddlePanning = false;
    let lastPanClientX = 0;
    let lastPanClientY = 0;
    let suppressNextClick = false;
    let renderQueued = false;
    const frame = createFloatingWindow({
        title: 'Minimap',
        className: 'minimap-window',
        initialState: {
            open: initialMeta.open,
            minimized: initialMeta.minimized,
            left: initialMeta.left,
            top: initialMeta.top,
            width: initialMeta.width,
            height: initialMeta.height,
        },
        onStateChange: (state) => {
            metaStore.updateMinimap({
                open: state.open,
                minimized: state.minimized,
                left: state.left,
                top: state.top,
                width: state.width,
                height: state.height,
            });
        },
    });

    const canvas = document.createElement('canvas');
    canvas.className = 'minimap-canvas';

    const body = document.createElement('div');
    body.className = 'minimap-body';

    const markerStrip = document.createElement('div');
    markerStrip.className = 'minimap-marker-strip';

    const contextMenu = createContextMenuTemplate();
    body.appendChild(contextMenu.getRoot());

    const controls = createWindowControlRail({ orientation: 'vertical', className: 'minimap-controls-rail' });
    const biomeFillColors = new Map<number, string>();

    const makeIcon = (name: 'plus' | 'minus' | 'eye' | 'eyeOff' | 'bug' | 'centerBase' | 'centerViewport'): string => {
        if (name === 'plus') {
            return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="square"/></svg>';
        }
        if (name === 'minus') {
            return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="square"/></svg>';
        }
        if (name === 'eye') {
            return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.8-6 9.5-6 9.5 6 9.5 6-3.8 6-9.5 6-9.5-6-9.5-6z" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="2.7" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>';
        }
        if (name === 'eyeOff') {
            return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.8-6 9.5-6 9.5 6 9.5 6-3.8 6-9.5 6-9.5-6-9.5-6z" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="2.7" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M4 20L20 4" stroke="currentColor" stroke-width="1.8"/></svg>';
        }
        if (name === 'centerBase') {
            return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4L5 9v10h14V9z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M10 19v-5h4v5" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="10" r="1.4" fill="currentColor"/></svg>';
        }
        if (name === 'centerViewport') {
            return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="6" width="14" height="12" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 3v4M12 17v4M2 12h4M18 12h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
        }
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 10h8v9H8z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M9.5 10V8.7a2.5 2.5 0 0 1 5 0V10" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M10 5.2L8 3.5M14 5.2L16 3.5M7 12H5M19 12h-2M7 15H5M19 15h-2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="11" cy="13.5" r="0.8" fill="currentColor"/><circle cx="13" cy="13.5" r="0.8" fill="currentColor"/></svg>';
    };

    const centerOnViewport = () => {
        const viewport = getViewportRect();
        minimapCenterX = (viewport.left + viewport.right) * 0.5;
        minimapCenterY = (viewport.top + viewport.bottom) * 0.5;
        syncMinimapMeta();
    };

    const centerOnBase = () => {
        minimapCenterX = world.baseX + 0.5;
        minimapCenterY = world.baseY + 0.5;
        syncMinimapMeta();
    };

    const panByTiles = (dxTiles: number, dyTiles: number) => {
        minimapCenterX -= dxTiles;
        minimapCenterY -= dyTiles;
    };

    const getCurrentTransform = () => {
        const viewport = getViewportRect();
        return {
            viewport,
            transform: getMapTransform(viewport),
        };
    };

    const getBiomeFillColor = (biomeId: number): string => {
        const cached = biomeFillColors.get(biomeId);
        if (cached) return cached;
        const biome = BIOME_DEFINITIONS[biomeId as keyof typeof BIOME_DEFINITIONS];
        const color = `#${biome.fill.toString(16).padStart(6, '0')}`;
        biomeFillColors.set(biomeId, color);
        return color;
    };

    const syncMinimapMeta = () => {
        metaStore.updateMinimap({
            centerX: minimapCenterX,
            centerY: minimapCenterY,
            markers,
        });
    };

    const getMarkerColor = (colorKey: 'color1' | 'color2' | 'color3'): string => {
        return GAME_COLORS[colorKey];
    };

    const getMarkerChipIcon = (colorKey: 'color1' | 'color2' | 'color3'): string => {
        const color = getMarkerColor(colorKey);
        return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a6 6 0 0 0-6 6c0 4.3 6 12 6 12s6-7.7 6-12a6 6 0 0 0-6-6z" fill="${color}" stroke="#1f2937" stroke-width="1.2"/><circle cx="12" cy="9" r="2.3" fill="#e0f2fe"/></svg>`;
    };

    const markerHitTest = (px: number, py: number, startX: number, startY: number, pixelPerTile: number): string | null => {
        for (let i = markers.length - 1; i >= 0; i--) {
            const marker = markers[i];
            const markerPx = (marker.x + 0.5 - startX) * pixelPerTile;
            const markerPy = (marker.y + 0.5 - startY) * pixelPerTile;
            const radius = Math.max(5, pixelPerTile * 0.45);
            const dx = px - markerPx;
            const dy = py - markerPy;
            if (dx * dx + dy * dy <= radius * radius) {
                return marker.id;
            }
        }
        return null;
    };

    const centerCameraOnMarker = (markerId: string) => {
        const marker = markers.find((entry) => entry.id === markerId);
        if (!marker) return;
        onNavigate(marker.x, marker.y);
    };

    const deleteMarker = (markerId: string) => {
        const next = markers.filter((entry) => entry.id !== markerId);
        if (next.length === markers.length) return;
        markers = next;
        if (selectedMarkerId === markerId) {
            selectedMarkerId = null;
        }
        syncMinimapMeta();
        render();
    };

    const addMarkerAt = (tileX: number, tileY: number) => {
        if (markers.length >= 8) return;
        const markerIndex = markers.length + 1;
        const palette: Array<'color1' | 'color2' | 'color3'> = ['color1', 'color2', 'color3'];
        const marker = {
            id: `m-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            label: `Marker ${markerIndex}`,
            x: tileX,
            y: tileY,
            colorKey: palette[(markerIndex - 1) % palette.length],
        };
        markers = [...markers, marker];
        selectedMarkerId = marker.id;
        syncMinimapMeta();
        render();
    };

    const rebuildMarkerStrip = () => {
        markerStrip.innerHTML = '';
        for (const marker of markers.slice(0, 8)) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'ui95-button minimap-marker-chip';
            if (marker.id === selectedMarkerId) {
                button.classList.add('is-active');
            }
            button.title = `${marker.label} (${marker.x}, ${marker.y})`;
            button.setAttribute('aria-label', marker.label);

            const icon = document.createElement('span');
            icon.className = 'minimap-marker-chip-icon';
            icon.innerHTML = getMarkerChipIcon(marker.colorKey);

            button.append(icon);
            button.addEventListener('click', () => {
                selectedMarkerId = marker.id;
                rebuildMarkerStrip();
                centerCameraOnMarker(marker.id);
            });

            markerStrip.appendChild(button);
        }
    };

    const centerViewportButton = controls.createButton({ iconHtml: makeIcon('centerViewport'), tooltip: 'Center minimap on current viewport', className: 'minimap-rail-button' });

    const centerBaseButton = controls.createButton({ iconHtml: makeIcon('centerBase'), tooltip: 'Center minimap on base', className: 'minimap-rail-button' });

    const revealToggle = controls.createButton({
        iconHtml: makeIcon(initialMeta.showFullMap ? 'eye' : 'eyeOff'),
        tooltip: initialMeta.showFullMap ? 'Show revealed tiles only' : 'Show full map',
        className: 'minimap-rail-button',
    });

    const zoomOutButton = controls.createButton({ iconHtml: makeIcon('minus'), tooltip: 'Zoom out', className: 'minimap-rail-button' });

    const zoomInButton = controls.createButton({ iconHtml: makeIcon('plus'), tooltip: 'Zoom in', className: 'minimap-rail-button' });

    const debugLogButton = controls.createButton({ iconHtml: makeIcon('bug'), tooltip: 'Log minimap camera debug', className: 'minimap-rail-button' });

    controls.root.append(centerViewportButton, centerBaseButton, zoomInButton, zoomOutButton, revealToggle, debugLogButton);
    body.append(canvas, controls.root, markerStrip);
    frame.content.append(body);

    const toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = 'minimap-toggle ui95-button';
    toggleButton.textContent = 'Map';

    document.body.append(toggleButton);

    const getMapTransform = (viewport: WorldViewportRect) => {
        const meta = metaStore.getMeta().windows.minimap;
        const zoomLevel = Math.max(0, Math.min(zoomSteps.length - 1, meta.zoomLevel));
        const zoom = zoomSteps[zoomLevel];

        const aspect = canvas.height > 0 ? canvas.width / canvas.height : 1;
        const viewHeightTiles = BASE_VIEW_HEIGHT_TILES / zoom;
        const viewWidthTiles = viewHeightTiles * aspect;

        const startX = minimapCenterX - viewWidthTiles * 0.5;
        const startY = minimapCenterY - viewHeightTiles * 0.5;
        const endX = startX + viewWidthTiles;
        const endY = startY + viewHeightTiles;

        const pixelPerTile = canvas.height / viewHeightTiles;

        return { pixelPerTile, startX, startY, endX, endY, zoomLevel, zoom, viewWidthTiles, viewHeightTiles };
    };

    const renderNow = () => {
        const meta = metaStore.getMeta().windows.minimap;
        if (!meta.open || meta.minimized) return;

        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const targetWidth = Math.max(1, Math.floor(rect.width * dpr));
        const targetHeight = Math.max(1, Math.floor(rect.height * dpr));

        if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
            canvas.width = targetWidth;
            canvas.height = targetHeight;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = false;

        const viewport = getViewportRect();
        const { pixelPerTile, startX, startY, endX, endY } = getMapTransform(viewport);

        ctx.fillStyle = '#02040a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const minTileX = Math.max(0, Math.floor(startX));
        const maxTileX = Math.min(world.width - 1, Math.ceil(endX) - 1);
        const minTileY = Math.max(0, Math.floor(startY));
        const maxTileY = Math.min(world.height - 1, Math.ceil(endY) - 1);

        for (let y = minTileY; y <= maxTileY; y++) {
            for (let x = minTileX; x <= maxTileX; x++) {
                const tile = world.getTile(x, y);
                if (!tile) continue;

                const visibility = world.getTileVisibility(x, y);
                if (!meta.showFullMap && visibility === 'Unknown') {
                    continue;
                }

                let color = '#090b12';
                if (tile.solid) {
                    if (!meta.showFullMap && visibility === 'EdgeHint') {
                        color = '#0a0d16';
                    } else {
                        color = getBiomeFillColor(tile.biome);
                    }
                }

                ctx.fillStyle = color;
                const px = (x - startX) * pixelPerTile;
                const py = (y - startY) * pixelPerTile;
                ctx.fillRect(px, py, pixelPerTile + 0.5, pixelPerTile + 0.5);
            }
        }

        const baseX = (world.baseX + 0.5 - startX) * pixelPerTile;
        const baseY = (world.baseY + 0.5 - startY) * pixelPerTile;
        const baseRadius = Math.max(2, pixelPerTile);
        ctx.fillStyle = '#93c5fd';
        ctx.fillRect(baseX - baseRadius, baseY - baseRadius, baseRadius * 2, baseRadius * 2);

        for (const marker of markers) {
            const markerX = (marker.x + 0.5 - startX) * pixelPerTile;
            const markerY = (marker.y + 0.5 - startY) * pixelPerTile;
            const markerRadius = Math.max(4, pixelPerTile * 0.45);
            ctx.beginPath();
            ctx.arc(markerX, markerY, markerRadius, 0, Math.PI * 2);
            ctx.fillStyle = getMarkerColor(marker.colorKey);
            ctx.fill();
            ctx.lineWidth = marker.id === selectedMarkerId ? Math.max(2, dpr) : Math.max(1, dpr * 0.8);
            ctx.strokeStyle = '#f8fafc';
            ctx.stroke();
        }

        const vx = (viewport.left - startX) * pixelPerTile;
        const vy = (viewport.top - startY) * pixelPerTile;
        const vw = Math.max(2, (viewport.right - viewport.left) * pixelPerTile);
        const vh = Math.max(2, (viewport.bottom - viewport.top) * pixelPerTile);
        ctx.strokeStyle = '#f8fafc';
        ctx.lineWidth = Math.max(1, dpr);
        ctx.strokeRect(vx, vy, vw, vh);

        rebuildMarkerStrip();
    };

    const render = () => {
        if (renderQueued) return;
        renderQueued = true;
        requestAnimationFrame(() => {
            renderQueued = false;
            renderNow();
        });
    };

    toggleButton.addEventListener('click', () => {
        const meta = metaStore.getMeta().windows.minimap;
        const nextOpen = !meta.open;
        frame.setOpen(nextOpen);
        if (nextOpen) {
            frame.setMinimized(false);
            render();
        }
    });

    revealToggle.addEventListener('click', () => {
        const meta = metaStore.getMeta().windows.minimap;
        const nextShowFull = !meta.showFullMap;
        metaStore.updateMinimap({ showFullMap: nextShowFull });
        revealToggle.innerHTML = makeIcon(nextShowFull ? 'eye' : 'eyeOff');
        revealToggle.title = nextShowFull ? 'Show revealed tiles only' : 'Show full map';
        render();
    });

    zoomOutButton.addEventListener('click', () => {
        const meta = metaStore.getMeta().windows.minimap;
        const next = Math.max(0, meta.zoomLevel - 1);
        if (next !== meta.zoomLevel) {
            metaStore.updateMinimap({ zoomLevel: next });
        }
        syncMinimapMeta();
        render();
    });

    zoomInButton.addEventListener('click', () => {
        const meta = metaStore.getMeta().windows.minimap;
        const next = Math.min(zoomSteps.length - 1, meta.zoomLevel + 1);
        if (next !== meta.zoomLevel) {
            metaStore.updateMinimap({ zoomLevel: next });
        }
        syncMinimapMeta();
        render();
    });

    debugLogButton.addEventListener('click', () => {
        const { viewport, transform: t } = getCurrentTransform();
        const camCenterX = (viewport.left + viewport.right) * 0.5;
        const camCenterY = (viewport.top + viewport.bottom) * 0.5;
        const miniCenterX = t.startX + (t.endX - t.startX) * 0.5;
        const miniCenterY = t.startY + (t.endY - t.startY) * 0.5;
        console.log('[MinimapDebug]', {
            viewport,
            transform: t,
            cameraCenter: { x: camCenterX, y: camCenterY },
            minimapCenter: { x: miniCenterX, y: miniCenterY },
            centerDelta: { x: miniCenterX - camCenterX, y: miniCenterY - camCenterY },
        });
    });

    centerViewportButton.addEventListener('click', () => {
        centerOnViewport();
        render();
    });

    centerBaseButton.addEventListener('click', () => {
        centerOnBase();
        render();
    });

    const onCanvasMouseDown = (event: MouseEvent) => {
        if (event.button !== 1) return;
        event.preventDefault();
        isMiddlePanning = true;
        suppressNextClick = false;
        lastPanClientX = event.clientX;
        lastPanClientY = event.clientY;
    };

    const onWindowMouseMove = (event: MouseEvent) => {
        if (!isMiddlePanning) return;
        const dx = event.clientX - lastPanClientX;
        const dy = event.clientY - lastPanClientY;
        if (dx === 0 && dy === 0) return;
        const { transform } = getCurrentTransform();
        panByTiles(dx / transform.pixelPerTile, dy / transform.pixelPerTile);
        lastPanClientX = event.clientX;
        lastPanClientY = event.clientY;
        suppressNextClick = true;
        render();
    };

    const onWindowMouseUp = (event: MouseEvent) => {
        if (event.button !== 1) return;
        isMiddlePanning = false;
        syncMinimapMeta();
    };

    const onCanvasAuxClick = (event: MouseEvent) => {
        if (event.button === 1) {
            event.preventDefault();
        }
    };

    const onCanvasContextMenu = (event: MouseEvent) => {
        event.preventDefault();

        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const px = (event.clientX - rect.left) * dpr;
        const py = (event.clientY - rect.top) * dpr;
        const viewport = getViewportRect();
        const { pixelPerTile, startX, startY } = getMapTransform(viewport);
        const tileX = Math.floor(startX + px / pixelPerTile);
        const tileY = Math.floor(startY + py / pixelPerTile);
        const hitMarkerId = markerHitTest(px, py, startX, startY, pixelPerTile);

        const items = [] as Array<{ id: string; label: string; onSelect: () => void; disabled?: boolean }>;

        if (hitMarkerId) {
            items.push({
                id: 'delete-marker',
                label: 'Delete Marker',
                onSelect: () => deleteMarker(hitMarkerId),
            });
        }

        items.push({
            id: 'add-marker',
            label: 'Add Marker',
            disabled: markers.length >= 8,
            onSelect: () => addMarkerAt(tileX, tileY),
        });

        contextMenu.open({ x: event.clientX, y: event.clientY, items });
    };

    canvas.addEventListener('mousedown', onCanvasMouseDown);
    canvas.addEventListener('auxclick', onCanvasAuxClick);
    canvas.addEventListener('contextmenu', onCanvasContextMenu);
    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', onWindowMouseUp);

    canvas.addEventListener('click', (event) => {
        if (suppressNextClick) {
            suppressNextClick = false;
            return;
        }

        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const px = (event.clientX - rect.left) * dpr;
        const py = (event.clientY - rect.top) * dpr;
        const viewport = getViewportRect();
        const { pixelPerTile, startX, startY } = getMapTransform(viewport);

        const hitMarkerId = markerHitTest(px, py, startX, startY, pixelPerTile);
        if (hitMarkerId) {
            selectedMarkerId = hitMarkerId;
            rebuildMarkerStrip();
            render();
            return;
        }

        const tileX = Math.floor(startX + px / pixelPerTile);
        const tileY = Math.floor(startY + py / pixelPerTile);
        onNavigate(tileX, tileY);
        render();
    });

    canvas.addEventListener('dblclick', (event) => {
        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const px = (event.clientX - rect.left) * dpr;
        const py = (event.clientY - rect.top) * dpr;
        const viewport = getViewportRect();
        const { pixelPerTile, startX, startY } = getMapTransform(viewport);
        const hitMarkerId = markerHitTest(px, py, startX, startY, pixelPerTile);
        if (!hitMarkerId) return;

        selectedMarkerId = hitMarkerId;
        rebuildMarkerStrip();
        centerCameraOnMarker(hitMarkerId);
        render();
    });

    const resizeObserver = new ResizeObserver(() => {
        render();
    });
    resizeObserver.observe(frame.root);

    const unsubscribeMeta = metaStore.subscribe((meta) => {
        revealToggle.innerHTML = makeIcon(meta.windows.minimap.showFullMap ? 'eye' : 'eyeOff');
        revealToggle.title = meta.windows.minimap.showFullMap ? 'Show revealed tiles only' : 'Show full map';
        minimapCenterX = Number.isFinite(meta.windows.minimap.centerX) ? meta.windows.minimap.centerX : minimapCenterX;
        minimapCenterY = Number.isFinite(meta.windows.minimap.centerY) ? meta.windows.minimap.centerY : minimapCenterY;
        markers = meta.windows.minimap.markers.slice(0, 8);
        render();
    });

    if (initialMeta.open && !initialMeta.minimized) {
        render();
    }

    return {
        refresh: render,
        getToggleButton: () => toggleButton,
        destroy: () => {
            canvas.removeEventListener('mousedown', onCanvasMouseDown);
            canvas.removeEventListener('auxclick', onCanvasAuxClick);
            canvas.removeEventListener('contextmenu', onCanvasContextMenu);
            window.removeEventListener('mousemove', onWindowMouseMove);
            window.removeEventListener('mouseup', onWindowMouseUp);
            resizeObserver.disconnect();
            unsubscribeMeta();
            contextMenu.destroy();
            frame.destroy();
            toggleButton.remove();
        },
    };
}
