/**
 * Entity definitions: the single source of truth for each entity type's
 * visual presentation and physical footprint in the world.
 *
 * Adding a new entity type requires:
 *   1. Add a new entry to ENTITY_DEFINITIONS below.
 *   2. The sizeDef controls how the entity occupies tiles and how pathfinding
 *      routes around it.  A 2×2 entity needs 4 adjacent open tiles to stand on.
 *   3. The viewDef controls how the entity renders — colour, icon text (emoji or
 *      ASCII), and a future-proof `sprite` slot for image/spritesheet references.
 */

export type EntitySizeDef = {
    /** Width in tiles (horizontal footprint). */
    tilesX: number;
    /** Height in tiles (vertical footprint). */
    tilesY: number;
};

export type EntityViewDef = {
    /** Primary tint colour used for the entity's representation (hex). */
    color: string;
    /** Icon — emoji, ASCII glyph, or a short label shown in the minimap / UI. */
    icon: string;
    /**
     * Future-proof sprite reference.  Set to null until a spritesheet is wired up.
     * When you have sprites, put the sheet id + frame here.
     */
    sprite: { sheet: string; frame: number } | null;
};

export type EntityDefinition = {
    kind: string;
    /** Exact unit-type id for worker variants; null for non-workers. */
    unitType: string | null;
    name: string;
    sizeDef: EntitySizeDef;
    viewDef: EntityViewDef;
};

// ---------------------------------------------------------------------------
// Static registry
// ---------------------------------------------------------------------------

const DEFINITIONS: EntityDefinition[] = [
    {
        kind: 'base',
        unitType: null,
        name: 'Space Station',
        sizeDef: { tilesX: 3, tilesY: 3 },
        viewDef: { color: '#94a3b8', icon: '🏛️', sprite: null },
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

/**
 * Look up the definition for a given entity kind + unitType combination.
 * Falls back to a safe 1×1 generic definition if no match is found.
 */
export function getEntityDefinition(kind: string, unitType?: string | null): EntityDefinition {
    // For worker kinds, prefer an exact unitType match; then fall back to any worker entry.
    const exactMatch = DEFINITIONS.find(
        (d) => d.kind === kind && d.unitType === (unitType ?? null),
    );
    if (exactMatch) return exactMatch;

    // Fallback: match by kind only (for non-worker types where unitType is null)
    const kindMatch = DEFINITIONS.find((d) => d.kind === kind && d.unitType === null);
    if (kindMatch) return kindMatch;

    return {
        kind,
        unitType: unitType ?? null,
        name: kind,
        sizeDef: { tilesX: 1, tilesY: 1 },
        viewDef: { color: '#ffffff', icon: '?', sprite: null },
    };
}

/**
 * Convenience: short human-readable label for a spawned unit event
 * without needing any `if` chains at call sites.
 */
export function getEntityLabel(kind: string, unitType?: string | null): string {
    return getEntityDefinition(kind, unitType).name;
}

/**
 * Convenience: one-line summary sentence for the entity details panel.
 */
export function getEntitySummary(kind: string, unitType?: string | null): string {
    const def = getEntityDefinition(kind, unitType);
    switch (kind) {
        case 'base': return 'Main operations hub. Spawn and manage workers attached to this station.';
        case 'beacon': return 'Remote visibility anchor. Remove it to reclaim part of the build cost.';
        case 'player': return 'Main hero unit. Holds primary tools and inventory for this run.';
        case 'worker': return `${def.name}. Can be deployed in the field or recalled to home base.`;
        default: return def.name;
    }
}
