import type { InventoryItemDefinition, InventoryItemInstance, InventoryLocation } from '../ItemDefinitions';
import {
    canPlaceAt,
    canPlaceAtWithIgnoreSet,
    getInventoryItemDefinition,
    normalizeInventoryId,
    type InventoryState,
} from '../state/InventoryState';

export type MoveInventoryItemAction = {
    type: 'move-item';
    itemId: string;
    target: InventoryLocation;
};

export type InventoryActionResult = {
    ok: boolean;
    reason?: 'item-not-found' | 'definition-not-found' | 'invalid-target' | 'blocked';
};

export function applyInventoryAction(state: InventoryState, action: MoveInventoryItemAction): InventoryActionResult {
    if (action.type !== 'move-item') {
        return { ok: false, reason: 'invalid-target' };
    }

    return moveItemWithRules(state, action.itemId, action.target);
}

export function moveItemWithRules(state: InventoryState, itemId: string, target: InventoryLocation): InventoryActionResult {
    const movingItem = state.items.find((entry) => entry.id === itemId);
    if (!movingItem) return { ok: false, reason: 'item-not-found' };

    const movingDef = getInventoryItemDefinition(movingItem.definitionId);
    if (!movingDef) return { ok: false, reason: 'definition-not-found' };

    const normalizedTarget: InventoryLocation = {
        ...target,
        inventoryId: normalizeInventoryId(target.inventoryId),
    };

    const colliding = findCollidingItems(state, movingDef, normalizedTarget, new Set([movingItem.id]));

    if (colliding.length === 0) {
        if (!canPlaceAt(state, movingDef, normalizedTarget, movingItem.id)) {
            return { ok: false, reason: 'invalid-target' };
        }
        movingItem.location = normalizedTarget;
        return { ok: true };
    }

    if (colliding.length > 1) {
        return { ok: false, reason: 'blocked' };
    }

    const targetItem = colliding[0];
    const targetDef = getInventoryItemDefinition(targetItem.definitionId);
    if (!targetDef) return { ok: false, reason: 'definition-not-found' };

    if (targetItem.definitionId === movingItem.definitionId) {
        const maxStack = getMaxStack(movingDef);
        if (maxStack > 1) {
            const capacity = Math.max(0, maxStack - targetItem.quantity);
            if (capacity <= 0) return { ok: false, reason: 'blocked' };
            const transfer = Math.min(capacity, movingItem.quantity);
            targetItem.quantity += transfer;
            movingItem.quantity -= transfer;
            if (movingItem.quantity <= 0) {
                removeItem(state, movingItem.id);
            }
            return { ok: true };
        }
    }

    const source = { ...movingItem.location, inventoryId: normalizeInventoryId(movingItem.location.inventoryId) };
    const ignoreSet = new Set<string>([movingItem.id, targetItem.id]);

    const movingCanFit = canPlaceAtWithIgnoreSet(state, movingDef, normalizedTarget, ignoreSet);
    const targetCanFit = canPlaceAtWithIgnoreSet(state, targetDef, source, ignoreSet);

    if (!movingCanFit || !targetCanFit) {
        return { ok: false, reason: 'blocked' };
    }

    movingItem.location = normalizedTarget;
    targetItem.location = source;
    return { ok: true };
}

function findCollidingItems(
    state: InventoryState,
    definition: InventoryItemDefinition,
    location: InventoryLocation,
    ignoreIds: Set<string>,
): InventoryItemInstance[] {
    const targetInv = normalizeInventoryId(location.inventoryId);
    const hits = new Map<string, InventoryItemInstance>();

    for (const item of state.items) {
        if (ignoreIds.has(item.id)) continue;
        const placedDef = getInventoryItemDefinition(item.definitionId);
        if (!placedDef) continue;
        if (normalizeInventoryId(item.location.inventoryId) !== targetInv) continue;
        if (item.location.section !== location.section) continue;

        for (const sourceCell of definition.shape.cells) {
            const targetX = location.x + sourceCell.x;
            const targetY = location.y + sourceCell.y;
            const overlaps = placedDef.shape.cells.some((cell) => {
                const itemX = item.location.x + cell.x;
                const itemY = item.location.y + cell.y;
                return itemX === targetX && itemY === targetY;
            });
            if (overlaps) {
                hits.set(item.id, item);
                break;
            }
        }
    }

    return Array.from(hits.values());
}

function getMaxStack(definition: InventoryItemDefinition): number {
    const candidate = definition.attributes.stackSize;
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 1) {
        return Math.floor(candidate);
    }
    return 1;
}

function removeItem(state: InventoryState, itemId: string): void {
    const index = state.items.findIndex((entry) => entry.id === itemId);
    if (index >= 0) {
        state.items.splice(index, 1);
    }
}
