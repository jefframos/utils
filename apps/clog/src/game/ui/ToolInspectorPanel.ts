import type { ToolDefinition } from '../core/ToolComponent';
import { createFloatingWindow, type FloatingWindowState } from './FloatingWindow';
import type { ToolInspectorWindowMeta } from '../meta/GameMetaStore';

type ToolInspectorPanelOptions = {
    tools: ToolDefinition[];
    initialToolId: string;
    initialWindowState: ToolInspectorWindowMeta;
    onWindowStateChange: (state: ToolInspectorWindowMeta) => void;
};

export type ToolInspectorPanel = {
    open: () => void;
    setActiveTool: (toolId: string) => void;
    destroy: () => void;
};

export function createToolInspectorPanel(options: ToolInspectorPanelOptions): ToolInspectorPanel {
    const initialState: FloatingWindowState = options.initialWindowState;

    const frame = createFloatingWindow({
        title: 'Tool Inspector',
        className: 'tool-inspector-window',
        initialState,
        onStateChange: (state) => {
            options.onWindowStateChange(state);
        },
    });

    const root = document.createElement('div');
    root.className = 'tool-inspector-panel';

    const activeLabel = document.createElement('p');
    activeLabel.className = 'tool-inspector-active';

    const list = document.createElement('ul');
    list.className = 'tool-inspector-list';

    const details = document.createElement('dl');
    details.className = 'tool-inspector-details';

    const detailRows = {
        damage: createDetailRow('Damage'),
        click: createDetailRow('Click'),
        hold: createDetailRow('Hold'),
        hps: createDetailRow('Hold Rate'),
        mode: createDetailRow('Mode'),
        radius: createDetailRow('Radius'),
    };
    details.append(
        detailRows.damage.term,
        detailRows.damage.value,
        detailRows.click.term,
        detailRows.click.value,
        detailRows.hold.term,
        detailRows.hold.value,
        detailRows.hps.term,
        detailRows.hps.value,
        detailRows.mode.term,
        detailRows.mode.value,
        detailRows.radius.term,
        detailRows.radius.value,
    );

    root.append(activeLabel, list, details);
    frame.content.appendChild(root);

    let activeToolId = options.initialToolId;

    const render = () => {
        const activeTool = options.tools.find((entry) => entry.id === activeToolId) ?? options.tools[0];
        if (!activeTool) return;

        activeToolId = activeTool.id;
        activeLabel.textContent = `Active: ${activeTool.name}`;

        list.textContent = '';
        for (const tool of options.tools) {
            const item = document.createElement('li');
            item.className = 'tool-inspector-item';
            item.textContent = `${tool.name} (${tool.id})`;
            item.classList.toggle('is-active', tool.id === activeTool.id);
            list.appendChild(item);
        }

        detailRows.damage.value.textContent = String(toolDamage(activeTool));
        detailRows.click.value.textContent = activeTool.hitOnClick ? 'Yes' : 'No';
        detailRows.hold.value.textContent = activeTool.hitOnHold ? 'Yes' : 'No';
        detailRows.hps.value.textContent = activeTool.hitOnHold ? `${activeTool.hitsPerSecond.toFixed(1)} / s` : '-';
        detailRows.mode.value.textContent = activeTool.damageMode;
        detailRows.radius.value.textContent = activeTool.damageMode === 'blunt' ? String(activeTool.bluntRadius) : '0';
    };

    render();

    return {
        open: () => {
            frame.setOpen(true);
            frame.setMinimized(false);
        },
        setActiveTool: (toolId: string) => {
            activeToolId = toolId;
            render();
        },
        destroy: () => {
            frame.destroy();
        },
    };
}

function createDetailRow(label: string): { term: HTMLElement; value: HTMLElement } {
    const term = document.createElement('dt');
    term.textContent = label;
    const value = document.createElement('dd');
    return { term, value };
}

function toolDamage(tool: ToolDefinition): number {
    return Math.max(0, Math.floor(tool.tileDamage));
}
