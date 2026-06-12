import { createFloatingWindow } from './FloatingWindow';
import type { InventoryWindowMeta } from '../meta/GameMetaStore';
import type { InventoryItemDefinition, InventoryItemInstance, InventoryLocation, InventorySection } from '../inventory/ItemDefinitions';
import { addInventoryItem, canPlaceAt, createDebugInventoryState, getInventoryItemDefinition, getSectionSize, moveItemWithRules, type InventoryState } from '../inventory/InventoryModel';

type InventoryPanelOptions = {
    initialEquippedToolId: string;
    initialWindowState: InventoryWindowMeta;
    onWindowStateChange: (state: InventoryWindowMeta) => void;
    onEquipTool: (toolId: string) => void;
    onInspectItem: (selection: { item: InventoryItemInstance; definition: InventoryItemDefinition; isEquipped: boolean }) => void;
    onStateChange?: (state: InventoryState) => void;
};

type OccupiedCell = {
    item: InventoryItemInstance;
    definition: InventoryItemDefinition;
    relX: number;
    relY: number;
    isFirst: boolean;
    isLast: boolean;
};

type InventoryMetrics = {
    cellSize: number;
    cellGap: number;
};

export type InventoryPanel = {
    open: () => void;
    setEquippedTool: (toolId: string) => void;
    addItem: (definitionId: string, quantity: number) => number;
    replaceState: (next: InventoryState) => void;
    destroy: () => void;
    getState: () => InventoryState;
};

const DEFAULT_CELL_SIZE = 42;
const DEFAULT_CELL_GAP = 5;
const PLAYER_INVENTORY_ID = 'player';

