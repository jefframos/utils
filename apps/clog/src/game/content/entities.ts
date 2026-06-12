/**
 * Entity definitions: the single source of truth for each entity type's
 * visual presentation and physical footprint in the world.
 */

export type EntitySizeDef = {
    tilesX: number;
    tilesY: number;
};

export type EntityViewDef = {
    color: string;
    icon: string;
    sprite: { sheet: string; frame: number } | null;
};

export type EntityDefinition = {
    kind: string;
    unitType: string | null;
    name: string;
    sizeDef: EntitySizeDef;
    viewDef: EntityViewDef;
};

const ENTITY_DEFINITIONS: EntityDefinition[] = [
    {
        kind: 'base',
        unitType: null,
        name: 'Space Station',
        sizeDef: { tilesX: 3, tilesY: 3 },
        viewDef: { color: '#94a3b8', icon: '🏛️', sprite: null },
    },
    {
        kind: 'outpost',
        unitType: null,
        name: 'Outpost',
        sizeDef: { tilesX: 2, tilesY: 2 },
        viewDef: { color: '#a78bfa', icon: '🏗️', sprite: null },
    },
    {
        kind: 'beacon',
        unitType: null,
        name: 'Beacon',
        sizeDef: { tilesX: 1, tilesY: 1 },
        viewDef: { color: '#f87171', icon: '🔴', sprite: null },
    },
    {
        kind: 'player',
        unitType: null,
        name: 'Hero',
        sizeDef: { tilesX: 1, tilesY: 1 },
        viewDef: { color: '#818cf8', icon: '👤', sprite: null },
    },
    {
        kind: 'worker',
        unitType: 'basic-worker',
        name: 'Basic Worker',
        sizeDef: { tilesX: 1, tilesY: 1 },
        viewDef: { color: '#34d399', icon: '🔧', sprite: null },
    },
    {
        kind: 'worker',
        unitType: 'large-worker',
        name: 'Heavy Excavator',
        sizeDef: { tilesX: 2, tilesY: 2 },
        viewDef: { color: '#fb923c', icon: '🚜', sprite: null },
    },
];

export function getEntityDefinition(kind: string, unitType?: string | null): EntityDefinition {
    const exactMatch = ENTITY_DEFINITIONS.find(
        (definition) => definition.kind === kind && definition.unitType === (unitType ?? null),
    );
    if (exactMatch) return exactMatch;

    const kindMatch = ENTITY_DEFINITIONS.find((definition) => definition.kind === kind && definition.unitType === null);
    if (kindMatch) return kindMatch;

    return {
        kind,
        unitType: unitType ?? null,
        name: kind,
        sizeDef: { tilesX: 1, tilesY: 1 },
        viewDef: { color: '#ffffff', icon: '?', sprite: null },
    };
}

export function getEntityLabel(kind: string, unitType?: string | null): string {
    return getEntityDefinition(kind, unitType).name;
}

export function getEntitySummary(kind: string, unitType?: string | null): string {
    const definition = getEntityDefinition(kind, unitType);
    switch (kind) {
        case 'base':
            return 'Main operations hub. Spawn and manage workers attached to this station.';
        case 'outpost':
            return 'Remote operations hub. Smaller than the main base but can host up to 4 workers.';
        case 'beacon':
            return 'Remote visibility anchor. Remove it to reclaim part of the build cost.';
        case 'player':
            return 'Main hero unit. Holds primary tools and inventory for this run.';
        case 'worker':
            return `${definition.name}. Can be deployed in the field or recalled to home base.`;
        default:
            return definition.name;
    }
}