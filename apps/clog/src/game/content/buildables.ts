export type BuildableEntityType = 'beacon' | 'outpost';

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
    outpost: {
        id: 'outpost',
        name: 'Outpost',
        description: 'A remote operations hub. Smaller than your main base, can spawn and host up to 4 workers.',
        cost: 20,
        icon: '🏗️',
    },
};

export function getBuildableCategory(entityType: BuildableEntityType): string {
    if (entityType === 'beacon') return 'Structures';
    if (entityType === 'outpost') return 'Bases';
    return 'Other';
}

export const BUILDABLE_CATEGORIES = ['Structures', 'Bases'];

export function getBuildablesForCategory(category: string): BuildableEntityType[] {
    if (category === 'Structures') {
        return ['beacon'];
    }
    if (category === 'Bases') {
        return ['outpost'];
    }
    return [];
}