export function createInventoryPanel(options: InventoryPanelOptions): InventoryPanel {
    const state = createDebugInventoryState();
    state.equippedToolId = options.initialEquippedToolId;

    const notifyStateChange = () => {
        options.onStateChange?.(state);
    };

    const frame = createFloatingWindow({
        title: 'Inventory',
        className: 'inventory-window',
        resizable: false,
        initialState: options.initialWindowState,
        onStateChange: (next) => {
            options.onWindowStateChange(next);
        },
    });

    const root = document.createElement('div');
    root.className = 'inventory-panel';

    const summary = document.createElement('p');
    summary.className = 'inventory-summary';

    const hoverOverlay = document.createElement('div');
    hoverOverlay.className = 'inventory-hover-overlay';
    hoverOverlay.hidden = true;

    const hoverName = document.createElement('div');
    hoverName.className = 'inventory-hover-name';
    const hoverMeta = document.createElement('div');
    hoverMeta.className = 'inventory-hover-meta';
    const hoverQty = document.createElement('div');
    hoverQty.className = 'inventory-hover-qty';
    hoverOverlay.append(hoverName, hoverMeta, hoverQty);

    const sections = document.createElement('div');
    sections.className = 'inventory-sections';

    root.append(summary, sections, hoverOverlay);
    frame.content.appendChild(root);

    let draggingItemId: string | null = null;
    let draggingAnchorCell: { x: number; y: number } | null = null;
    let activeDragGhost: HTMLElement | null = null;

    const render = () => {
        sections.textContent = '';
        summary.textContent = 'Drag items between storage and hotbar. Click an item for full details.';

        sections.append(
            createSection(PLAYER_INVENTORY_ID, 'storage', 'Storage Area', state),
            createSection(PLAYER_INVENTORY_ID, 'hotbar', 'Main Hotbar', state),
        );
    };

    const equipTool = (toolId: string) => {
        state.equippedToolId = toolId;
        options.onEquipTool(toolId);
        render();
        notifyStateChange();
    };

    render();

    return {
        open: () => {
            frame.setOpen(true);
            frame.setMinimized(false);
        },
        setEquippedTool: (toolId: string) => {
            state.equippedToolId = toolId;
            render();
            notifyStateChange();
        },
        addItem: (definitionId: string, quantity: number) => {
            const added = addInventoryItem(state, definitionId, quantity, PLAYER_INVENTORY_ID);
            if (added > 0) {
                render();
                notifyStateChange();
            }
            return added;
        },
        replaceState: (next: InventoryState) => {
            state.containers = Object.fromEntries(
                Object.entries(next.containers).map(([id, container]) => [
                    id,
                    {
                        id: container.id,
                        maxStackSize: container.maxStackSize,
                        maxSlots: container.maxSlots,
                        sections: {
                            storage: { ...container.sections.storage },
                            hotbar: { ...container.sections.hotbar },
                        },
                    },
                ]),
            );
            state.items = next.items.map((item) => ({
                ...item,
                location: { ...item.location },
            }));
            state.equippedToolId = next.equippedToolId;
            render();
            notifyStateChange();
        },
        destroy: () => {
            frame.destroy();
        },
        getState: () => state,
    };

    function createSection(inventoryId: string, section: InventorySection, title: string, currentState: InventoryState): HTMLElement {
        const sectionRoot = document.createElement('section');
        sectionRoot.className = `inventory-section inventory-section-${section}`;

        const sectionTitle = document.createElement('h4');
        sectionTitle.className = 'inventory-section-title';
        sectionTitle.textContent = title;

        const size = getSectionSize(currentState, section, inventoryId);
        const metrics = getInventoryMetrics(frame.root);
        const grid = document.createElement('div');
        grid.className = 'inventory-grid';
        grid.style.setProperty('--inventory-columns', String(size.columns));
        grid.style.setProperty('--inventory-rows', String(size.rows));
        grid.style.setProperty('--inventory-cell-size', `${metrics.cellSize}px`);
        grid.style.setProperty('--inventory-gap', `${metrics.cellGap}px`);

        const occupancy = buildOccupancyMap(currentState, inventoryId, section);

        const clearDropPreview = () => {
            grid.querySelectorAll('.inventory-cell.is-drop-valid, .inventory-cell.is-drop-invalid').forEach((entry) => {
                entry.classList.remove('is-drop-valid', 'is-drop-invalid');
            });
        };

        const markDropPreview = (item: InventoryItemInstance, definition: InventoryItemDefinition, location: InventoryLocation): boolean => {
            clearDropPreview();
            const valid = canPlaceAt(currentState, definition, location, item.id);
            for (const cell of definition.shape.cells) {
                const px = location.x + cell.x;
                const py = location.y + cell.y;
                const slot = grid.querySelector(`.inventory-cell[data-x="${px}"][data-y="${py}"]`) as HTMLElement | null;
                if (!slot) continue;
                slot.classList.add(valid ? 'is-drop-valid' : 'is-drop-invalid');
            }
            return valid;
        };

        for (let y = 0; y < size.rows; y++) {
            for (let x = 0; x < size.columns; x++) {
                const key = `${x}:${y}`;
                const occupied = occupancy.get(key);

                const cell = document.createElement('div');
                cell.className = 'inventory-cell';
                cell.dataset.section = section;
                cell.dataset.x = String(x);
                cell.dataset.y = String(y);

                if (occupied) {
                    const { item, definition } = occupied;
                    cell.classList.add('is-occupied');
                    cell.style.setProperty('--inventory-item-backdrop', definition.view.backdrop);
                    cell.style.setProperty('--inventory-item-tint', definition.view.tint);
                    if (definition.toolId === currentState.equippedToolId) {
                        cell.classList.add('is-equipped');
                    }

                    cell.addEventListener('mousemove', (event) => {
                        hoverOverlay.hidden = false;
                        hoverName.textContent = definition.name;
                        hoverMeta.textContent = `${definition.itemType} • ${definition.shape.width}x${definition.shape.height}`;
                        hoverQty.textContent = definition.itemType === 'tool' ? 'Durability item' : `Amount ${item.quantity}`;
                        const parentRect = root.getBoundingClientRect();
                        const localX = event.clientX - parentRect.left + 12;
                        const localY = event.clientY - parentRect.top + 12;
                        hoverOverlay.style.left = `${Math.max(8, localX)}px`;
                        hoverOverlay.style.top = `${Math.max(8, localY)}px`;
                    });

                    cell.addEventListener('mouseleave', () => {
                        hoverOverlay.hidden = true;
                    });

                    cell.addEventListener('click', () => {
                        options.onInspectItem({ item, definition, isEquipped: definition.toolId === currentState.equippedToolId });
                        if (definition.toolId) {
                            equipTool(definition.toolId);
                        }
                    });

                    cell.draggable = true;
                    cell.addEventListener('dragstart', (event) => {
                        draggingItemId = item.id;
                        draggingAnchorCell = { x: occupied.relX, y: occupied.relY };
                        event.dataTransfer?.setData('text/plain', item.id);

                        const ghost = createDragGhostElement(definition, item.quantity, metrics);
                        document.body.appendChild(ghost);
                        activeDragGhost = ghost;

                        const dragOffsetX = 4 + occupied.relX * (metrics.cellSize + metrics.cellGap) + Math.round(metrics.cellSize * 0.5);
                        const dragOffsetY = 4 + occupied.relY * (metrics.cellSize + metrics.cellGap) + Math.round(metrics.cellSize * 0.5);
                        event.dataTransfer?.setDragImage(ghost, dragOffsetX, dragOffsetY);
                    });

                    cell.addEventListener('dragend', () => {
                        draggingItemId = null;
                        draggingAnchorCell = null;
                        clearDropPreview();
                        if (activeDragGhost) {
                            activeDragGhost.remove();
                            activeDragGhost = null;
                        }
                    });

                    if (occupied.isFirst) {
                        const icon = document.createElement('span');
                        icon.className = 'inventory-item-cell-icon';
                        icon.innerHTML = definition.view.iconSvg;
                        cell.appendChild(icon);
                    }

                    if (occupied.isLast) {
                        const amount = document.createElement('span');
                        amount.className = 'inventory-item-cell-amount';
                        amount.textContent = definition.itemType === 'tool' ? 'x1' : `x${item.quantity}`;
                        cell.appendChild(amount);
                    }
                }

                grid.appendChild(cell);
            }
        }

        grid.addEventListener('dragover', (event) => {
            if (!draggingItemId) return;
            const item = currentState.items.find((entry) => entry.id === draggingItemId);
            const definition = item ? getInventoryItemDefinition(item.definitionId) : undefined;
            if (!item || !definition) return;

            const dropCell = getDropLocation(grid, currentState, inventoryId, section, metrics, event.clientX, event.clientY);
            if (!dropCell) {
                clearDropPreview();
                return;
            }

            const location: InventoryLocation = {
                inventoryId,
                section,
                x: dropCell.x - (draggingAnchorCell?.x ?? 0),
                y: dropCell.y - (draggingAnchorCell?.y ?? 0),
            };

            markDropPreview(item, definition, location);
            event.preventDefault();
        });

        grid.addEventListener('dragleave', (event) => {
            const related = event.relatedTarget as Node | null;
            if (related && grid.contains(related)) return;
            clearDropPreview();
        });

        grid.addEventListener('drop', (event) => {
            const itemId = event.dataTransfer?.getData('text/plain') || draggingItemId;
            if (!itemId) return;
            const dropCell = getDropLocation(grid, currentState, inventoryId, section, metrics, event.clientX, event.clientY);
            if (!dropCell) return;

            const location: InventoryLocation = {
                inventoryId,
                section,
                x: dropCell.x - (draggingAnchorCell?.x ?? 0),
                y: dropCell.y - (draggingAnchorCell?.y ?? 0),
            };

            event.preventDefault();
            const item = currentState.items.find((entry) => entry.id === itemId);
            const definition = item ? getInventoryItemDefinition(item.definitionId) : undefined;
            if (!item || !definition) return;
            const result = moveItemWithRules(currentState, itemId, location);
            if (!result.ok) {
                clearDropPreview();
                return;
            }
            if (definition.toolId) {
                options.onEquipTool(definition.toolId);
            }
            clearDropPreview();
            render();
            notifyStateChange();
        });

        sectionRoot.append(sectionTitle, grid);
        return sectionRoot;
    }
}

