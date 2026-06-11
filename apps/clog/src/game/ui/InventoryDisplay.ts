/**
 * InventoryDisplay
 * Displays inventory slots in the entity footer
 */

export type InventoryDisplayOptions = {
    capacity: number;
    slots: Array<{ resourceType: string; amount: number }>;
};

export function createInventoryDisplay(options: InventoryDisplayOptions) {
    const root = document.createElement('div');
    root.className = 'inventory-display';

    const label = document.createElement('span');
    label.className = 'inventory-display-label';
    label.textContent = 'Inventory:';

    const slotsContainer = document.createElement('div');
    slotsContainer.className = 'inventory-display-slots';

    const totalUsed = options.slots.reduce((sum, slot) => sum + slot.amount, 0);
    const capacityLabel = document.createElement('span');
    capacityLabel.className = 'inventory-display-capacity';
    capacityLabel.textContent = `${totalUsed}/${options.capacity}`;

    // Render individual resource slots
    for (const slot of options.slots) {
        const slotEl = document.createElement('div');
        slotEl.className = 'inventory-slot';
        slotEl.title = `${slot.resourceType}: ${slot.amount}`;

        const icon = document.createElement('span');
        icon.className = 'inventory-slot-icon';
        icon.textContent = getResourceIcon(slot.resourceType);

        const amount = document.createElement('span');
        amount.className = 'inventory-slot-amount';
        amount.textContent = slot.amount.toString();

        slotEl.append(icon, amount);
        slotsContainer.appendChild(slotEl);
    }

    root.append(label, slotsContainer, capacityLabel);
    return root;
}

function getResourceIcon(resourceType: string): string {
    if (resourceType === 'ore') return '⬙';
    return '?';
}
