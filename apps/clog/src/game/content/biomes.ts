import type { BiomeDefinition, BiomeId } from '../types';

export const BIOME_DEFINITIONS: Record<BiomeId, BiomeDefinition> = {
    0: { name: 'Asteroid', fill: 0x34313a, edge: 0x80798c, glow: 0x56515f, revealRadius: 2, defaultHp: 25, oreYield: [25, 35] },
    1: { name: 'Crystal', fill: 0x3a2469, edge: 0xb78cff, glow: 0x7459d9, revealRadius: 5, defaultHp: 7, oreYield: [28, 38] },
    2: { name: 'Ice', fill: 0x1f4e68, edge: 0x9be9ff, glow: 0x4bb7d8, revealRadius: 4, defaultHp: 23, oreYield: [20, 30] },
    3: { name: 'Biomass', fill: 0x183f2b, edge: 0x79f2a6, glow: 0x3dbf65, revealRadius: 1, defaultHp: 7, oreYield: [22, 32] },
    4: { name: 'Lava', fill: 0x4a1b16, edge: 0xff7a3d, glow: 0xc44927, revealRadius: 3, defaultHp: 7, oreYield: [25, 35] },
    5: { name: 'Ruins', fill: 0x43322c, edge: 0xd08b49, glow: 0x9f7652, revealRadius: 2, defaultHp: 7, oreYield: [25, 35] },
    6: { name: 'Cave', fill: 0x222531, edge: 0x6f7a93, glow: 0x3d4a63, revealRadius: 2, defaultHp: 19, oreYield: [25, 35] },
    7: { name: 'Crystal Cave', fill: 0x2d2a55, edge: 0xcbc2ff, glow: 0x8c7dff, revealRadius: 4, defaultHp: 13, oreYield: [30, 40] },
    8: { name: 'Danger', fill: 0x3f171d, edge: 0xff5c6c, glow: 0xb7283c, revealRadius: 2, defaultHp: 9, oreYield: [25, 35] },
};