function buildOccupancyMap(state: InventoryState, inventoryId: string, section: InventorySection): Map<string, OccupiedCell> {
    const map = new Map<string, OccupiedCell>();

    for (const item of state.items) {
        if ((item.location.inventoryId ?? 'player') !== inventoryId) continue;
        if (item.location.section !== section) continue;
        const definition = getInventoryItemDefinition(item.definitionId);
        if (!definition) continue;

        const sortedCells = definition.shape.cells
            .slice()
            .sort((a, b) => (a.y - b.y) || (a.x - b.x));
        const first = sortedCells[0] ?? { x: 0, y: 0 };
        const last = sortedCells[sortedCells.length - 1] ?? first;

        for (const rel of definition.shape.cells) {
            const x = Math.floor(item.location.x) + rel.x;
            const y = Math.floor(item.location.y) + rel.y;
            const key = `${x}:${y}`;
            map.set(key, {
                item,
                definition,
                relX: rel.x,
                relY: rel.y,
                isFirst: rel.x === first.x && rel.y === first.y,
                isLast: rel.x === last.x && rel.y === last.y,
            });
        }
    }

    return map;
}

function getDropLocation(
    grid: HTMLElement,
    state: InventoryState,
    inventoryId: string,
    section: InventorySection,
    metrics: InventoryMetrics,
    clientX: number,
    clientY: number,
): InventoryLocation | null {
    const rect = grid.getBoundingClientRect();
    const size = getSectionSize(state, section, inventoryId);
    const totalWidth = size.columns * metrics.cellSize + (size.columns - 1) * metrics.cellGap;
    const totalHeight = size.rows * metrics.cellSize + (size.rows - 1) * metrics.cellGap;
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    if (localX < 0 || localY < 0 || localX > totalWidth || localY > totalHeight) {
        return null;
    }

    const cellX = Math.min(size.columns - 1, Math.max(0, Math.floor(localX / (metrics.cellSize + metrics.cellGap))));
    const cellY = Math.min(size.rows - 1, Math.max(0, Math.floor(localY / (metrics.cellSize + metrics.cellGap))));
    return { inventoryId, section, x: cellX, y: cellY };
}

