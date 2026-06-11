import type { WorkerEntityCommandList, WorldEntity } from '../world/WorldModel';
import { createFloatingWindow } from './FloatingWindow';
import type { EntityDetailsWindowMeta } from '../meta/GameMetaStore';

type EntityDetailsWindowOptions = {
    onDeleteBeacon: (entityId: string) => void;
    onSpawnWorker: (buildingId: string) => void;
    onDeployWorker: (workerId: string) => void;
    onRecallWorker: (workerId: string) => void;
    onRecallAllWorkers: (buildingId: string) => void;
    onInterruptWorkerCommand: (workerId: string) => void;
    onClearWorkerCommands: (workerId: string) => void;
    onRemoveQueuedWorkerCommand: (workerId: string, commandId: string) => void;
    onBuild: (entityId: string) => void;
    getWorkersForBuilding: (buildingId: string) => ReadonlyArray<WorldEntity>;
    initialWindowState: EntityDetailsWindowMeta;
    onWindowStateChange: (state: EntityDetailsWindowMeta) => void;
};

export type EntityDetailsWindow = {
    openForEntity: (entity: WorldEntity) => void;
    clearSelection: () => void;
    close: () => void;
    destroy: () => void;
};

const BEACON_REFUND_ORE = 5;

export function createEntityDetailsWindow(options: EntityDetailsWindowOptions): EntityDetailsWindow {
    const frame = createFloatingWindow({
        title: 'Entity Details',
        className: 'entity-details-window',
        resizable: true,
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

    const setActions = (entries: Array<{ label: string; onClick: () => void; disabled?: boolean }>) => {
        actions.textContent = '';
        for (const entry of entries) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'ui95-button';
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
    interruptCurrentButton.className = 'ui95-button';
    interruptCurrentButton.textContent = 'Interrupt Current';

    const clearQueueButton = document.createElement('button');
    clearQueueButton.type = 'button';
    clearQueueButton.className = 'ui95-button';
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

    panel.append(name, summary, meta, actions, baseWorkersSection, workerCommandsSection);
    frame.content.appendChild(panel);

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
            label.textContent = worker.unitType === 'basic-worker' ? 'Basic Worker' : 'Worker';

            const status = document.createElement('div');
            status.className = 'entity-worker-status';
            status.textContent = worker.deployed ? `Deployed (${worker.x}, ${worker.y})` : 'Docked';

            const action = document.createElement('button');
            action.type = 'button';
            action.className = 'ui95-button entity-worker-action';
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
            {
                label: 'Spawn Basic Worker',
                onClick: () => {
                    options.onSpawnWorker(baseEntity.id);
                },
            },
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
            removeButton.className = 'ui95-button entity-worker-action';
            removeButton.textContent = 'Kill';
            removeButton.onclick = () => {
                options.onRemoveQueuedWorkerCommand(worker.id, queued.id);
            };

            card.append(label, status, removeButton);
            workerQueuedCommands.appendChild(card);
        }
    };

    return {
        openForEntity: (entity) => {
            const entityLabel = entity.kind === 'base'
                ? 'Space Station'
                : entity.kind === 'beacon'
                    ? 'Beacon'
                    : entity.kind === 'player'
                        ? 'Hero'
                        : 'Worker';
            name.textContent = entityLabel;
            if (entity.kind === 'base') {
                summary.textContent = 'Main operations hub. Spawn and manage workers attached to this station.';
            } else if (entity.kind === 'beacon') {
                summary.textContent = 'Remote visibility anchor. Remove it to reclaim part of the build cost.';
            } else if (entity.kind === 'player') {
                summary.textContent = 'Main hero unit. Holds primary tools and inventory for this run.';
            } else {
                summary.textContent = 'Basic worker unit. Can be deployed in the field or recalled to home base.';
            }

            setRows([
                ['ID', entity.id],
                ['Position', `${entity.x}, ${entity.y}`],
                ['Visibility', `${entity.visibilityRadius} tiles`],
            ]);
            meta.hidden = false;

            if (entity.kind === 'beacon') {
                setActions([
                    {
                        label: `Delete Beacon (+${BEACON_REFUND_ORE} ore refund)`,
                        onClick: () => {
                            options.onDeleteBeacon(entity.id);
                        },
                    },
                ]);
            } else if (entity.kind === 'player') {
                setActions([
                    {
                        label: 'Build',
                        onClick: () => {
                            options.onBuild(entity.id);
                        },
                    },
                ]);
            } else if (entity.kind === 'worker') {
                setActions([
                    {
                        label: entity.deployed ? 'Return To Base' : 'Deploy Worker',
                        onClick: () => {
                            if (entity.deployed) {
                                options.onRecallWorker(entity.id);
                            } else {
                                options.onDeployWorker(entity.id);
                            }
                        },
                    },
                    {
                        label: 'Interrupt Current',
                        onClick: () => {
                            options.onInterruptWorkerCommand(entity.id);
                        },
                    },
                    {
                        label: 'Clear Queue',
                        onClick: () => {
                            options.onClearWorkerCommands(entity.id);
                        },
                    },
                ]);
            } else {
                setActions([]);
            }

            if (entity.kind === 'base') {
                baseWorkersSection.hidden = false;
                workerCommandsSection.hidden = true;
                renderBaseWorkers(entity);
            } else if (entity.kind === 'worker') {
                baseWorkersSection.hidden = true;
                workerCommandsSection.hidden = false;
                renderWorkerCommandQueue(entity);
            } else {
                baseWorkersSection.hidden = true;
                workerCommandsSection.hidden = true;
                workersGrid.textContent = '';
            }

            frame.setOpen(true);
            frame.setMinimized(false);
        },
        clearSelection: () => {
            name.textContent = 'No entity selected';
            summary.textContent = 'Click an entity to inspect it.';
            meta.textContent = '';
            meta.hidden = true;
            setActions([]);
            baseWorkersSection.hidden = true;
            workersGrid.textContent = '';
            workerCommandsSection.hidden = true;
            workerQueuedCommands.textContent = '';
            workerCurrentCommand.textContent = '';
        },
        close: () => {
            frame.setOpen(false);
            frame.setMinimized(false);
        },
        destroy: () => {
            frame.destroy();
        },
    };
}
