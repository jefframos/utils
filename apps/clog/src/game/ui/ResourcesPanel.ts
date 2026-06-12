import { createFloatingWindow } from './FloatingWindow';
import type { InventoryState } from '../inventory/InventoryModel';
import type { ResourceType } from '../inventory/InventoryModel';
import { getInventoryItemDefinition } from '../inventory/InventoryModel';

type ResourcesPanelOptions = {
    getInventoryState: () => InventoryState;
    getInventoryBucket?: (inventoryId: string) => 'storage' | 'held' | 'ignore';
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
    const frame = createFloatingWindow({
        title: 'Resources',
        className: 'resources-window',
        resizable: false,
        initialState: {
            open: true,
            minimized: false,
            left: 16,
            top: 92,
            width: 210,
            height: 180,
        },
    });

    const root = document.createElement('div');
    root.className = 'resources-panel';
    frame.content.appendChild(root);

    const update = () => {
        const inventoryState = options.getInventoryState();
        root.innerHTML = '';
        const resources: Record<ResourceType, { storage: number; held: number }> = {
            'debug-asteroid-ore': { storage: 0, held: 0 },
            'debug-ice-shard': { storage: 0, held: 0 },
            'debug-scrap': { storage: 0, held: 0 },
            'debug-battery': { storage: 0, held: 0 },
        };

        for (const item of inventoryState.items) {
            const definition = getInventoryItemDefinition(item.definitionId);
            if (!definition || definition.itemType !== 'resource') continue;
            if (!(item.definitionId in resources)) continue;

            const resourceId = item.definitionId as ResourceType;
            const inventoryId = item.location.inventoryId ?? 'player';
            const bucket = options.getInventoryBucket?.(inventoryId)
                ?? (inventoryId === 'player' ? 'held' : 'ignore');

            if (bucket === 'storage') {
                resources[resourceId].storage += item.quantity;
            } else if (bucket === 'held') {
                resources[resourceId].held += item.quantity;
            }
        }

        const title = document.createElement('div');
        title.className = 'resources-panel-title';
        title.textContent = 'Resources';
        root.appendChild(title);

        let hasResourceRows = false;
        for (const [resourceId, counts] of Object.entries(resources) as Array<[ResourceType, { storage: number; held: number }]>) {
            if (counts.storage === 0 && counts.held === 0) continue;
            hasResourceRows = true;

            const info = RESOURCE_DISPLAY_INFO[resourceId];
            const row = document.createElement('div');
            row.className = 'resources-panel-row';

            const label = document.createElement('span');
            label.className = 'resources-panel-label';
            label.textContent = info.label;
            label.style.color = info.color;

            const value = document.createElement('span');
            value.className = 'resources-panel-value';
            value.textContent = `${counts.storage} (${counts.held})`;
            value.style.color = info.color;

            row.appendChild(label);
            row.appendChild(value);
            root.appendChild(row);
        }

        if (!hasResourceRows) {
            const empty = document.createElement('div');
            empty.className = 'resources-panel-empty';
            empty.textContent = 'No resources tracked yet';
            root.appendChild(empty);
        }
    };

    update();

    return {
        destroy: () => {
            frame.destroy();
        },
        update,
    };
}
