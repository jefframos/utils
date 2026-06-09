import { BASE_START_X, BASE_START_Y } from '../config';
import { GameSimulation } from '../core/GameSimulation';
import {
    type GameMeta,
    type InventoryItemDetailsWindowMeta,
    type InventoryWindowMeta,
    type MapControlsWindowMeta,
    type MinimapWindowMeta,
    type ToolInspectorWindowMeta,
} from '../meta/GameMetaStore';
import type { LegacyWorldSnapshot, SnapshotV2, WorldSnapshot } from '../world/WorldModel';

const SAVE_KEY = 'asteroid-valley-save-v1';
const META_COOKIE_KEY = 'asteroid-valley-meta-v1';
let quotaWarningShown = false;

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

export function normalizeMinimapMeta(candidate: Partial<MinimapWindowMeta>): MinimapWindowMeta {
    const safeMarkers = Array.isArray(candidate.markers)
        ? candidate.markers
            .slice(0, 8)
            .map((marker, index) => {
                const colorKey: 'color1' | 'color2' | 'color3' = marker?.colorKey === 'color2' || marker?.colorKey === 'color3'
                    ? marker.colorKey
                    : 'color1';

                return {
                    id: typeof marker?.id === 'string' && marker.id.length > 0 ? marker.id : `marker-${index + 1}`,
                    label: typeof marker?.label === 'string' && marker.label.length > 0 ? marker.label : `Marker ${index + 1}`,
                    x: Number.isFinite(marker?.x) ? Number(marker.x) : 0,
                    y: Number.isFinite(marker?.y) ? Number(marker.y) : 0,
                    colorKey,
                };
            })
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

export function normalizeMapControlsMeta(candidate: Partial<MapControlsWindowMeta>): MapControlsWindowMeta {
    return {
        open: candidate.open !== false,
        minimized: candidate.minimized === true,
        left: Number.isFinite(candidate.left) ? Number(candidate.left) : Math.max(16, window.innerWidth - 336),
        top: Number.isFinite(candidate.top) ? Number(candidate.top) : 16,
        width: Number.isFinite(candidate.width) ? Number(candidate.width) : 320,
        height: Number.isFinite(candidate.height) ? Number(candidate.height) : 236,
    };
}

export function normalizeInventoryMeta(candidate: Partial<InventoryWindowMeta>): InventoryWindowMeta {
    return {
        open: candidate.open === true,
        minimized: candidate.minimized === true,
        left: Number.isFinite(candidate.left) ? Number(candidate.left) : Math.max(16, window.innerWidth - 640),
        top: Number.isFinite(candidate.top) ? Number(candidate.top) : 92,
        width: 560,
        height: 500,
    };
}

export function normalizeToolInspectorMeta(candidate: Partial<ToolInspectorWindowMeta>): ToolInspectorWindowMeta {
    return {
        open: candidate.open === true,
        minimized: candidate.minimized === true,
        left: Number.isFinite(candidate.left) ? Number(candidate.left) : Math.max(16, window.innerWidth - 680),
        top: Number.isFinite(candidate.top) ? Number(candidate.top) : 56,
        width: Number.isFinite(candidate.width) ? Number(candidate.width) : 320,
        height: Number.isFinite(candidate.height) ? Number(candidate.height) : 280,
    };
}

export function normalizeInventoryItemDetailsMeta(candidate: Partial<InventoryItemDetailsWindowMeta>): InventoryItemDetailsWindowMeta {
    return {
        open: false,
        minimized: candidate.minimized === true,
        left: Number.isFinite(candidate.left) ? Number(candidate.left) : 24,
        top: Number.isFinite(candidate.top) ? Number(candidate.top) : 120,
        width: Number.isFinite(candidate.width) ? Number(candidate.width) : 340,
        height: Number.isFinite(candidate.height) ? Number(candidate.height) : 300,
    };
}

export function loadMetaFromCookie(): GameMeta | null {
    try {
        const raw = getCookie(META_COOKIE_KEY);
        if (!raw) return null;
        const decoded = decodeURIComponent(raw);
        const parsed = JSON.parse(decoded) as Partial<GameMeta>;
        const minimap = normalizeMinimapMeta(parsed?.windows?.minimap ?? {});
        const mapControls = normalizeMapControlsMeta(parsed?.windows?.mapControls ?? {});
        const inventory = normalizeInventoryMeta(parsed?.windows?.inventory ?? {});
        const toolInspector = normalizeToolInspectorMeta(parsed?.windows?.toolInspector ?? {});
        const inventoryItemDetails = normalizeInventoryItemDetailsMeta(parsed?.windows?.inventoryItemDetails ?? {});
        return { windows: { minimap, mapControls, inventory, toolInspector, inventoryItemDetails } };
    } catch {
        return null;
    }
}

export function saveMetaToCookie(meta: GameMeta): void {
    const { width: _inventoryWidth, height: _inventoryHeight, ...inventoryPersisted } = meta.windows.inventory;
    const { width: _detailsWidth, height: _detailsHeight, ...detailsPersisted } = meta.windows.inventoryItemDetails;
    const persisted = {
        windows: {
            ...meta.windows,
            inventory: inventoryPersisted,
            inventoryItemDetails: detailsPersisted,
        },
    };
    const value = encodeURIComponent(JSON.stringify(persisted));
    document.cookie = `${META_COOKIE_KEY}=${value}; path=/; max-age=31536000; samesite=lax`;
}

export function loadSnapshot(): WorldSnapshot | null {
    try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as WorldSnapshot | SnapshotV2 | LegacyWorldSnapshot;
        if (!parsed || !Number.isFinite(parsed.seed) || !Array.isArray(parsed.savedTiles)) {
            return null;
        }

        if (parsed.version === 1) {
            return {
                version: 3,
                seed: parsed.seed,
                width: 256,
                height: 256,
                savedTiles: parsed.savedTiles,
                entities: [
                    {
                        id: 'entity-base',
                        kind: 'base',
                        mobility: 'static',
                        x: BASE_START_X,
                        y: BASE_START_Y,
                        visibilityRadius: 7,
                        parentId: null,
                    },
                ],
            };
        }

        if (parsed.version === 2) {
            const convertedEntities = [
                {
                    id: 'entity-base',
                    kind: 'base' as const,
                    mobility: 'static' as const,
                    x: BASE_START_X,
                    y: BASE_START_Y,
                    visibilityRadius: 7,
                    parentId: null,
                },
                ...(Array.isArray(parsed.beacons)
                    ? parsed.beacons.map((beacon) => ({
                        id: `entity-${beacon.id}`,
                        kind: 'beacon' as const,
                        mobility: 'static' as const,
                        x: beacon.x,
                        y: beacon.y,
                        visibilityRadius: 4,
                        parentId: beacon.parentId ? `entity-${beacon.parentId}` : 'entity-base',
                    }))
                    : []),
            ];

            return {
                version: 3,
                seed: parsed.seed,
                width: Number.isFinite(parsed.width) ? parsed.width : 256,
                height: Number.isFinite(parsed.height) ? parsed.height : 256,
                savedTiles: parsed.savedTiles,
                entities: convertedEntities,
            };
        }

        if (parsed.version === 3) {
            return {
                version: 3,
                seed: parsed.seed,
                width: Number.isFinite(parsed.width) ? parsed.width : 256,
                height: Number.isFinite(parsed.height) ? parsed.height : 256,
                savedTiles: parsed.savedTiles,
                entities: Array.isArray(parsed.entities) ? parsed.entities : [],
            };
        }

        return null;
    } catch {
        return null;
    }
}

