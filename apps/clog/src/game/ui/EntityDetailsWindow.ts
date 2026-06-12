import type { WorkerEntityCommandList, WorkerUnitType, WorldEntity } from '../world/WorldModel';
import { createFloatingWindow } from './FloatingWindow';
import type { EntityDetailsWindowMeta } from '../meta/GameMetaStore';
import type { InventoryItemDefinition, InventoryItemInstance, InventoryLocation } from '../inventory/ItemDefinitions';
import { canPlaceAt, getInventoryItemDefinition, moveItemWithRules, type InventoryState } from '../inventory/InventoryModel';
import { WORKER_DEFINITIONS } from '../content/workers';
import { getEntityLabel, getEntitySummary } from '../content/entities.ts';

type EntityDetailsWindowOptions = {
    onDeleteBeacon: (entityId: string) => void;
    onSpawnUnit: (buildingId: string, unitType: WorkerUnitType) => void;
    onDeployWorker: (workerId: string) => void;
    onRecallWorker: (workerId: string) => void;
    onRecallAllWorkers: (buildingId: string) => void;
    onInterruptWorkerCommand: (workerId: string) => void;
    onClearWorkerCommands: (workerId: string) => void;
    onRemoveQueuedWorkerCommand: (workerId: string, commandId: string) => void;
    onBuild: (entityId: string) => void;
    getWorkersForBuilding: (buildingId: string) => ReadonlyArray<WorldEntity>;
    inventoryAdapter?: EntityInventoryAdapter;
    initialWindowState: EntityDetailsWindowMeta;
    onWindowStateChange: (state: EntityDetailsWindowMeta) => void;
};

export type EntityInventoryAdapter = {
    getState: () => InventoryState | null;
    ensureEntityInventory: (entity: WorldEntity, state: InventoryState) => { inventoryId: string; maxSlots: number } | null;
    syncEntityInventory?: (entity: WorldEntity, state: InventoryState, binding: { inventoryId: string; maxSlots: number }) => boolean;
    onDidChange?: (listener: () => void) => () => void;
    onStateChange: (state: InventoryState) => void;
    onInspectItem: (selection: { item: InventoryItemInstance; definition: InventoryItemDefinition; isEquipped: boolean }) => void;
    onEquipTool: (toolId: string) => void;
};

export type EntityDetailsWindow = {
    openForEntity: (entity: WorldEntity) => void;
    clearSelection: () => void;
    close: () => void;
    destroy: () => void;
};

const BEACON_REFUND_ORE = 5;
const ENTITY_INVENTORY_COLUMNS = 8;
const ENTITY_INVENTORY_MIN_VISIBLE_SLOTS = 12;
const DEFAULT_CELL_SIZE = 42;
const DEFAULT_CELL_GAP = 5;

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

