import { INVENTORY_ITEM_DEFINITIONS, INVENTORY_LAYOUT, type InventoryItemDefinition, type InventoryItemInstance, type InventoryLocation, type InventorySection } from '../ItemDefinitions';

export type InventoryContainer = {
    id: string;
    sections: Record<InventorySection, { columns: number; rows: number }>;
};

export type InventoryState = {
    containers: Record<string, InventoryContainer>;
    items: InventoryItemInstance[];
    equippedToolId: string;
};

const PLAYER_INVENTORY_ID = 'player';

export function createDebugInventoryState(): InventoryState {
    return {
        containers: {
            [PLAYER_INVENTORY_ID]: {
                id: PLAYER_INVENTORY_ID,
                sections: {
                    storage: { columns: INVENTORY_LAYOUT.storageColumns, rows: INVENTORY_LAYOUT.storageRows },
                    hotbar: { columns: INVENTORY_LAYOUT.hotbarColumns, rows: INVENTORY_LAYOUT.hotbarRows },
                },
            },
        },
        items: [
            createItem('starter-cutter', { inventoryId: PLAYER_INVENTORY_ID, section: 'hotbar', x: 0, y: 0 }, 1, 100),
            createItem('shock-mallet', { inventoryId: PLAYER_INVENTORY_ID, section: 'hotbar', x: 2, y: 0 }, 1, 140),
            createItem('debug-asteroid-ore', { inventoryId: PLAYER_INVENTORY_ID, section: 'storage', x: 0, y: 0 }, 24, 1),
            createItem('debug-ice-shard', { inventoryId: PLAYER_INVENTORY_ID, section: 'storage', x: 1, y: 0 }, 18, 1),
            createItem('debug-scrap', { inventoryId: PLAYER_INVENTORY_ID, section: 'storage', x: 2, y: 0 }, 12, 1),
            createItem('debug-battery', { inventoryId: PLAYER_INVENTORY_ID, section: 'storage', x: 3, y: 0 }, 8, 1),
        ],
        equippedToolId: 'starter-cutter',
    };
}

export function getInventoryItemDefinition(id: string): InventoryItemDefinition | undefined {
    return INVENTORY_ITEM_DEFINITIONS.find((entry) => entry.id === id);
}

export function normalizeInventoryId(inventoryId?: string): string {
    return inventoryId && inventoryId.length > 0 ? inventoryId : PLAYER_INVENTORY_ID;
}

export function getSectionSize(state: InventoryState, section: InventorySection, inventoryId?: string): { columns: number; rows: number } {
    const invId = normalizeInventoryId(inventoryId);
    const container = state.containers[invId];
    if (!container) {
        return section === 'hotbar'
            ? { columns: INVENTORY_LAYOUT.hotbarColumns, rows: INVENTORY_LAYOUT.hotbarRows }
            : { columns: INVENTORY_LAYOUT.storageColumns, rows: INVENTORY_LAYOUT.storageRows };
    }
    return container.sections[section];
}

export function moveInventoryItem(state: InventoryState, itemId: string, location: InventoryLocation): boolean {
    const item = state.items.find((entry) => entry.id === itemId);
    if (!item) return false;

    const definition = getInventoryItemDefinition(item.definitionId);
    if (!definition) return false;
    if (!canPlaceAt(state, definition, location, itemId)) return false;

    item.location = { ...location, inventoryId: normalizeInventoryId(location.inventoryId) };
    return true;
}

export function getItemAtCell(state: InventoryState, inventoryId: string, section: InventorySection, x: number, y: number): InventoryItemInstance | undefined {
    const invId = normalizeInventoryId(inventoryId);
    return state.items.find((item) => {
        const definition = getInventoryItemDefinition(item.definitionId);
        if (!definition) return false;
        if (normalizeInventoryId(item.location.inventoryId) !== invId) return false;
        if (item.location.section !== section) return false;
        const offsetX = x - item.location.x;
        const offsetY = y - item.location.y;
        return definition.shape.cells.some((cell) => cell.x === offsetX && cell.y === offsetY);
    });
}

export function canPlaceAt(state: InventoryState, definition: InventoryItemDefinition, location: InventoryLocation, ignoreItemId?: string): boolean {
    return canPlaceAtWithIgnoreSet(state, definition, location, new Set(ignoreItemId ? [ignoreItemId] : []));
}

