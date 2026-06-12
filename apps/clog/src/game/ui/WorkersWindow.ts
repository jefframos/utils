import { getEntityDefinition, getEntityLabel } from '../content/entities.ts';
import { WORKER_DEFINITIONS, type WorkerUnitType } from '../content/workers';
import type { BaseSlotSummary, WorldEntity } from '../world/WorldModel';
import { getEntityCost } from '../world/entityDefinitions.ts';
import { createFloatingWindow } from './FloatingWindow';

type WorkersWindowOptions = {
    onSpawnUnit: (buildingId: string, unitType: WorkerUnitType) => void;
    onDeployWorker: (workerId: string) => void;
    onRecallWorker: (workerId: string) => void;
    onRecallAllWorkers: (buildingId: string) => void;
    getWorkersForBuilding: (buildingId: string) => ReadonlyArray<WorldEntity>;
    getBaseSlotSummary: (buildingId: string) => BaseSlotSummary | null;
};

export type WorkersWindow = {
    openForBase: (base: WorldEntity) => void;
    refresh: () => void;
    close: () => void;
    destroy: () => void;
};

export function createWorkersWindow(options: WorkersWindowOptions): WorkersWindow {
    const frame = createFloatingWindow({
        title: 'Station Workers',
        className: 'workers-window',
        resizable: false,
        initialState: {
            open: false,
            minimized: false,
            left: 24,
            top: 280,
            width: 520,
            height: 420,
        },
    });

    const panel = document.createElement('div');
    panel.className = 'workers-window-panel';

    const summary = document.createElement('p');
    summary.className = 'workers-window-summary';
    summary.textContent = 'Slots: unknown';

    const workerSection = document.createElement('section');
    workerSection.className = 'entity-inventory-section workers-window-section';

    const workerTitle = document.createElement('h5');
    workerTitle.className = 'entity-workers-title';
    workerTitle.textContent = 'Workers';

    const workerGrid = document.createElement('div');
    workerGrid.className = 'inventory-grid workers-window-grid';

    workerSection.append(workerTitle, summary, workerGrid);

    const spawnSection = document.createElement('section');
    spawnSection.className = 'entity-workers-section workers-window-spawn-section';

    const spawnTitle = document.createElement('h5');
    spawnTitle.className = 'entity-workers-title';
    spawnTitle.textContent = 'Spawn Workers';

    const spawnActions = document.createElement('div');
    spawnActions.className = 'workers-window-actions';
    spawnSection.append(spawnTitle, spawnActions);

    const footerActions = document.createElement('div');
    footerActions.className = 'workers-window-actions';

    panel.append(workerSection, spawnSection, footerActions);
    frame.content.appendChild(panel);

    let currentBaseId: string | null = null;

    const render = () => {
        if (!currentBaseId) return;

        const workers = options.getWorkersForBuilding(currentBaseId);
        const slots = options.getBaseSlotSummary(currentBaseId);
        const capacity = slots?.capacity ?? workers.length;
        const columns = Math.min(3, Math.max(1, capacity));
        const rows = Math.max(1, Math.ceil(capacity / columns));

        if (slots) {
            summary.textContent = `${slots.used} / ${slots.capacity} occupied`;
        } else {
            summary.textContent = 'Slots: unknown';
        }

        workerGrid.textContent = '';
        workerGrid.style.setProperty('--inventory-columns', String(columns));
        workerGrid.style.setProperty('--inventory-rows', String(rows));
        workerGrid.style.setProperty('--inventory-cell-size', '58px');
        workerGrid.style.setProperty('--inventory-gap', '6px');

        for (let index = 0; index < capacity; index++) {
            const worker = workers[index] ?? null;
            const cell = document.createElement('div');
            cell.className = 'inventory-cell workers-window-cell';
            cell.dataset.slot = String(index + 1);
            cell.title = worker
                ? `${getEntityLabel(worker.kind, worker.unitType)}`
                : `Empty slot ${index + 1}`;

            if (worker) {
                cell.classList.add('is-occupied');
                if (worker.viewDef?.backdrop) {
                    cell.style.setProperty('--inventory-item-backdrop', worker.viewDef.backdrop);
                }
                if (worker.viewDef?.tint) {
                    cell.style.setProperty('--inventory-item-tint', worker.viewDef.tint);
                }

                const icon = document.createElement('span');
                icon.className = 'inventory-item-cell-icon';
                icon.textContent = worker.viewDef?.icon ?? 'W';

                const label = document.createElement('span');
                label.className = 'workers-window-cell-label';
                label.textContent = getEntityLabel(worker.kind, worker.unitType);

                const status = document.createElement('span');
                status.className = 'workers-window-cell-status';
                status.textContent = worker.deployed ? 'Deployed' : 'Docked';

                const action = document.createElement('button');
                action.type = 'button';
                action.className = 'ui95-button workers-window-cell-action';
                action.textContent = worker.deployed ? 'Recall' : 'Deploy';
                action.addEventListener('click', () => {
                    if (worker.deployed) {
                        options.onRecallWorker(worker.id);
                    } else {
                        options.onDeployWorker(worker.id);
                    }
                });

                cell.append(icon, label, status, action);
            }

            workerGrid.appendChild(cell);
        }

        spawnActions.textContent = '';
        for (const definition of Object.values(WORKER_DEFINITIONS)) {
            const entityDef = getEntityDefinition('worker', definition.id);
            const spawnCost = getEntityCost('worker-miner').ore;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'ui95-button workers-window-spawn-card';
            button.disabled = !!slots && slots.available <= 0;
            button.addEventListener('click', () => {
                if (!currentBaseId) return;
                options.onSpawnUnit(currentBaseId, definition.id);
            });

            const icon = document.createElement('span');
            icon.className = 'workers-window-spawn-icon';
            icon.textContent = entityDef.viewDef.icon;

            const text = document.createElement('span');
            text.className = 'workers-window-spawn-text';

            const name = document.createElement('span');
            name.className = 'workers-window-spawn-name';
            name.textContent = definition.name;

            const cost = document.createElement('span');
            cost.className = 'workers-window-spawn-cost';
            cost.textContent = `Cost: ${spawnCost} ore`;

            text.append(name, cost);
            button.append(icon, text);
            spawnActions.appendChild(button);
        }

        footerActions.textContent = '';
        const recallAll = document.createElement('button');
        recallAll.type = 'button';
        recallAll.className = 'ui95-button entity-details-action-btn';
        recallAll.textContent = 'Recall All Workers';
        recallAll.disabled = workers.every((entry) => !entry.deployed);
        recallAll.addEventListener('click', () => {
            if (!currentBaseId) return;
            options.onRecallAllWorkers(currentBaseId);
        });
        footerActions.appendChild(recallAll);
    };

    return {
        openForBase: (base) => {
            currentBaseId = base.id;
            render();
            frame.setOpen(true);
        },
        refresh: () => {
            if (!currentBaseId) return;
            if (!frame.getState().open) return;
            render();
        },
        close: () => {
            frame.setOpen(false);
        },
        destroy: () => {
            frame.destroy();
        },
    };
}