export function createEntityDetailsWindow(options: EntityDetailsWindowOptions): EntityDetailsWindow {
    const frame = createFloatingWindow({
        title: 'Entity Details',
        className: 'entity-details-window',
        resizable: false,
        initialState: options.initialWindowState,
        onStateChange: (state) => {
            options.onWindowStateChange(state);
        },
    });

    const panel = document.createElement('div');
    panel.className = 'entity-details-panel';

    const name = document.createElement('h4');
    name.className = 'entity-details-name';
    name.textContent = 'No entity selected';

    const summary = document.createElement('p');
    summary.className = 'entity-details-summary';
    summary.textContent = 'Click an entity to inspect it.';

    const meta = document.createElement('dl');
    meta.className = 'entity-details-meta';
    meta.hidden = true;

    const actions = document.createElement('div');
    actions.className = 'entity-details-actions';
    actions.hidden = true;

    const inventorySection = document.createElement('section');
    inventorySection.className = 'entity-inventory-section';
    inventorySection.hidden = true;

    const inventoryTitle = document.createElement('h5');
    inventoryTitle.className = 'entity-workers-title';
    inventoryTitle.textContent = 'Inventory';

    const inventoryGrid = document.createElement('div');
    inventoryGrid.className = 'inventory-grid entity-inventory-grid';

    inventorySection.append(inventoryTitle, inventoryGrid);

    const setActions = (entries: Array<{ label: string; onClick: () => void; disabled?: boolean }>) => {
        actions.textContent = '';
        for (const entry of entries) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'ui95-button entity-details-action-btn';
            button.textContent = entry.label;
            button.disabled = entry.disabled === true;
            button.onclick = entry.onClick;
            actions.appendChild(button);
        }
        actions.hidden = entries.length === 0;
    };

    const baseWorkersSection = document.createElement('section');
    baseWorkersSection.className = 'entity-workers-section';
    baseWorkersSection.hidden = true;

    const workerCommandsSection = document.createElement('section');
    workerCommandsSection.className = 'entity-worker-commands';
    workerCommandsSection.hidden = true;

    const workerCommandsTitle = document.createElement('h5');
    workerCommandsTitle.className = 'entity-workers-title';
    workerCommandsTitle.textContent = 'Command Queue';

    const workerCommandButtons = document.createElement('div');
    workerCommandButtons.className = 'entity-details-actions';

    const interruptCurrentButton = document.createElement('button');
    interruptCurrentButton.type = 'button';
    interruptCurrentButton.className = 'ui95-button entity-details-action-btn';
    interruptCurrentButton.textContent = 'Interrupt Current';

    const clearQueueButton = document.createElement('button');
    clearQueueButton.type = 'button';
    clearQueueButton.className = 'ui95-button entity-details-action-btn';
    clearQueueButton.textContent = 'Clear Queue';

    workerCommandButtons.append(interruptCurrentButton, clearQueueButton);

    const workerCurrentCommand = document.createElement('p');
    workerCurrentCommand.className = 'entity-details-summary';

    const workerQueuedCommands = document.createElement('div');
    workerQueuedCommands.className = 'entity-workers-grid';

    workerCommandsSection.append(workerCommandsTitle, workerCommandButtons, workerCurrentCommand, workerQueuedCommands);

    const baseWorkersHeader = document.createElement('div');
    baseWorkersHeader.className = 'entity-workers-header';

    const baseWorkersTitle = document.createElement('h5');
    baseWorkersTitle.className = 'entity-workers-title';
    baseWorkersTitle.textContent = 'Workers';

    baseWorkersHeader.append(baseWorkersTitle);

    const workersGrid = document.createElement('div');
    workersGrid.className = 'entity-workers-grid';

    baseWorkersSection.append(baseWorkersHeader, workersGrid);

    panel.append(name, summary, meta, inventorySection, actions, baseWorkersSection, workerCommandsSection);
    frame.content.appendChild(panel);

    let draggingItemId: string | null = null;
    let draggingAnchorCell: { x: number; y: number } | null = null;
    let activeDragGhost: HTMLElement | null = null;
    let currentEntity: WorldEntity | null = null;

    const setRows = (rows: Array<[string, string]>) => {
        meta.textContent = '';
        for (const [label, value] of rows) {
            const dt = document.createElement('dt');
            dt.textContent = label;
            const dd = document.createElement('dd');
            dd.textContent = value;
            meta.append(dt, dd);
        }
    };

    const renderBaseWorkers = (baseEntity: WorldEntity) => {
        const workers = options.getWorkersForBuilding(baseEntity.id);
        workersGrid.textContent = '';

        for (const worker of workers) {
            const card = document.createElement('article');
            card.className = 'entity-worker-card';

            const label = document.createElement('div');
            label.className = 'entity-worker-label';
            label.textContent = worker.viewDef?.icon
                ? `${worker.viewDef.icon} ${getEntityLabel(worker.kind, worker.unitType)}`
                : getEntityLabel(worker.kind, worker.unitType);

            const status = document.createElement('div');
            status.className = 'entity-worker-status';
            status.textContent = worker.deployed ? `Deployed (${worker.x}, ${worker.y})` : 'Docked';

            const action = document.createElement('button');
            action.type = 'button';
            action.className = 'ui95-button entity-details-action-btn entity-worker-action';
            action.textContent = worker.deployed ? 'Return' : 'Deploy';
            action.onclick = () => {
                if (worker.deployed) {
                    options.onRecallWorker(worker.id);
                } else {
                    options.onDeployWorker(worker.id);
                }
            };

            card.append(label, status, action);
            workersGrid.appendChild(card);
        }

        if (workers.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'entity-workers-empty';
            empty.textContent = 'No workers yet. Spawn one from this station.';
            workersGrid.appendChild(empty);
        }

        const deployedCount = workers.filter((entry) => entry.deployed).length;
        baseWorkersTitle.textContent = `Workers (${workers.length})`;

        setActions([
            ...Object.values(WORKER_DEFINITIONS).map((def) => ({
                label: `Spawn ${def.name}`,
                onClick: () => { options.onSpawnUnit(baseEntity.id, def.id); },
            })),
            {
                label: 'Recall All Workers',
                onClick: () => {
                    options.onRecallAllWorkers(baseEntity.id);
                },
                disabled: deployedCount === 0,
            },
        ]);
    };

    const describeWorkerCommand = (commandType: string, payload: { x?: number; y?: number; repeat?: boolean }): string => {
        if (commandType === 'mine') {
            return payload.repeat === false
                ? `Mine (${payload.x ?? '?'}, ${payload.y ?? '?'})`
                : `Mine (${payload.x ?? '?'}, ${payload.y ?? '?'}) [repeat]`;
        }
        if (commandType === 'move') {
            return `Move (${payload.x ?? '?'}, ${payload.y ?? '?'})`;
        }
        if (commandType === 'recall') {
            return 'Recall to base';
        }
        return commandType;
    };

    const renderWorkerCommandQueue = (worker: WorldEntity) => {
        const commandList = (worker.commandList as WorkerEntityCommandList | null) ?? { nextId: 1, current: null, queue: [] } as WorkerEntityCommandList;
        workerQueuedCommands.textContent = '';

        if (commandList.current) {
            workerCurrentCommand.textContent = `Current: ${describeWorkerCommand(commandList.current.type, commandList.current.payload)}`;
        } else if (worker.movement?.mode === 'return') {
            workerCurrentCommand.textContent = 'Current: Deposit at base';
        } else if (worker.mining) {
            workerCurrentCommand.textContent = `Current: Mine (${worker.mining.targetX}, ${worker.mining.targetY})`;
        } else {
            workerCurrentCommand.textContent = 'Current: Idle';
        }

        interruptCurrentButton.disabled = !commandList.current && !worker.mining && !worker.movement;
        clearQueueButton.disabled = !commandList.current && commandList.queue.length === 0;

        if (commandList.queue.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'entity-workers-empty';
            empty.textContent = 'No queued commands.';
            workerQueuedCommands.appendChild(empty);
            return;
        }

        for (const queued of commandList.queue) {
            const card = document.createElement('article');
            card.className = 'entity-worker-card';

            const label = document.createElement('div');
            label.className = 'entity-worker-label';
            label.textContent = describeWorkerCommand(queued.type, queued.payload);

            const status = document.createElement('div');
            status.className = 'entity-worker-status';
            status.textContent = queued.id;

            const removeButton = document.createElement('button');
            removeButton.type = 'button';
            removeButton.className = 'ui95-button entity-details-action-btn entity-worker-action';
            removeButton.textContent = 'Kill';
            removeButton.onclick = () => {
                options.onRemoveQueuedWorkerCommand(worker.id, queued.id);
            };

            card.append(label, status, removeButton);
            workerQueuedCommands.appendChild(card);
        }
    };

    const renderEntityInventory = (entity: WorldEntity) => {
        inventoryGrid.textContent = '';

        const adapter = options.inventoryAdapter;
        if (!adapter) {
            inventorySection.hidden = true;
            return;
        }

        const state = adapter.getState();
        const binding = state ? adapter.ensureEntityInventory(entity, state) : null;
        if (!state || !binding || binding.maxSlots <= 0) {
            inventorySection.hidden = true;
            return;
        }

        inventorySection.hidden = false;

        const synced = adapter.syncEntityInventory?.(entity, state, binding) ?? false;
        if (synced) {
            adapter.onStateChange(state);
        }

        const visibleSlots = Math.max(ENTITY_INVENTORY_MIN_VISIBLE_SLOTS, binding.maxSlots);
        const rows = Math.max(1, Math.ceil(visibleSlots / ENTITY_INVENTORY_COLUMNS));
        inventoryTitle.textContent = `Inventory (${binding.maxSlots} slots)`;
        inventoryGrid.style.setProperty('--inventory-columns', String(ENTITY_INVENTORY_COLUMNS));
        inventoryGrid.style.setProperty('--inventory-rows', String(rows));

        const metrics = getInventoryMetrics(frame.root);
        inventoryGrid.style.setProperty('--inventory-cell-size', `${metrics.cellSize}px`);
        inventoryGrid.style.setProperty('--inventory-gap', `${metrics.cellGap}px`);

        const occupancy = buildOccupancyMap(state, binding.inventoryId, 'storage');

        const clearDropPreview = () => {
            inventoryGrid.querySelectorAll('.inventory-cell.is-drop-valid, .inventory-cell.is-drop-invalid').forEach((entry) => {
                entry.classList.remove('is-drop-valid', 'is-drop-invalid');
            });
        };

        const markDropPreview = (item: InventoryItemInstance, definition: InventoryItemDefinition, location: InventoryLocation): boolean => {
            clearDropPreview();
            const inCapacity = isLocationWithinCapacity(definition, location, binding.maxSlots, ENTITY_INVENTORY_COLUMNS, rows);
            const valid = inCapacity && canPlaceAt(state, definition, location, item.id);
            for (const cell of definition.shape.cells) {
                const px = location.x + cell.x;
                const py = location.y + cell.y;
                const slot = inventoryGrid.querySelector(`.inventory-cell[data-x="${px}"][data-y="${py}"]`) as HTMLElement | null;
                if (!slot) continue;
                slot.classList.add(valid ? 'is-drop-valid' : 'is-drop-invalid');
            }
            return valid;
        };

        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < ENTITY_INVENTORY_COLUMNS; x++) {
                const key = `${x}:${y}`;
                const occupied = occupancy.get(key);
                const cellIndex = y * ENTITY_INVENTORY_COLUMNS + x;
                const enabled = cellIndex < binding.maxSlots;

                const cell = document.createElement('div');
                cell.className = 'inventory-cell';
                cell.dataset.section = 'storage';
                cell.dataset.x = String(x);
                cell.dataset.y = String(y);

                if (!enabled) {
                    cell.classList.add('is-disabled');
                }

                if (occupied) {
                    const { item, definition } = occupied;
                    cell.classList.add('is-occupied');
                    cell.style.setProperty('--inventory-item-backdrop', definition.view.backdrop);
                    cell.style.setProperty('--inventory-item-tint', definition.view.tint);
                    if (definition.toolId === state.equippedToolId) {
                        cell.classList.add('is-equipped');
                    }

                    cell.addEventListener('click', () => {
                        adapter.onInspectItem({ item, definition, isEquipped: definition.toolId === state.equippedToolId });
                        if (definition.toolId) {
                            adapter.onEquipTool(definition.toolId);
                        }
                    });

                    if (enabled) {
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
                    }

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

                inventoryGrid.appendChild(cell);
            }
        }

        inventoryGrid.ondragover = (event) => {
            if (!draggingItemId) return;

            const item = state.items.find((entry) => entry.id === draggingItemId);
            const definition = item ? getInventoryItemDefinition(item.definitionId) : undefined;
            if (!item || !definition) return;

            const dropCell = getDropLocation(inventoryGrid, metrics, ENTITY_INVENTORY_COLUMNS, rows, event.clientX, event.clientY);
            if (!dropCell) {
                clearDropPreview();
                return;
            }

            const location: InventoryLocation = {
                inventoryId: binding.inventoryId,
                section: 'storage',
                x: dropCell.x - (draggingAnchorCell?.x ?? 0),
                y: dropCell.y - (draggingAnchorCell?.y ?? 0),
            };

            markDropPreview(item, definition, location);
            event.preventDefault();
        };

        inventoryGrid.ondragleave = (event) => {
            const related = event.relatedTarget as Node | null;
            if (related && inventoryGrid.contains(related)) return;
            clearDropPreview();
        };

        inventoryGrid.ondrop = (event) => {
            const itemId = event.dataTransfer?.getData('text/plain') || draggingItemId;
            if (!itemId) return;

            const item = state.items.find((entry) => entry.id === itemId);
            const definition = item ? getInventoryItemDefinition(item.definitionId) : undefined;
            if (!item || !definition) return;

            const dropCell = getDropLocation(inventoryGrid, metrics, ENTITY_INVENTORY_COLUMNS, rows, event.clientX, event.clientY);
            if (!dropCell) return;

            const location: InventoryLocation = {
                inventoryId: binding.inventoryId,
                section: 'storage',
                x: dropCell.x - (draggingAnchorCell?.x ?? 0),
                y: dropCell.y - (draggingAnchorCell?.y ?? 0),
            };

            event.preventDefault();
            if (!isLocationWithinCapacity(definition, location, binding.maxSlots, ENTITY_INVENTORY_COLUMNS, rows)) {
                clearDropPreview();
                return;
            }

            const result = moveItemWithRules(state, itemId, location);
            if (!result.ok) {
                clearDropPreview();
                return;
            }

            clearDropPreview();
            adapter.onStateChange(state);
            renderEntityInventory(entity);
        };

        inventorySection.hidden = false;
    };

    const unsubscribeInventory = options.inventoryAdapter?.onDidChange?.(() => {
        if (!currentEntity) return;
        renderEntityInventory(currentEntity);
    });

    return {
        openForEntity: (entity) => {
            currentEntity = entity;
            name.textContent = entity.viewDef?.icon
                ? `${entity.viewDef.icon}  ${getEntityLabel(entity.kind, entity.unitType)}`
                : getEntityLabel(entity.kind, entity.unitType);
            summary.textContent = getEntitySummary(entity.kind, entity.unitType);

            setRows([
                ['ID', entity.id],
                ['Position', `${Math.round(entity.x)}, ${Math.round(entity.y)}`],
                ['Visibility', `${entity.visibilityRadius} tiles`],
            ]);
            meta.hidden = false;
            renderEntityInventory(entity);

            actions.hidden = true;
            setActions([]);

            baseWorkersSection.hidden = true;
            workerCommandsSection.hidden = true;
            workersGrid.textContent = '';
            workerQueuedCommands.textContent = '';
            workerCurrentCommand.textContent = '';

            const frameState = frame.getState();
            if (!frameState.open) {
                frame.setOpen(true);
            }
        },
        clearSelection: () => {
            currentEntity = null;
            name.textContent = 'No entity selected';
            summary.textContent = 'Click an entity to inspect it.';
            meta.textContent = '';
            meta.hidden = true;
            inventorySection.hidden = true;
            inventoryGrid.textContent = '';
            actions.hidden = true;
            setActions([]);
            baseWorkersSection.hidden = true;
            workersGrid.textContent = '';
            workerCommandsSection.hidden = true;
            workerQueuedCommands.textContent = '';
            workerCurrentCommand.textContent = '';
        },
        close: () => {
            frame.setOpen(false);
        },
        destroy: () => {
            unsubscribeInventory?.();
            frame.destroy();
        },
    };
}

