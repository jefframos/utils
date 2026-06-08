# Asteroid Valley Project Brief

Build a browser-based top-down mining/survival game prototype using PixiJS 8, Vite, and TypeScript.

## End goal

The final game is a web-based .io-style asteroid valley survival game. Players start inside a small base cave surrounded by pitch-black fog. They click tiles to mine outward into asteroid terrain. The map contains many asteroid masses with hidden biomes. Players do not initially know what biome they will discover; they only see revealed edges, glowing hints, and nearby terrain.

The game should work fully as single-player first. Multiplayer can be added later using Colyseus, but the architecture should already support command/event style logic so the simulation can eventually move to an authoritative server.

## Core gameplay

- Player starts with a base in a small cleared area.
- The world is mostly black/unexplored.
- Player clicks solid tiles to damage/break them.
- Broken tiles become open cave/path.
- Mining reveals nearby tiles and biome edges.
- Different biomes reveal differently.
- Resources are gained by breaking biome tiles.
- Opening tunnels creates paths enemies can later use to invade the base.
- Player will eventually build defenses using collected resources.
- Other players are visible only when tunnel/path connectivity reaches their base.
- PvE only: players can see each other but cannot attack each other.

## Visual goal

The game should not look like isolated square blocks. It should look like merged asteroid terrain.

Use:
- 8-neighbour autotiling
- 47-tile/blob-style edge logic
- biome outlines
- fog-of-war edges
- chunk rendering
- zoom-based level of detail

At close zoom:
- show detailed tiles
- visible edges and corners
- biome colors/textures
- base and mined tunnel shapes

At far zoom:
- do not render every tile
- show each biome or chunk as a flat square/pixel
- make the world feel huge

## Biomes

Implement placeholder biomes first:

- Asteroid / rock: gray, low reveal
- Crystal: purple/blue, reveals more due to glow
- Ice: cyan/white, medium reveal
- Lava: red/orange, reveals through cracks
- Biomass / alien: green, low/uncertain reveal
- Ruins / tech: orange/metallic, geometric hints

## Technical architecture

Use TypeScript modules and command/event architecture. Future-ready for Colyseus.

## World generation

- Tile size: 16 px
- Chunk size: 64 x 64 tiles
- Chunked procedural generation from a seed
- Store only modified tiles long-term

## Rendering

- PixiJS 8
- Chunk-based rendering
- Dirty chunk redraws
- 8-neighbour bitmasking
- Fog of war layer
- Multiple zoom LODs
- No sprite per tile world rendering

## Fog of war

Visibility states:
- Unknown
- EdgeHint
- Revealed
- Open

Different biomes reveal different distances.

## Camera

- Mouse wheel zoom
- Drag pan
- Fast zoom out
- LOD transitions

## Multiplayer-ready

Use an abstraction:

```ts
interface GameTransport {
  send(command: GameCommand): void;
  onEvent(callback: (event: GameEvent) => void): void;
}
```

Implement LocalTransport first. Colyseus later.

## MVP Checklist

1. PixiJS 8 app starts.
2. Procedural chunked asteroid map.
3. Base cave in center.
4. Mostly black unexplored world.
5. Pan and zoom.
6. Click-to-mine.
7. Tile destruction.
8. Reveal nearby terrain.
9. Biome hints and colors.
10. Dirty chunk rendering.
11. LOD zoom system.

## Performance Rules

- Only render visible chunks.
- Cache chunk textures.
- Redraw dirty chunks only.
- Pool dynamic objects.
- Separate terrain, fog, entities and UI.
- Far zoom uses chunk summaries, not tiles.

## Long-term Systems

- Enemy nests
- Turrets and defenses
- Resource economy
- Connected region graph
- Visibility between players
- IndexedDB saves
- Colyseus multiplayer
