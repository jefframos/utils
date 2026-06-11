export type BuildableEntityType = 'beacon';

export type BuildableEntityDef = {
    id: BuildableEntityType;
    name: string;
    description: string;
    cost: number; // ore cost
    icon: string; // SVG/Unicode icon
};

export const BUILDABLE_ENTITIES: Record<BuildableEntityType, BuildableEntityDef> = {
    beacon: {
        id: 'beacon',
        name: 'Beacon',
        description: 'A structure that extends your mining range and network. Beacons link together to form a connected network.',
        cost: 10,
        icon: '🔴',
    },
};

export function getBuildableCategory(entityType: BuildableEntityType): string {
    if (entityType === 'beacon') return 'Structures';
    return 'Other';
}

export const BUILDABLE_CATEGORIES = ['Structures'];

export function getBuildablesForCategory(category: string): BuildableEntityType[] {
    if (category === 'Structures') {
        return ['beacon'];
    }
    return [];
}
