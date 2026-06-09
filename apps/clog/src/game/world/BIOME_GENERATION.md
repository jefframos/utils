# Biome Generation (Node Graph)

Biome generation is driven by a modular graph:

- `src/game/world/biomegen/types.ts`
- `src/game/world/biomegen/defaultGraph.ts`
- `src/game/world/biomegen/engine.ts`

## How to Extend

1. Add a new biome id in `src/game/types.ts`.
2. Add visual stats in `src/game/content/biomes.ts`.
3. Add a generation node in `src/game/world/biomegen/defaultGraph.ts`.

Each node can chain from prior nodes using `from` and `priority`, enabling rules-on-rules such as:

- Asteroid -> Lava
- Lava -> Cave
- Cave -> Crystal Cave (with crystal type metadata)

## Crystal Types

Set `metadata.crystalType` on a node. This metadata is emitted by `sampleBiomeAtPosition` for gameplay systems to consume.

## Visualizing Nodes

Use:

- `getBiomeGenerationNodeGraphMermaid()` from `src/game/world/noise.ts`

The function returns a Mermaid graph string that can be pasted into a Mermaid viewer.