export function canPlaceAtWithIgnoreSet(
    state: InventoryState,
    definition: InventoryItemDefinition,
    location: InventoryLocation,
    ignoreItemIds: Set<string>,
): boolean {
    const invId = normalizeInventoryId(location.inventoryId);
    const size = getSectionSize(state, location.section, invId);
    if (location.x < 0 || location.y < 0) return false;
    if (location.x + definition.shape.width > size.columns) return false;
    if (location.y + definition.shape.height > size.rows) return false;

    for (const cell of definition.shape.cells) {
        const targetX = location.x + cell.x;
        const targetY = location.y + cell.y;
        const occupying = state.items.find((item) => {
            if (ignoreItemIds.has(item.id)) return false;
            const placedDef = getInventoryItemDefinition(item.definitionId);
            if (!placedDef) return false;
            if (normalizeInventoryId(item.location.inventoryId) !== invId) return false;
            if (item.location.section !== location.section) return false;
            return placedDef.shape.cells.some((occupiedCell) => {
                const occupiedX = item.location.x + occupiedCell.x;
                const occupiedY = item.location.y + occupiedCell.y;
                return occupiedX === targetX && occupiedY === targetY;
            });
        });
        if (occupying) return false;
    }

    return true;
}

export function setEquippedTool(state: InventoryState, toolId: string): void {
    state.equippedToolId = toolId;
}

export function addInventoryItem(
    state: InventoryState,
    definitionId: string,
    quantity: number,
    inventoryId?: string,
): number {
    const definition = getInventoryItemDefinition(definitionId);
    if (!definition || quantity <= 0) return 0;

    const invId = normalizeInventoryId(inventoryId);
    let remaining = Math.floor(quantity);
    const maxStack = getMaxStack(definition);

    if (maxStack > 1) {
        const existingStacks = state.items.filter((item) => {
            return normalizeInventoryId(item.location.inventoryId) === invId && item.definitionId === definitionId;
        });

        for (const stack of existingStacks) {
            if (remaining <= 0) break;
            const capacity = Math.max(0, maxStack - stack.quantity);
            if (capacity <= 0) continue;
            const toAdd = Math.min(capacity, remaining);
            stack.quantity += toAdd;
            remaining -= toAdd;
        }
    }

    while (remaining > 0) {
        const nextAmount = Math.min(remaining, maxStack);
        const location = findFirstPlacement(state, definition, invId);
        if (!location) break;

        state.items.push({
            id: `${definitionId}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
            definitionId,
            quantity: nextAmount,
            durability: getDefaultDurability(definition),
            location,
        });

        remaining -= nextAmount;
    }

    return Math.max(0, Math.floor(quantity) - remaining);
}

function findFirstPlacement(
    state: InventoryState,
    definition: InventoryItemDefinition,
    inventoryId: string,
): InventoryLocation | null {
    const sections: InventorySection[] = ['storage', 'hotbar'];
    for (const section of sections) {
        const size = getSectionSize(state, section, inventoryId);
        for (let y = 0; y <= size.rows - definition.shape.height; y++) {
            for (let x = 0; x <= size.columns - definition.shape.width; x++) {
                const location: InventoryLocation = { inventoryId, section, x, y };
                if (canPlaceAt(state, definition, location)) {
                    return location;
                }
            }
        }
    }
    return null;
}

function getMaxStack(definition: InventoryItemDefinition): number {
    const candidate = definition.attributes.stackSize;
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 1) {
        return Math.floor(candidate);
    }
    return 1;
}

function getDefaultDurability(definition: InventoryItemDefinition): number {
    const candidate = definition.attributes.durability;
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 1) {
        return Math.floor(candidate);
    }
    return 1;
}

function createItem(definitionId: string, location: InventoryLocation, quantity: number, durability: number): InventoryItemInstance {
    return {
        id: `${definitionId}-${normalizeInventoryId(location.inventoryId)}-${location.section}-${location.x}-${location.y}`,
        definitionId,
        quantity,
        durability,
        location: { ...location, inventoryId: normalizeInventoryId(location.inventoryId) },
    };
}
