export type BiomeId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type VisibilityState = 'Unknown' | 'EdgeHint' | 'Revealed' | 'Open';

export type Tile = {
    solid: boolean;
    biome: BiomeId;
    hp: number;
    visibility: VisibilityState;
};

export type BiomeDefinition = {
    name: string;
    fill: number;
    edge: number;
    glow: number;
    revealRadius: number;
    defaultHp: number;
};
