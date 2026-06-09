import { createFloatingWindow } from './FloatingWindow';
import type { InventoryItemDefinition, InventoryItemInstance } from '../inventory/ItemDefinitions';
import type { InventoryItemDetailsWindowMeta } from '../meta/GameMetaStore';

type Selection = {
    item: InventoryItemInstance;
    definition: InventoryItemDefinition;
    isEquipped?: boolean;
};

type InventoryItemDetailsWindowOptions = {
    initialWindowState: InventoryItemDetailsWindowMeta;
    onWindowStateChange: (state: InventoryItemDetailsWindowMeta) => void;
    onEquipTool?: (toolId: string) => void;
};

export type InventoryItemDetailsWindow = {
    open: () => void;
    setSelection: (selection: Selection) => void;
    clearSelection: () => void;
    destroy: () => void;
};

export function createInventoryItemDetailsWindow(options: InventoryItemDetailsWindowOptions): InventoryItemDetailsWindow {
    const frame = createFloatingWindow({
        title: 'Item Details',
        className: 'inventory-item-details-window',
        resizable: false,
        initialState: options.initialWindowState,
        onStateChange: (state) => {
            options.onWindowStateChange(state);
        },
    });

    const root = document.createElement('div');
    root.className = 'inventory-item-details-panel';

    const name = document.createElement('h4');
    name.className = 'inventory-item-details-name';
    name.textContent = 'No item selected';

    const meta = document.createElement('p');
    meta.className = 'inventory-item-details-meta';
    meta.textContent = 'Click an item in inventory to inspect.';

    const icon = document.createElement('div');
    icon.className = 'inventory-item-details-icon';

    const equipButton = document.createElement('button');
    equipButton.type = 'button';
    equipButton.className = 'ui95-button inventory-item-details-equip';
    equipButton.textContent = 'Equip';
    equipButton.hidden = true;

    const attrs = document.createElement('dl');
    attrs.className = 'inventory-item-details-attrs';
    attrs.hidden = true;

    root.append(name, meta, icon, equipButton, attrs);
    frame.content.appendChild(root);

    const updateAutoHeight = () => {
        const baseHeight = Math.ceil(root.scrollHeight + 14);
        const clamped = Math.max(260, Math.min(window.innerHeight - 24, baseHeight));
        frame.root.style.height = `${clamped}px`;
    };

    return {
        open: () => {
            frame.setOpen(true);
            frame.setMinimized(false);
        },
        clearSelection: () => {
            name.textContent = 'No item selected';
            meta.textContent = 'Click an item in inventory to inspect.';
            icon.innerHTML = '';
            icon.classList.remove('is-equipped');
            attrs.textContent = '';
            attrs.hidden = true;
            equipButton.hidden = true;
            equipButton.onclick = null;
        },
        setSelection: (selection) => {
            name.textContent = selection.definition.name;
            meta.textContent = `${selection.definition.itemType} • Durability ${selection.item.durability} • Qty ${selection.item.quantity}`;
            icon.innerHTML = selection.definition.view.iconSvg;
            icon.classList.toggle('is-equipped', selection.isEquipped === true);
            attrs.textContent = '';
            attrs.hidden = false;

            if (selection.definition.toolId) {
                equipButton.hidden = false;
                equipButton.textContent = selection.isEquipped ? 'Equipped' : 'Equip';
                equipButton.disabled = selection.isEquipped === true;
                equipButton.onclick = () => {
                    if (!selection.definition.toolId) return;
                    options.onEquipTool?.(selection.definition.toolId);
                    selection.isEquipped = true;
                    icon.classList.add('is-equipped');
                    equipButton.textContent = 'Equipped';
                    equipButton.disabled = true;
                };
            } else {
                equipButton.hidden = true;
                equipButton.onclick = null;
            }

            const rows: Array<[string, string]> = [
                ['shape', `${selection.definition.shape.width}x${selection.definition.shape.height}`],
                ['quantity', String(selection.item.quantity)],
                ['durability', String(selection.item.durability)],
            ];

            for (const [key, value] of Object.entries(selection.definition.attributes)) {
                rows.push([key, String(value)]);
            }

            for (const [label, value] of rows) {
                const dt = document.createElement('dt');
                dt.textContent = label;
                const dd = document.createElement('dd');
                dd.textContent = value;
                attrs.append(dt, dd);
            }

            updateAutoHeight();
        },
        destroy: () => {
            frame.destroy();
        },
    };
}
