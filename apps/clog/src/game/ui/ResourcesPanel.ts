import type { InventoryState } from '../inventory/InventoryModel';
import { getAllResources, type ResourceType } from '../inventory/InventoryModel';

type ResourcesPanelOptions = {
    inventoryState: InventoryState;
};

export type ResourcesPanel = {
    destroy: () => void;
    update: () => void;
};

const RESOURCE_DISPLAY_INFO: Record<ResourceType, { label: string; color: string }> = {
    'debug-asteroid-ore': { label: 'Ore', color: '#8b7355' },
    'debug-ice-shard': { label: 'Ice', color: '#87ceeb' },
    'debug-scrap': { label: 'Scrap', color: '#a9a9a9' },
    'debug-battery': { label: 'Battery', color: '#ffd700' },
};

export function createResourcesPanel(options: ResourcesPanelOptions): ResourcesPanel {
    const root = document.createElement('div');
    root.className = 'resources-panel';
    root.style.cssText = `
        position: fixed;
        top: 50px;
        left: 12px;
        background: rgba(15, 23, 42, 0.85);
        border: 2px solid rgba(100, 116, 139, 0.5);
        border-radius: 6px;
        padding: 8px 12px;
        font-family: monospace;
        font-size: 12px;
        line-height: 1.5;
        color: #e2e8f0;
        z-index: 100;
        pointer-events: none;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    `;

    const update = () => {
        root.innerHTML = '';
        const resources = getAllResources(options.inventoryState);

        const title = document.createElement('div');
        title.style.cssText = `
            font-weight: bold;
            margin-bottom: 4px;
            color: #cbd5e1;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        `;
        title.textContent = 'Resources';
        root.appendChild(title);

        for (const [resourceId, amount] of Object.entries(resources) as Array<[ResourceType, number]>) {
            if (amount === 0) continue;

            const info = RESOURCE_DISPLAY_INFO[resourceId];
            const row = document.createElement('div');
            row.style.cssText = `
                display: flex;
                justify-content: space-between;
                gap: 12px;
                padding: 2px 0;
            `;

            const label = document.createElement('span');
            label.textContent = info.label;
            label.style.color = info.color;

            const value = document.createElement('span');
            value.textContent = amount.toString();
            value.style.fontWeight = 'bold';
            value.style.color = info.color;

            row.appendChild(label);
            row.appendChild(value);
            root.appendChild(row);
        }
    };

    update();
    document.body.appendChild(root);

    return {
        destroy: () => {
            root.remove();
        },
        update,
    };
}
