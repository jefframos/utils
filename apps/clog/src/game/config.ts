export const TILE_SIZE = 16;
export const CHUNK_SIZE = 64;

export const WORLD_WIDTH = 256;
export const WORLD_HEIGHT = 256;

export const BASE_START_X = Math.floor(WORLD_WIDTH / 2);
export const BASE_START_Y = Math.floor(WORLD_HEIGHT / 2);

export const ZOOM_MIN = 0.12;
export const ZOOM_MAX = 3.5;
export const ZOOM_IN_FACTOR = 1.1;
export const ZOOM_OUT_FACTOR = 0.9;

export const LOD_TILE_DETAIL_MIN_ZOOM = 0.35;

export const GAME_COLORS = {
    color1: '#93c5fd',
    color2: '#22d3ee',
    color3: '#f59e0b',
} as const;

export const GAME_RULES = {
    // When false, tile damage behaves like Minecraft: if you stop/retarget, progress resets.
    persistentTileDamage: false,
    transientDamageWindowMs: 420,
} as const;
