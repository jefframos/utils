import { BIOME_DEFINITIONS } from './biomes';
import type { BiomeId, Tile } from '../types';

export function createSolidTile(biome: BiomeId): Tile {
    return {
        solid: true,
        biome,
        hp: BIOME_DEFINITIONS[biome].defaultHp,
        visibility: 'Unknown',
    };
}

export function carveOpen(tile: Tile): void {
    tile.solid = false;
    tile.visibility = 'Open';
    tile.hp = 0;
}

export function damageTile(tile: Tile, amount: number): boolean {
    if (!tile.solid) return false;
    tile.hp = Math.max(0, tile.hp - amount);
    return tile.hp === 0;
}
