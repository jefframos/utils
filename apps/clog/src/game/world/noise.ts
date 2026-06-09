import type { BiomeId } from '../types';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../config';
import { DEFAULT_BIOME_GRAPH } from './biomegen/defaultGraph';
import { evaluateBiomeGraph, toMermaidGraph } from './biomegen/engine';
import type { BiomeGenerationSample, NoiseSourceId } from './biomegen/types';

export type SpaceAreaType = 'safe' | 'frontier' | 'danger';

const NOISE_SOURCE_SALTS: Record<NoiseSourceId, number> = {
    continental: 137,
    heat: 521,
    cave: 997,
    lava: 1879,
    crystal: 3541,
    erosion: 6163,
};

function hashNoise(x: number, y: number, seed: number): number {
    let n = x * 374761393 + y * 668265263 + seed * 1442695041;
    n = (n ^ (n >> 13)) * 1274126177;
    return ((n ^ (n >> 16)) >>> 0) / 4294967295;
}

function sampleBand(x: number, y: number, scale: number, seed: number): number {
    return hashNoise(Math.floor(x / scale), Math.floor(y / scale), seed);
}

function smoothstep(min: number, max: number, value: number): number {
    if (value <= min) return 0;
    if (value >= max) return 1;
    const t = (value - min) / (max - min);
    return t * t * (3 - 2 * t);
}

function rotatePoint(x: number, y: number, angle: number): { x: number; y: number } {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
        x: x * cos - y * sin,
        y: x * sin + y * cos,
    };
}

function sampleAreaHubInfluence(
    x: number,
    y: number,
    worldSeed: number,
    kind: 'safe' | 'danger',
): number {
    const count = kind === 'safe' ? 5 : 4;
    let best = 0;

    for (let index = 0; index < count; index++) {
        let centerX: number;
        let centerY: number;
        let radiusX: number;
        let radiusY: number;

        if (kind === 'safe' && index === 0) {
            centerX = WORLD_WIDTH * 0.5;
            centerY = WORLD_HEIGHT * 0.5;
            radiusX = 34;
            radiusY = 28;
        } else {
            const baseSeed = worldSeed + (kind === 'safe' ? 5101 : 9103) + index * 977;
            const safeCenters = [
                [0.19, 0.22],
                [0.81, 0.22],
                [0.19, 0.8],
                [0.81, 0.8],
            ] as const;
            const dangerCenters = [
                [0.5, 0.16],
                [0.84, 0.5],
                [0.5, 0.84],
                [0.16, 0.5],
            ] as const;
            const [baseX, baseY] = kind === 'safe' ? safeCenters[index - 1] : dangerCenters[index];
            const jitterX = (hashNoise(index * 13 + 7, index * 17 - 11, baseSeed) - 0.5) * (kind === 'safe' ? 18 : 14);
            const jitterY = (hashNoise(index * 19 - 5, index * 23 + 3, baseSeed + 19) - 0.5) * (kind === 'safe' ? 18 : 14);
            centerX = baseX * WORLD_WIDTH + jitterX;
            centerY = baseY * WORLD_HEIGHT + jitterY;
            radiusX = (kind === 'safe' ? 28 : 30) + hashNoise(index * 29 + 11, index * 31 - 13, baseSeed + 47) * (kind === 'safe' ? 10 : 10);
            radiusY = (kind === 'safe' ? 24 : 24) + hashNoise(index * 37 - 17, index * 41 + 5, baseSeed + 61) * (kind === 'safe' ? 8 : 10);
        }

        const dx = (x - centerX) / radiusX;
        const dy = (y - centerY) / radiusY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const edgeSoftness = kind === 'safe' ? 1.28 : 1.16;
        const influence = 1 - smoothstep(0.78, edgeSoftness, distance);
        if (influence > best) best = influence;
    }

    return Math.max(0, Math.min(1, best));
}

export function sampleSafeAreaStrength(x: number, y: number, worldSeed: number): number {
    return sampleAreaHubInfluence(x, y, worldSeed, 'safe');
}

export function sampleDangerAreaStrength(x: number, y: number, worldSeed: number): number {
    return sampleAreaHubInfluence(x, y, worldSeed, 'danger');
}

export function getSpaceAreaTypeAtPosition(x: number, y: number, worldSeed: number): SpaceAreaType {
    const safe = sampleSafeAreaStrength(x, y, worldSeed);
    const danger = sampleDangerAreaStrength(x, y, worldSeed);

    if (safe >= 0.31 && safe >= danger + 0.08) return 'safe';
    if (danger >= 0.28 && danger >= safe + 0.02) return 'danger';
    return 'frontier';
}

