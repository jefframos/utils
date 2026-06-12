import { INVENTORY_ITEM_DEFINITIONS, INVENTORY_LAYOUT, type InventoryItemDefinition, type InventoryItemInstance, type InventoryLocation, type InventorySection } from '../ItemDefinitions';

export type InventoryContainer = {
    id: string;
    /** Optional per-container max stack cap (applies on top of item definition stackSize). */
    maxStackSize?: number;
    /** Optional per-container max enabled storage slots. */
    maxSlots?: number;
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
                maxStackSize: 99,
                maxSlots: 12,
                sections: {
                    storage: { columns: INVENTORY_LAYOUT.storageColumns, rows: INVENTORY_LAYOUT.storageRows },
                    hotbar: { columns: INVENTORY_LAYOUT.hotbarColumns, rows: INVENTORY_LAYOUT.hotbarRows },
                },
            },
        },
        items: [
            createItem('starter-cutter', { inventoryId: PLAYER_INVENTORY_ID, section: 'hotbar', x: 0, y: 0 }, 1, 100),
            createItem('shock-mallet', { inventoryId: PLAYER_INVENTORY_ID, section: 'hotbar', x: 2, y: 0 }, 1, 140),
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

    if (!isWithinContainerSlotCapacity(state, definition, location)) return false;

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
    const maxStack = getMaxStackForInventory(state, definition, invId);

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

function getDefinitionMaxStack(definition: InventoryItemDefinition): number {
    const candidate = definition.attributes.stackSize;
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 1) {
        return Math.floor(candidate);
    }
    return 1;
}

export function getMaxStackForInventory(
    state: InventoryState,
    definition: InventoryItemDefinition,
    inventoryId?: string,
): number {
    const definitionMax = getDefinitionMaxStack(definition);
    const invId = normalizeInventoryId(inventoryId);
    const containerCap = state.containers[invId]?.maxStackSize;
    if (typeof containerCap === 'number' && Number.isFinite(containerCap) && containerCap >= 1) {
        return Math.max(1, Math.min(definitionMax, Math.floor(containerCap)));
    }
    return definitionMax;
}

function isWithinContainerSlotCapacity(
    state: InventoryState,
    definition: InventoryItemDefinition,
    location: InventoryLocation,
): boolean {
    const invId = normalizeInventoryId(location.inventoryId);
    const container = state.containers[invId];
    if (!container) return true;
    if (location.section !== 'storage') return true;

    const maxSlots = container.maxSlots;
    if (typeof maxSlots !== 'number' || !Number.isFinite(maxSlots) || maxSlots < 1) {
        return true;
    }

    const columns = container.sections.storage.columns;
    for (const cell of definition.shape.cells) {
        const targetX = location.x + cell.x;
        const targetY = location.y + cell.y;
        const slotIndex = targetY * columns + targetX;
        if (slotIndex < 0 || slotIndex >= Math.floor(maxSlots)) return false;
    }

    return true;
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

export function getTotalResourceCount(state: InventoryState, resourceId: string, inventoryId?: string): number {
    const invId = normalizeInventoryId(inventoryId);
    const items = state.items.filter((item) => {
        return normalizeInventoryId(item.location.inventoryId) === invId && item.definitionId === resourceId;
    });
    return items.reduce((sum, item) => sum + item.quantity, 0);
}

export type ResourceType = 'debug-asteroid-ore' | 'debug-ice-shard' | 'debug-scrap' | 'debug-battery';

export function getAllResources(state: InventoryState, inventoryId?: string): Record<ResourceType, number> {
    const invId = normalizeInventoryId(inventoryId);
    const resources: Record<ResourceType, number> = {
        'debug-asteroid-ore': 0,
        'debug-ice-shard': 0,
        'debug-scrap': 0,
        'debug-battery': 0,
    };

    for (const resource of Object.keys(resources) as ResourceType[]) {
        resources[resource] = getTotalResourceCount(state, resource, invId);
    }

    return resources;
}

export function deductResource(state: InventoryState, resourceId: string, amount: number, inventoryId?: string): boolean {
    const invId = normalizeInventoryId(inventoryId);
    const total = getTotalResourceCount(state, resourceId, invId);
    if (total < amount) return false;

    let remaining = amount;
    const items = state.items
        .filter((item) => normalizeInventoryId(item.location.inventoryId) === invId && item.definitionId === resourceId)
        .sort((a, b) => {
            const sectionOrder = a.location.section === 'hotbar' ? 0 : 1;
            const otherSectionOrder = b.location.section === 'hotbar' ? 0 : 1;
            if (sectionOrder !== otherSectionOrder) return sectionOrder - otherSectionOrder;
            return (a.location.y - b.location.y) || (a.location.x - b.location.x);
        });

    for (const item of items) {
        if (remaining <= 0) break;
        const deduct = Math.min(item.quantity, remaining);
        item.quantity -= deduct;
        remaining -= deduct;
    }

    state.items = state.items.filter((item) => item.quantity > 0);
    return true;
}
