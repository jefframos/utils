import { createFloatingWindow, type FloatingWindowState } from './FloatingWindow';
import { BUILDABLE_ENTITIES, BUILDABLE_CATEGORIES, getBuildablesForCategory, type BuildableEntityType } from '../content/buildables';

export type BuildPanelMeta = FloatingWindowState;

type BuildPanelOptions = {
    initialWindowState: BuildPanelMeta;
    onWindowStateChange: (state: BuildPanelMeta) => void;
    onSelectionChange: (entityType: BuildableEntityType | null) => void;
    onClose: () => void;
    getAvailableOre: () => number;
};

export type BuildPanel = {
    root: HTMLElement;
    setOpen: (open: boolean) => void;
    setSelectedBuildable: (entityType: BuildableEntityType | null) => void;
    getSelectedBuildable: () => BuildableEntityType | null;
    destroy: () => void;
};

export function createBuildPanel(options: BuildPanelOptions): BuildPanel {
    const initialState: FloatingWindowState = options.initialWindowState;

    const frame = createFloatingWindow({
        title: 'Build',
        className: 'build-panel-window',
        resizable: false,
        initialState: {
            ...initialState,
            width: 400,
            height: 320,
        },
        onStateChange: (state) => {
            options.onWindowStateChange(state);
        },
    });

    const root = document.createElement('div');
    root.className = 'build-panel';

    let selectedBuildable: BuildableEntityType | null = null;

    // Tabs
    const tabsContainer = document.createElement('div');
    tabsContainer.className = 'build-panel-tabs';

    const tabs: Record<string, HTMLButtonElement> = {};
    let activeTab = BUILDABLE_CATEGORIES[0];

    for (const category of BUILDABLE_CATEGORIES) {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'build-panel-tab ui95-button';
        tab.textContent = category;
        tab.addEventListener('click', () => {
            activeTab = category;
            renderTabs();
            renderGrid();
        });
        tabs[category] = tab;
        tabsContainer.appendChild(tab);
    }

    // Grid of buildables
    const gridContainer = document.createElement('div');
    gridContainer.className = 'build-panel-grid';

    // Details panel
    const detailsContainer = document.createElement('div');
    detailsContainer.className = 'build-panel-details';

    const detailsName = document.createElement('h4');
    detailsName.className = 'build-panel-details-name';

    const detailsIcon = document.createElement('div');
    detailsIcon.className = 'build-panel-details-icon';

    const detailsDesc = document.createElement('p');
    detailsDesc.className = 'build-panel-details-desc';

    const detailsCost = document.createElement('p');
    detailsCost.className = 'build-panel-details-cost';

    const detailsStatus = document.createElement('p');
    detailsStatus.className = 'build-panel-details-status';

    detailsContainer.append(detailsIcon, detailsName, detailsDesc, detailsCost, detailsStatus);

    // Close button at bottom
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'ui95-button build-panel-close-button';
    closeButton.textContent = 'Done';
    closeButton.addEventListener('click', () => {
        options.onClose();
    });

    root.append(tabsContainer, gridContainer, detailsContainer, closeButton);
    frame.content.appendChild(root);

    const renderTabs = () => {
        for (const [category, tab] of Object.entries(tabs)) {
            tab.classList.toggle('is-active', category === activeTab);
        }
    };

    const renderGrid = () => {
        gridContainer.textContent = '';
        const buildablesInCategory = getBuildablesForCategory(activeTab);

        for (const entityType of buildablesInCategory) {
            const def = BUILDABLE_ENTITIES[entityType];
            if (!def) continue;

            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'build-panel-grid-item ui95-button';
            item.classList.toggle('is-selected', entityType === selectedBuildable);
            item.innerHTML = `
                <div class="build-panel-grid-item-icon">${def.icon}</div>
                <div class="build-panel-grid-item-name">${def.name}</div>
                <div class="build-panel-grid-item-cost">${def.cost} ore</div>
            `;

            item.addEventListener('click', () => {
                selectedBuildable = entityType;
                options.onSelectionChange(entityType);
                renderGrid();
                renderDetails();
            });

            gridContainer.appendChild(item);
        }
    };

    const renderDetails = () => {
        if (!selectedBuildable) {
            detailsName.textContent = 'Select an item';
            detailsIcon.textContent = '';
            detailsDesc.textContent = '';
            detailsCost.textContent = '';
            detailsStatus.textContent = '';
            return;
        }

        const def = BUILDABLE_ENTITIES[selectedBuildable];
        if (!def) return;

        detailsIcon.textContent = def.icon;
        detailsName.textContent = def.name;
        detailsDesc.textContent = def.description;
        detailsCost.textContent = `Cost: ${def.cost} ore`;

        const availableOre = options.getAvailableOre();
        const canAfford = availableOre >= def.cost;
        detailsStatus.textContent = canAfford ? '✓ Ready to build' : `✗ Need ${def.cost - availableOre} more ore`;
        detailsStatus.classList.toggle('is-ready', canAfford);
        detailsStatus.classList.toggle('is-not-ready', !canAfford);
    };

    renderTabs();
    renderGrid();
    renderDetails();

    return {
        root: frame.root,
        setOpen: (open: boolean) => {
            frame.setOpen(open);
            if (open) {
                frame.setMinimized(false);
            }
        },
        setSelectedBuildable: (entityType: BuildableEntityType | null) => {
            selectedBuildable = entityType;
            renderGrid();
            renderDetails();
        },
        getSelectedBuildable: () => selectedBuildable,
        destroy: () => {
            frame.destroy();
        },
    };
}