function buildOccupancyMap(state: InventoryState, inventoryId: string, section: 'storage' | 'hotbar'): Map<string, OccupiedCell> {
    const map = new Map<string, OccupiedCell>();

    for (const item of state.items) {
        if ((item.location.inventoryId ?? 'player') !== inventoryId) continue;
        if (item.location.section !== section) continue;

        const definition = getInventoryItemDefinition(item.definitionId);
        if (!definition) continue;

        const sortedCells = definition.shape.cells.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
        const first = sortedCells[0] ?? { x: 0, y: 0 };
        const last = sortedCells[sortedCells.length - 1] ?? first;

        for (const rel of definition.shape.cells) {
            const x = item.location.x + rel.x;
            const y = item.location.y + rel.y;
            map.set(`${x}:${y}`, {
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
    metrics: InventoryMetrics,
    columns: number,
    rows: number,
    clientX: number,
    clientY: number,
): { x: number; y: number } | null {
    const rect = grid.getBoundingClientRect();
    const totalWidth = columns * metrics.cellSize + (columns - 1) * metrics.cellGap;
    const totalHeight = rows * metrics.cellSize + (rows - 1) * metrics.cellGap;
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    if (localX < 0 || localY < 0 || localX > totalWidth || localY > totalHeight) {
        return null;
    }

    const x = Math.min(columns - 1, Math.max(0, Math.floor(localX / (metrics.cellSize + metrics.cellGap))));
    const y = Math.min(rows - 1, Math.max(0, Math.floor(localY / (metrics.cellSize + metrics.cellGap))));
    return { x, y };
}

function isLocationWithinCapacity(
    definition: InventoryItemDefinition,
    location: InventoryLocation,
    capacity: number,
    columns: number,
    rows: number,
): boolean {
    for (const cell of definition.shape.cells) {
        const x = location.x + cell.x;
        const y = location.y + cell.y;
        if (x < 0 || y < 0 || x >= columns || y >= rows) return false;
        if ((y * columns + x) >= capacity) return false;
    }
    return true;
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