export function saveSnapshot(snapshot: WorldSnapshot): void {
    const tryWrite = (candidate: WorldSnapshot): boolean => {
        try {
            localStorage.setItem(SAVE_KEY, JSON.stringify(candidate));
            return true;
        } catch (error) {
            if (!isQuotaExceededError(error)) {
                throw error;
            }
            return false;
        }
    };

    if (tryWrite(snapshot)) return;

    const structuralSnapshot = compactSnapshotForStorage(snapshot, 'structural');
    if (tryWrite(structuralSnapshot)) {
        warnQuotaFallback('Saved compact structural snapshot (visibility-only progress omitted).');
        return;
    }

    const minedOnlySnapshot = compactSnapshotForStorage(snapshot, 'mined-only');
    if (tryWrite(minedOnlySnapshot)) {
        warnQuotaFallback('Saved mined-only snapshot (exploration visibility omitted).');
        return;
    }

    warnQuotaFallback('Autosave skipped: local storage quota exceeded.');
}

function isQuotaExceededError(error: unknown): boolean {
    if (!(error instanceof DOMException)) return false;
    return error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED' || error.code === 22;
}

function warnQuotaFallback(message: string): void {
    if (quotaWarningShown) return;
    quotaWarningShown = true;
    console.warn(`[Storage] ${message}`);
}

function compactSnapshotForStorage(snapshot: WorldSnapshot, mode: 'structural' | 'mined-only'): WorldSnapshot {
    const savedTiles = mode === 'mined-only'
        ? snapshot.savedTiles.filter((saved) => !saved.solid || saved.hp <= 0)
        : snapshot.savedTiles;

    return {
        ...snapshot,
        savedTiles,
        entities: snapshot.entities,
    };
}

export function createWorldAutosave(world: GameSimulation['world']): {
    schedule: (delayMs?: number) => void;
    flush: () => void;
} {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        saveSnapshot(world.toSnapshot());
    };

    const schedule = (delayMs = 140) => {
        if (timer) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => {
            timer = null;
            saveSnapshot(world.toSnapshot());
        }, delayMs);
    };

    return { schedule, flush };
}

export function getDropDefinitionIdForBiome(biome: number): string {
    if (biome === 2) return 'debug-ice-shard';
    if (biome === 5) return 'debug-scrap';
    if (biome === 3 || biome === 4) return 'debug-battery';
    return 'debug-asteroid-ore';
}
