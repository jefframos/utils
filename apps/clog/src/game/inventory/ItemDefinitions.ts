import { WEAPON_DEFINITIONS } from '../core/ToolComponent';

export type InventoryItemType = 'tool' | 'resource';

export type InventoryCell = {
    x: number;
    y: number;
};

export type InventoryShape = {
    width: number;
    height: number;
    cells: InventoryCell[];
};

export type InventoryItemView = {
    iconSvg: string;
    tint: string;
    backdrop: string;
};

export type InventoryItemAttributes = Record<string, string | number | boolean>;

export type InventoryItemDefinition = {
    id: string;
    name: string;
    itemType: InventoryItemType;
    shape: InventoryShape;
    view: InventoryItemView;
    attributes: InventoryItemAttributes;
    toolId?: string;
};

export type InventorySection = 'storage' | 'hotbar';

export type InventoryLocation = {
    inventoryId?: string;
    section: InventorySection;
    x: number;
    y: number;
};

export type InventoryItemInstance = {
    id: string;
    definitionId: string;
    quantity: number;
    durability: number;
    location: InventoryLocation;
};

export const INVENTORY_LAYOUT = {
    storageColumns: 10,
    storageRows: 4,
    hotbarColumns: 10,
    hotbarRows: 2,
} as const;

function createLShape(direction: 'left' | 'right'): InventoryShape {
    return direction === 'left'
        ? {
            width: 2,
            height: 2,
            cells: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
        }
        : {
            width: 2,
            height: 2,
            cells: [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
        };
}

function createSingleCellShape(): InventoryShape {
    return {
        width: 1,
        height: 1,
        cells: [{ x: 0, y: 0 }],
    };
}

function toolAttributes(toolId: string): InventoryItemAttributes {
    const weapon = WEAPON_DEFINITIONS.find((entry) => entry.id === toolId);
    if (!weapon) {
        return {};
    }

    return {
        durability: weapon.damageMode === 'blunt' ? 140 : 100,
        tileDamage: weapon.tileDamage,
        damageMode: weapon.damageMode,
        bluntRadius: weapon.bluntRadius,
        hitsPerSecond: weapon.hitsPerSecond,
        hitOnClick: weapon.hitOnClick,
        hitOnHold: weapon.hitOnHold,
    };
}

function makeToolIcon(kind: 'cutter' | 'mallet'): string {
    if (kind === 'cutter') {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18h8l5-12h-8L4 18Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 6l3-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    }

    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="4" width="9" height="6" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 10l-6 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M5 19l2-2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
}

function makeResourceIcon(kind: 'ore' | 'ice' | 'scrap' | 'battery'): string {
    if (kind === 'ore') {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 16l2-8 5-3 6 3 1 6-5 5H8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    }
    if (kind === 'ice') {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M5 7l14 10M5 17L19 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    }
    if (kind === 'scrap') {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-2 11H7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 8l1-3h6l1 3" stroke="currentColor" stroke-width="1.8"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="3" width="10" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 7h4M10 11h4M10 15h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
}

export const INVENTORY_ITEM_DEFINITIONS: InventoryItemDefinition[] = [
    {
        id: 'starter-cutter',
        name: 'Starter Cutter',
        itemType: 'tool',
        shape: createLShape('left'),
        view: {
            iconSvg: makeToolIcon('cutter'),
            tint: '#f8fafc',
            backdrop: '#3b4d5d',
        },
        attributes: {
            ...toolAttributes('starter-cutter'),
            role: 'main weapon',
        },
        toolId: 'starter-cutter',
    },
    {
        id: 'shock-mallet',
        name: 'Shock Mallet',
        itemType: 'tool',
        shape: createLShape('right'),
        view: {
            iconSvg: makeToolIcon('mallet'),
            tint: '#ffe4b5',
            backdrop: '#5b4450',
        },
        attributes: {
            ...toolAttributes('shock-mallet'),
            role: 'secondary weapon',
        },
        toolId: 'shock-mallet',
    },
    {
        id: 'debug-asteroid-ore',
        name: 'Asteroid Ore',
        itemType: 'resource',
        shape: createSingleCellShape(),
        view: {
            iconSvg: makeResourceIcon('ore'),
            tint: '#f1e8ff',
            backdrop: '#4c4a56',
        },
        attributes: {
            stackSize: 99,
            material: 'asteroid',
            debugOnly: true,
        },
    },
    {
        id: 'debug-ice-shard',
        name: 'Ice Shard',
        itemType: 'resource',
        shape: createSingleCellShape(),
        view: {
            iconSvg: makeResourceIcon('ice'),
            tint: '#ddf8ff',
            backdrop: '#204d63',
        },
        attributes: {
            stackSize: 99,
            material: 'ice',
            debugOnly: true,
        },
    },
    {
        id: 'debug-scrap',
        name: 'Metal Scrap',
        itemType: 'resource',
        shape: createSingleCellShape(),
        view: {
            iconSvg: makeResourceIcon('scrap'),
            tint: '#fff8d7',
            backdrop: '#60543b',
        },
        attributes: {
            stackSize: 99,
            material: 'scrap',
            debugOnly: true,
        },
    },
    {
        id: 'debug-battery',
        name: 'Battery Cell',
        itemType: 'resource',
        shape: createSingleCellShape(),
        view: {
            iconSvg: makeResourceIcon('battery'),
            tint: '#f8fafc',
            backdrop: '#4a6e2d',
        },
        attributes: {
            stackSize: 99,
            material: 'power',
            debugOnly: true,
        },
    },
];

export function getInventoryItemDefinition(id: string): InventoryItemDefinition | undefined {
    return INVENTORY_ITEM_DEFINITIONS.find((entry) => entry.id === id);
}