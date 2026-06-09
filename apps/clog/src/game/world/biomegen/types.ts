import type { BiomeId } from '../../types';

export type NoiseSourceId =
    | 'continental'
    | 'heat'
    | 'cave'
    | 'lava'
    | 'crystal'
    | 'erosion';

export type NoiseSourceConfig = {
    scale: number;
    octaves: number;
    persistence: number;
    lacunarity: number;
    warp: number;
};

export type BiomeGenerationNode = {
    id: string;
    label: string;
    from: BiomeId[] | '*';
    to: BiomeId;
    noise: NoiseSourceId;
    min: number;
    max: number;
    priority: number;
    metadata?: {
        crystalType?: string;
    };
};

export type BiomeGenerationGraph = {
    id: string;
    name: string;
    baseBiome: BiomeId;
    noiseSources: Record<NoiseSourceId, NoiseSourceConfig>;
    nodes: BiomeGenerationNode[];
};

export type BiomeGenerationSample = {
    biome: BiomeId;
    appliedNodeIds: string[];
    crystalType?: string;
};