function createDragGhostElement(definition: InventoryItemDefinition, quantity: number, metrics: InventoryMetrics): HTMLElement {
    const ghost = document.createElement('div');
    ghost.className = 'inventory-drag-ghost';
    const width = definition.shape.width * metrics.cellSize + (definition.shape.width - 1) * metrics.cellGap;
    const height = definition.shape.height * metrics.cellSize + (definition.shape.height - 1) * metrics.cellGap;
    ghost.style.width = `${width}px`;
    ghost.style.height = `${height}px`;

    const shapeLayer = document.createElement('div');
    shapeLayer.className = 'inventory-drag-ghost-shape';
    shapeLayer.style.setProperty('--inventory-gap', `${metrics.cellGap}px`);
    shapeLayer.style.gridTemplateColumns = `repeat(${definition.shape.width}, 1fr)`;
    shapeLayer.style.gridTemplateRows = `repeat(${definition.shape.height}, 1fr)`;

    const sorted = definition.shape.cells.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const first = sorted[0] ?? { x: 0, y: 0 };
    const last = sorted[sorted.length - 1] ?? first;

    for (const cell of definition.shape.cells) {
        const block = document.createElement('span');
        block.className = 'inventory-item-shape-cell is-filled';
        block.style.gridColumn = String(cell.x + 1);
        block.style.gridRow = String(cell.y + 1);

        if (cell.x === first.x && cell.y === first.y) {
            const icon = document.createElement('span');
            icon.className = 'inventory-item-cell-icon';
            icon.innerHTML = definition.view.iconSvg;
            block.appendChild(icon);
        }

        if (cell.x === last.x && cell.y === last.y) {
            const amount = document.createElement('span');
            amount.className = 'inventory-item-cell-amount';
            amount.textContent = definition.itemType === 'tool' ? 'x1' : `x${quantity}`;
            block.appendChild(amount);
        }

        shapeLayer.appendChild(block);
    }

    ghost.appendChild(shapeLayer);
    return ghost;
}

function getInventoryMetrics(source: HTMLElement): InventoryMetrics {
    const styles = getComputedStyle(source);
    const cellSize = Number.parseInt(styles.getPropertyValue('--inventory-cell-size').trim(), 10);
    const cellGap = Number.parseInt(styles.getPropertyValue('--inventory-gap').trim(), 10);
    return {
        cellSize: Number.isFinite(cellSize) ? cellSize : DEFAULT_CELL_SIZE,
        cellGap: Number.isFinite(cellGap) ? cellGap : DEFAULT_CELL_GAP,
    };
}
