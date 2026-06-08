import type { BiomeId } from '../types';

function hashNoise(x: number, y: number, seed: number): number {
    let n = x * 374761393 + y * 668265263 + seed * 1442695041;
    n = (n ^ (n >> 13)) * 1274126177;
    return ((n ^ (n >> 16)) >>> 0) / 4294967295;
}

function smoothNoise(x: number, y: number, scale: number, seed: number, worldSeed: number): number {
    return hashNoise(Math.floor(x / scale), Math.floor(y / scale), worldSeed + seed * 977);
}

export function chooseBiomeForPosition(x: number, y: number, worldSeed: number): BiomeId {
    const a = smoothNoise(x, y, 24, 1, worldSeed);
    const b = smoothNoise(x + 91, y - 17, 40, 2, worldSeed);
    const c = smoothNoise(x - 7, y + 37, 18, 3, worldSeed);
    const d = smoothNoise(x + 143, y + 67, 28, 4, worldSeed);
    if (a > 0.8) return 1;
    if (b < 0.18) return 2;
    if (c > 0.84) return 4;
    if (d > 0.82) return 5;
    if (a < 0.15 && b > 0.55) return 3;
    return 0;
}

export function surfaceNoise(x: number, y: number, worldSeed: number): number {
    return hashNoise(x, y, worldSeed + 9 * 313);
}