function sampleAsteroidBlobField(x: number, y: number, worldSeed: number): number {
    const cellSize = 32;
    const cellX = Math.floor(x / cellSize);
    const cellY = Math.floor(y / cellSize);
    let influence = 0;

    for (let oy = -2; oy <= 2; oy++) {
        for (let ox = -2; ox <= 2; ox++) {
            const gx = cellX + ox;
            const gy = cellY + oy;
            const cellHash = hashNoise(gx, gy, worldSeed + 4103);
            const asteroidCount = cellHash > 0.74 ? 2 : cellHash > 0.28 ? 1 : 0;

            for (let index = 0; index < asteroidCount; index++) {
                const offsetSeed = worldSeed + gx * 92821 + gy * 68917 + index * 7919;
                const centerX = (gx + hashNoise(gx * 3 + index, gy * 5 - index, offsetSeed + 17)) * cellSize;
                const centerY = (gy + hashNoise(gx * 7 - index, gy * 11 + index, offsetSeed + 31)) * cellSize;
                const radiusScale = cellHash > 0.88 ? 1.45 : cellHash > 0.68 ? 1.18 : 1;
                const radiusX = (11 + hashNoise(gx * 13 + index, gy * 17 - index, offsetSeed + 47) * 19) * radiusScale;
                const radiusY = (8 + hashNoise(gx * 19 - index, gy * 23 + index, offsetSeed + 61) * 15) * radiusScale;
                const angle = hashNoise(gx * 29 + index, gy * 31 - index, offsetSeed + 79) * Math.PI;
                const beanOffset = 4 + hashNoise(gx * 37 + index, gy * 41 - index, offsetSeed + 97) * 7;

                const local = rotatePoint(x - centerX, y - centerY, -angle);
                const lobeA = 1 - ((local.x + beanOffset) * (local.x + beanOffset)) / (radiusX * radiusX)
                    - (local.y * local.y) / (radiusY * radiusY);
                const lobeB = 1 - ((local.x - beanOffset * 0.7) * (local.x - beanOffset * 0.7)) / ((radiusX * 0.88) * (radiusX * 0.88))
                    - ((local.y + beanOffset * 0.18) * (local.y + beanOffset * 0.18)) / ((radiusY * 1.1) * (radiusY * 1.1));

                const beanInfluence = Math.max(lobeA, lobeB);
                if (beanInfluence > influence) {
                    influence = beanInfluence;
                }
            }
        }
    }

    return Math.max(0, influence);
}

function sampleAsteroidSeparationField(x: number, y: number, worldSeed: number): number {
    const warpA = hashNoise(Math.floor((x + 43) / 23), Math.floor((y - 71) / 23), worldSeed + 1609) - 0.5;
    const warpB = hashNoise(Math.floor((x - 109) / 31), Math.floor((y + 59) / 31), worldSeed + 3187) - 0.5;
    const wx = x + warpA * 20 + warpB * 8;
    const wy = y + warpB * 20 - warpA * 8;

    const centerX = WORLD_WIDTH * 0.5;
    const centerY = WORLD_HEIGHT * 0.5;
    const dx = wx - centerX;
    const dy = wy - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);
    const bandRadius = 82
        + Math.sin(angle * 2.7 + worldSeed * 0.013) * 18
        + Math.sin(angle * 5.2 - worldSeed * 0.021) * 9;
    const riverWidth = 8 + sampleBand(wx + 307, wy - 263, 52, worldSeed + 17011) * 6;
    const riverStrength = 1 - smoothstep(riverWidth, riverWidth + 6, Math.abs(distance - bandRadius));

    const laneA = sampleBand(wx + 401, wy - 347, 58, worldSeed + 22073);
    const laneB = sampleBand(wx * 0.87 - 311, wy * 0.87 + 131, 34, worldSeed + 26029);
    const laneStrength = Math.max(0, laneA * 0.62 + laneB * 0.38 - 0.62) * 1.6;

    return Math.max(riverStrength * 0.92, laneStrength * 0.65);
}

