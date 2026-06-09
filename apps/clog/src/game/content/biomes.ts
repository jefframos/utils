import type { BiomeDefinition, BiomeId } from '../types';

export const BIOME_DEFINITIONS: Record<BiomeId, BiomeDefinition> = {
    0: { name: 'Asteroid', fill: 0x34313a, edge: 0x80798c, glow: 0x56515f, revealRadius: 2, defaultHp: 10 },
    1: { name: 'Crystal', fill: 0x3a2469, edge: 0xb78cff, glow: 0x7459d9, revealRadius: 5, defaultHp: 2 },
    2: { name: 'Ice', fill: 0x1f4e68, edge: 0x9be9ff, glow: 0x4bb7d8, revealRadius: 4, defaultHp: 18 },
    3: { name: 'Biomass', fill: 0x183f2b, edge: 0x79f2a6, glow: 0x3dbf65, revealRadius: 1, defaultHp: 2 },
    4: { name: 'Lava', fill: 0x4a1b16, edge: 0xff7a3d, glow: 0xc44927, revealRadius: 3, defaultHp: 2 },
    5: { name: 'Ruins', fill: 0x43322c, edge: 0xd08b49, glow: 0x9f7652, revealRadius: 2, defaultHp: 2 },
};
