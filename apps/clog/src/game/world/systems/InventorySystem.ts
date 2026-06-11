/**
 * InventorySystem
 * Manages item storage, transfers between entities, and capacity constraints.
 * Handles ore carrying, dropoff logic, and inventory full pauses.
 */

import type { WorldEntity } from '../WorldModel';

export interface InventorySlot {
    resourceType: string; // 'ore', etc
    amount: number;
}

export interface EntityInventory {
    capacity: number;
    slots: InventorySlot[];
}

export interface InventorySystemContext {
    getEntity(id: string): WorldEntity | null;
    findNearestInventoryContainer(fromX: number, fromY: number, ignoreEntityId?: string): WorldEntity | null;
}

export class InventorySystem {
    private inventories = new Map<string, EntityInventory>();

    constructor(private context: InventorySystemContext) { }

    /**
     * Initialize inventory for an entity
     */
    initializeInventory(entityId: string, capacity: number): void {
        this.inventories.set(entityId, {
            capacity,
            slots: [],
        });
    }

    /**
     * Get entity inventory or undefined if not initialized
     */
    getInventory(entityId: string): EntityInventory | undefined {
        return this.inventories.get(entityId);
    }

    /**
     * Get total items in inventory
     */
    getUsedCapacity(entityId: string): number {
        const inv = this.inventories.get(entityId);
        if (!inv) return 0;
        return inv.slots.reduce((sum, slot) => sum + slot.amount, 0);
    }

    /**
     * Get available space in inventory
     */
    getAvailableCapacity(entityId: string): number {
        const inv = this.inventories.get(entityId);
        if (!inv) return 0;
        return Math.max(0, inv.capacity - this.getUsedCapacity(entityId));
    }

    /**
     * Check if inventory is full
     */
    isFull(entityId: string): boolean {
        return this.getAvailableCapacity(entityId) === 0;
    }

    /**
     * Check if inventory has space for N items
     */
    hasSpaceFor(entityId: string, amount: number): boolean {
        return this.getAvailableCapacity(entityId) >= amount;
    }

    /**
     * Add items to inventory
     * @returns amount actually added (may be less if inventory full)
     */
    addItems(entityId: string, resourceType: string, amount: number): number {
        const inv = this.inventories.get(entityId);
        if (!inv) return 0;

        const available = this.getAvailableCapacity(entityId);
        const toAdd = Math.min(amount, available);

        if (toAdd === 0) return 0;

        // Find existing slot or create new one
        const slot = inv.slots.find((s) => s.resourceType === resourceType);
        if (slot) {
            slot.amount += toAdd;
        } else {
            inv.slots.push({ resourceType, amount: toAdd });
        }

        return toAdd;
    }

    /**
     * Remove items from inventory
     * @returns amount actually removed (may be less if not enough items)
     */
    removeItems(entityId: string, resourceType: string, amount: number): number {
        const inv = this.inventories.get(entityId);
        if (!inv) return 0;

        const slot = inv.slots.find((s) => s.resourceType === resourceType);
        if (!slot) return 0;

        const toRemove = Math.min(amount, slot.amount);
        slot.amount -= toRemove;

        // Clean up empty slots
        if (slot.amount === 0) {
            inv.slots = inv.slots.filter((s) => s.amount > 0);
        }

        return toRemove;
    }

    /**
     * Transfer items between two entities
     * @returns amount actually transferred
     */
    transferItems(
        fromEntityId: string,
        toEntityId: string,
        resourceType: string,
        amount: number,
    ): number {
        const removed = this.removeItems(fromEntityId, resourceType, amount);
        const added = this.addItems(toEntityId, resourceType, removed);

        // Put back any undelivered items
        if (added < removed) {
            this.addItems(fromEntityId, resourceType, removed - added);
        }

        return added;
    }

    /**
     * Get all items of a specific type in inventory
     */
    getItemCount(entityId: string, resourceType: string): number {
        const inv = this.inventories.get(entityId);
        if (!inv) return 0;
        return inv.slots.find((s) => s.resourceType === resourceType)?.amount ?? 0;
    }

    /**
     * Find nearest entity with inventory space to dump resources
     * Prefers base, then other containers
     */
    findNearestDropoffPoint(
        worker: WorldEntity,
        resourceType: string,
        amount: number,
    ): WorldEntity | null {
        // If worker has a home (base), try that first
        if (worker.homeId) {
            const home = this.context.getEntity(worker.homeId);
            if (home && this.hasSpaceFor(home.id, amount)) {
                return home;
            }
        }

        // Find nearest other container with space
        return this.context.findNearestInventoryContainer(worker.x, worker.y, worker.id);
    }

    /**
     * Clear inventory (for entity death/recall)
     */
    clearInventory(entityId: string): void {
        const inv = this.inventories.get(entityId);
        if (inv) {
            inv.slots = [];
        }
    }
}