function biomeSourceNoise(x: number, y: number, worldSeed: number, source: NoiseSourceId): number {
    const config = DEFAULT_BIOME_GRAPH.noiseSources[source];
    const sourceSalt = NOISE_SOURCE_SALTS[source];
    const warpA = hashNoise(Math.floor((x + sourceSalt * 3) / 29), Math.floor((y - sourceSalt * 5) / 29), worldSeed + sourceSalt * 7) - 0.5;
    const warpB = hashNoise(Math.floor((x - sourceSalt * 11) / 37), Math.floor((y + sourceSalt * 13) / 37), worldSeed + sourceSalt * 13) - 0.5;

    const wx = x + warpA * config.warp * 6 + warpB * config.warp * 3;
    const wy = y + warpB * config.warp * 6 - warpA * config.warp * 3;

    const coarse = sampleBand(wx + sourceSalt * 17, wy - sourceSalt * 19, config.scale, worldSeed + sourceSalt * 101);
    const medium = sampleBand(wx * 1.9 - sourceSalt * 7, wy * 1.9 + sourceSalt * 5, Math.max(6, config.scale * 0.52), worldSeed + sourceSalt * 211);
    const fine = sampleBand(wx * 3.1 + sourceSalt * 23, wy * 3.1 - sourceSalt * 29, Math.max(4, config.scale * 0.28), worldSeed + sourceSalt * 307);

    const ridge = 1 - Math.abs(medium * 2 - 1);
    const mixed = coarse * 0.48 + ridge * 0.32 + fine * 0.2;
    return Math.max(0, Math.min(1, (mixed - 0.5) * 1.85 + 0.5));
}

function sampleBiomeNoise(source: NoiseSourceId, x: number, y: number, worldSeed: number): number {
    return biomeSourceNoise(x, y, worldSeed, source);
}

export function sampleBiomeAtPosition(x: number, y: number, worldSeed: number): BiomeGenerationSample {
    return evaluateBiomeGraph(DEFAULT_BIOME_GRAPH, x, y, worldSeed, sampleBiomeNoise);
}

export function chooseBiomeForPosition(x: number, y: number, worldSeed: number): BiomeId {
    return sampleBiomeAtPosition(x, y, worldSeed).biome;
}

export function surfaceNoise(x: number, y: number, worldSeed: number): number {
    return hashNoise(x, y, worldSeed + 9 * 313);
}

export function asteroidVoidLikelihood(x: number, y: number, worldSeed: number): number {
    const asteroidField = sampleAsteroidBlobField(x, y, worldSeed);
    const separation = sampleAsteroidSeparationField(x, y, worldSeed);
    const edgeNoise = sampleBand(x * 2.7 + 43, y * 2.7 - 17, 8, worldSeed + 31183);
    const sparseBias = Math.pow(Math.max(0, 1 - asteroidField * 0.92 - edgeNoise * 0.08), 1.8);
    const likelihood = 0.04 + sparseBias * 0.48 + separation * 0.52;
    return Math.max(0, Math.min(1, likelihood));
}

export function shouldGenerateAsteroidGap(x: number, y: number, worldSeed: number): boolean {
    const likelihood = asteroidVoidLikelihood(x, y, worldSeed);
    const selector = hashNoise(x * 5 + 11, y * 5 - 7, worldSeed + 13007);
    return selector < likelihood;
}

export function shouldGenerateAsteroidBody(x: number, y: number, worldSeed: number): boolean {
    const asteroidField = sampleAsteroidBlobField(x, y, worldSeed);
    const separation = sampleAsteroidSeparationField(x, y, worldSeed);
    const fineContour = sampleBand(x * 2.9 - 11, y * 2.9 + 19, 7, worldSeed + 36263);
    const safeStrength = sampleSafeAreaStrength(x, y, worldSeed);
    const dangerStrength = sampleDangerAreaStrength(x, y, worldSeed);
    const zoneStrength = Math.max(safeStrength, dangerStrength);
    if (zoneStrength < 0.08) {
        // Keep frontier asteroids sparse and isolated between the main safe/danger fields.
        return asteroidField > 0.9 && separation < 0.28 && fineContour > 0.44;
    }

    if (zoneStrength < 0.16) {
        return asteroidField > 0.84 && separation < 0.3 && fineContour > 0.4;
    }

    const frontierPenalty = (1 - zoneStrength) * 0.14;
    const bodyScore = asteroidField * 0.95
        - separation * 1.01
        + fineContour * 0.05
        + safeStrength * 0.4
        + dangerStrength * 0.48
        - frontierPenalty;
    const threshold = zoneStrength > 0.42 ? 0.17 : zoneStrength > 0.22 ? 0.22 : 0.29;
    return bodyScore > threshold;
}

export function spaceDustStrength(x: number, y: number, worldSeed: number): number {
    const base = sampleBand(x + 17, y - 31, 10, worldSeed + 39041);
    const cloud = sampleBand(x + 73, y - 101, 22, worldSeed + 40009);
    return Math.max(0, Math.min(1, base * 0.58 + cloud * 0.42));
}

export function getBiomeGenerationNodeGraphMermaid(): string {
    return toMermaidGraph(DEFAULT_BIOME_GRAPH);
}
