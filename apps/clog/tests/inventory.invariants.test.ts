import { describe, expect, it } from 'vitest';
import {
    addInventoryItem,
    createDebugInventoryState,
    getInventoryItemDefinition,
    getSectionSize,
    moveInventoryItem,
    moveItemWithRules,
    type InventoryState,
} from '../src/game/inventory/InventoryModel';

function createSeededRandom(seed = 1337): () => number {
    let value = seed >>> 0;
    return () => {
        value = (value * 1664525 + 1013904223) >>> 0;
        return value / 0xffffffff;
    };
}

function assertInventoryInvariants(state: InventoryState): void {
    const occupancy = new Map<string, string>();

    for (const item of state.items) {
        const definition = getInventoryItemDefinition(item.definitionId);
        expect(definition, `Missing definition for ${item.definitionId}`).toBeDefined();
        if (!definition) continue;

        const inventoryId = item.location.inventoryId ?? 'player';
        const sectionSize = getSectionSize(state, item.location.section, inventoryId);

        expect(item.quantity).toBeGreaterThan(0);
        const stackSize = Number(definition.attributes.stackSize ?? 1);
        expect(item.quantity).toBeLessThanOrEqual(Number.isFinite(stackSize) ? stackSize : 1);

        for (const cell of definition.shape.cells) {
            const x = item.location.x + cell.x;
            const y = item.location.y + cell.y;
            expect(x).toBeGreaterThanOrEqual(0);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThan(sectionSize.columns);
            expect(y).toBeLessThan(sectionSize.rows);

            const key = `${inventoryId}:${item.location.section}:${x}:${y}`;
            const existing = occupancy.get(key);
            expect(existing, `Cell collision at ${key} between ${existing} and ${item.id}`).toBeUndefined();
            occupancy.set(key, item.id);
        }
    }
}

describe('inventory invariants', () => {
    it('keeps a valid initial debug state', () => {
        const state = createDebugInventoryState();
        assertInventoryInvariants(state);
    });

    it('never violates invariants under randomized operations', () => {
        const state = createDebugInventoryState();
        const random = createSeededRandom(42);
        const addableResources = ['debug-asteroid-ore', 'debug-ice-shard', 'debug-scrap', 'debug-battery'];

        for (let step = 0; step < 450; step++) {
            const op = random();

            if (op < 0.45) {
                const definitionId = addableResources[Math.floor(random() * addableResources.length)] ?? addableResources[0];
                const qty = 1 + Math.floor(random() * 160);
                const added = addInventoryItem(state, definitionId, qty, 'player');
                expect(added).toBeGreaterThanOrEqual(0);
                expect(added).toBeLessThanOrEqual(qty);
            } else {
                if (state.items.length === 0) continue;
                const movingIndex = Math.floor(random() * state.items.length);
                const moving = state.items[movingIndex];
                if (!moving) continue;

                const targetSection = random() < 0.6 ? 'storage' : 'hotbar';
                const size = getSectionSize(state, targetSection, 'player');
                const targetX = Math.floor(random() * (size.columns + 4)) - 2;
                const targetY = Math.floor(random() * (size.rows + 4)) - 2;

                moveInventoryItem(state, moving.id, {
                    inventoryId: 'player',
                    section: targetSection,
                    x: targetX,
                    y: targetY,
                });
            }

            assertInventoryInvariants(state);
        }
    });

    it('caps stack sizes while adding resources', () => {
        const state = createDebugInventoryState();
        const added = addInventoryItem(state, 'debug-asteroid-ore', 220, 'player');
        expect(added).toBe(220);

        const oreStacks = state.items.filter((item) => item.definitionId === 'debug-asteroid-ore');
        expect(oreStacks.length).toBeGreaterThan(1);

        for (const stack of oreStacks) {
            expect(stack.quantity).toBeLessThanOrEqual(99);
            expect(stack.quantity).toBeGreaterThan(0);
        }

        assertInventoryInvariants(state);
    });

    it('keeps invariants when swapping with move rules', () => {
        const state = createDebugInventoryState();
        const battery = state.items.find((item) => item.definitionId === 'debug-battery');
        expect(battery).toBeDefined();
        if (!battery) return;

        const result = moveItemWithRules(state, battery.id, {
            inventoryId: 'player',
            section: 'hotbar',
            x: 0,
            y: 0,
        });

        expect(result.ok).toBe(true);
        assertInventoryInvariants(state);
    });
});
