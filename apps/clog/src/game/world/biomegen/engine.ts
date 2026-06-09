import type { BiomeGenerationGraph, BiomeGenerationNode, BiomeGenerationSample, NoiseSourceId } from './types';

type NoiseSampler = (source: NoiseSourceId, x: number, y: number, seed: number) => number;

function nodeMatches(node: BiomeGenerationNode, biome: number, sample: number): boolean {
    const biomeOk = node.from === '*' || node.from.includes(biome as never);
    if (!biomeOk) return false;
    return sample >= node.min && sample <= node.max;
}

export function evaluateBiomeGraph(
    graph: BiomeGenerationGraph,
    x: number,
    y: number,
    worldSeed: number,
    sampleNoise: NoiseSampler,
): BiomeGenerationSample {
    const ordered = graph.nodes.slice().sort((a, b) => a.priority - b.priority);
    let biome = graph.baseBiome;
    let crystalType: string | undefined;
    const appliedNodeIds: string[] = [];

    for (const node of ordered) {
        const sample = sampleNoise(node.noise, x, y, worldSeed);
        if (!nodeMatches(node, biome, sample)) continue;

        biome = node.to;
        appliedNodeIds.push(node.id);
        if (node.metadata?.crystalType) {
            crystalType = node.metadata.crystalType;
        }
    }

    return {
        biome,
        appliedNodeIds,
        crystalType,
    };
}

export function toMermaidGraph(graph: BiomeGenerationGraph): string {
    const lines: string[] = ['graph TD'];
    lines.push(`  base["Base: ${graph.baseBiome}"]`);

    for (const node of graph.nodes.slice().sort((a, b) => a.priority - b.priority)) {
        const nodeId = node.id.replace(/[^A-Za-z0-9_]/g, '_');
        lines.push(`  ${nodeId}["${node.label}\\n${node.noise} in [${node.min.toFixed(2)}, ${node.max.toFixed(2)}]"]`);

        if (node.from === '*') {
            lines.push(`  base --> ${nodeId}`);
        } else {
            for (const from of node.from) {
                lines.push(`  b${from}["Biome ${from}"] --> ${nodeId}`);
            }
        }

        lines.push(`  ${nodeId} --> b${node.to}["Biome ${node.to}"]`);
    }

    return lines.join('\n');
}
