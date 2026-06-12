import { getEntityLabel } from '../content/entities.ts';
import { WORKER_DEFINITIONS, type WorkerUnitType } from '../content/workers';
import type { BaseSlotSummary, WorldEntity } from '../world/WorldModel';
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
            width: 360,
            height: 340,
        },
    });

    const panel = document.createElement('div');
    panel.className = 'workers-window-panel';

    const summary = document.createElement('p');
    summary.className = 'workers-window-summary';

    const spawnActions = document.createElement('div');
    spawnActions.className = 'workers-window-actions';

    const workersGrid = document.createElement('div');
    workersGrid.className = 'entity-workers-grid';

    const footerActions = document.createElement('div');
    footerActions.className = 'workers-window-actions';

    panel.append(summary, spawnActions, workersGrid, footerActions);
    frame.content.appendChild(panel);

    let currentBaseId: string | null = null;

    const render = () => {
        if (!currentBaseId) return;

        const workers = options.getWorkersForBuilding(currentBaseId);
        const slots = options.getBaseSlotSummary(currentBaseId);

        if (slots) {
            summary.textContent = `Slots: ${slots.used}/${slots.capacity} used (Hero ${slots.heroReserved}, Workers ${slots.workersAssigned})`;
        } else {
            summary.textContent = 'Slots: unknown';
        }

        spawnActions.textContent = '';
        for (const definition of Object.values(WORKER_DEFINITIONS)) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'ui95-button entity-details-action-btn';
            button.textContent = `Spawn ${definition.name}`;
            button.disabled = !!slots && slots.available <= 0;
            button.addEventListener('click', () => {
                if (!currentBaseId) return;
                options.onSpawnUnit(currentBaseId, definition.id);
            });
            spawnActions.appendChild(button);
        }

        workersGrid.textContent = '';
        if (workers.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'entity-workers-empty';
            empty.textContent = 'No workers assigned to this station.';
            workersGrid.appendChild(empty);
        } else {
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
                status.textContent = worker.deployed
                    ? `Deployed (${Math.round(worker.x)}, ${Math.round(worker.y)})`
                    : 'Docked';

                const action = document.createElement('button');
                action.type = 'button';
                action.className = 'ui95-button entity-details-action-btn entity-worker-action';
                action.textContent = worker.deployed ? 'Return' : 'Deploy';
                action.addEventListener('click', () => {
                    if (worker.deployed) {
                        options.onRecallWorker(worker.id);
                    } else {
                        options.onDeployWorker(worker.id);
                    }
                });

                card.append(label, status, action);
                workersGrid.appendChild(card);
            }
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
