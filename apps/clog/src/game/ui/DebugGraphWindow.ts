import type { FloatingWindowState } from './FloatingWindow';
import { createFloatingWindow } from './FloatingWindow';

type DebugGraphWindowOptions = {
    initialWindowState: FloatingWindowState;
    onWindowStateChange: (state: FloatingWindowState) => void;
    getModuleIds: () => string[];
    getBehaviorIds: () => string[];
    getBiomeGraphMermaid: () => string;
    isOverlayEnabled: () => boolean;
    onToggleOverlay: (enabled: boolean) => void;
};

export type DebugGraphWindow = {
    open: () => void;
    close: () => void;
    toggle: () => void;
    refresh: () => void;
    destroy: () => void;
};

function normalizeNodeRef(ref: string): string {
    const match = ref.trim().match(/^([A-Za-z0-9_]+)/);
    return match?.[1] ?? ref.trim();
}

function parseMermaidEdges(mermaid: string): Array<{ from: string; to: string }> {
    const edges: Array<{ from: string; to: string }> = [];

    for (const line of mermaid.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.includes('-->')) continue;
        const [rawFrom, rawTo] = trimmed.split('-->').map((entry) => entry.trim());
        if (!rawFrom || !rawTo) continue;
        edges.push({ from: normalizeNodeRef(rawFrom), to: normalizeNodeRef(rawTo) });
    }

    return edges;
}

function parseMermaidLabels(mermaid: string): Map<string, string> {
    const labels = new Map<string, string>();

    for (const line of mermaid.split('\n')) {
        const matches = line.matchAll(/([A-Za-z0-9_]+)\["([^"]+)"\]/g);
        for (const match of matches) {
            const [, id, label] = match;
            labels.set(id, label.replace(/\\n/g, '\n'));
        }
    }

    return labels;
}

function renderGraphSvg(
    host: SVGSVGElement,
    labels: Map<string, string>,
    edges: Array<{ from: string; to: string }>,
): void {
    host.replaceChildren();

    const nodeIds = new Set<string>();
    for (const id of labels.keys()) nodeIds.add(id);
    for (const edge of edges) {
        nodeIds.add(edge.from);
        nodeIds.add(edge.to);
    }

    if (nodeIds.size === 0) {
        host.setAttribute('viewBox', '0 0 640 120');
        return;
    }

    const indegree = new Map<string, number>();
    for (const id of nodeIds) indegree.set(id, 0);
    for (const edge of edges) {
        indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    }

    const levels = new Map<string, number>();
    const queue: string[] = [];
    for (const id of nodeIds) {
        if ((indegree.get(id) ?? 0) === 0) {
            levels.set(id, 0);
            queue.push(id);
        }
    }

    while (queue.length > 0) {
        const current = queue.shift();
        if (!current) continue;
        const baseLevel = levels.get(current) ?? 0;
        for (const edge of edges) {
            if (edge.from !== current) continue;
            const nextLevel = baseLevel + 1;
            if ((levels.get(edge.to) ?? -1) < nextLevel) {
                levels.set(edge.to, nextLevel);
            }
            queue.push(edge.to);
        }
    }

    let fallbackLevel = Math.max(0, ...Array.from(levels.values()));
    for (const id of nodeIds) {
        if (!levels.has(id)) {
            fallbackLevel += 1;
            levels.set(id, fallbackLevel);
        }
    }

    const columns = new Map<number, string[]>();
    for (const id of nodeIds) {
        const level = levels.get(id) ?? 0;
        const col = columns.get(level) ?? [];
        col.push(id);
        columns.set(level, col);
    }

    for (const col of columns.values()) {
        col.sort((a, b) => a.localeCompare(b));
    }

    const nodeSize = { w: 170, h: 42, xGap: 70, yGap: 18 };
    const positions = new Map<string, { x: number; y: number }>();
    const levelKeys = Array.from(columns.keys()).sort((a, b) => a - b);
    for (const level of levelKeys) {
        const ids = columns.get(level) ?? [];
        ids.forEach((id, index) => {
            const x = 18 + level * (nodeSize.w + nodeSize.xGap);
            const y = 18 + index * (nodeSize.h + nodeSize.yGap);
            positions.set(id, { x, y });
        });
    }

    const width = Math.max(720, 40 + levelKeys.length * (nodeSize.w + nodeSize.xGap));
    const maxRows = Math.max(...Array.from(columns.values()).map((col) => col.length));
    const height = Math.max(220, 40 + maxRows * (nodeSize.h + nodeSize.yGap));
    host.setAttribute('viewBox', `0 0 ${width} ${height}`);

    const ns = 'http://www.w3.org/2000/svg';
    for (const edge of edges) {
        const from = positions.get(edge.from);
        const to = positions.get(edge.to);
        if (!from || !to) continue;

        const line = document.createElementNS(ns, 'line');
        line.setAttribute('x1', String(from.x + nodeSize.w));
        line.setAttribute('y1', String(from.y + nodeSize.h * 0.5));
        line.setAttribute('x2', String(to.x));
        line.setAttribute('y2', String(to.y + nodeSize.h * 0.5));
        line.setAttribute('stroke', '#4b5563');
        line.setAttribute('stroke-width', '1.5');
        host.append(line);
    }

    for (const id of nodeIds) {
        const pos = positions.get(id);
        if (!pos) continue;
        const label = labels.get(id) ?? id;

        const rect = document.createElementNS(ns, 'rect');
        rect.setAttribute('x', String(pos.x));
        rect.setAttribute('y', String(pos.y));
        rect.setAttribute('width', String(nodeSize.w));
        rect.setAttribute('height', String(nodeSize.h));
        rect.setAttribute('rx', '6');
        rect.setAttribute('fill', '#e5e7eb');
        rect.setAttribute('stroke', '#9ca3af');
        host.append(rect);

        const text = document.createElementNS(ns, 'text');
        text.setAttribute('x', String(pos.x + 8));
        text.setAttribute('y', String(pos.y + 16));
        text.setAttribute('fill', '#111827');
        text.setAttribute('font-size', '11');
        text.setAttribute('font-family', 'Verdana, Geneva, sans-serif');

        const lines = label.split('\n').slice(0, 2);
        lines.forEach((lineText, index) => {
            const tspan = document.createElementNS(ns, 'tspan');
            tspan.setAttribute('x', String(pos.x + 8));
            tspan.setAttribute('dy', index === 0 ? '0' : '12');
            tspan.textContent = lineText;
            text.append(tspan);
        });

        host.append(text);
    }
}

export function createDebugGraphWindow(options: DebugGraphWindowOptions): DebugGraphWindow {
    const frame = createFloatingWindow({
        title: 'Debug Graph',
        className: 'debug-graph-window',
        initialState: options.initialWindowState,
        onStateChange: options.onWindowStateChange,
    });

    const root = document.createElement('div');
    root.className = 'debug-graph-panel';

    const controls = document.createElement('div');
    controls.className = 'debug-graph-controls';

    const overlayToggle = document.createElement('button');
    overlayToggle.type = 'button';
    overlayToggle.className = 'ui95-button';

    const refreshButton = document.createElement('button');
    refreshButton.type = 'button';
    refreshButton.className = 'ui95-button';
    refreshButton.textContent = 'Refresh';

    const copyMermaidButton = document.createElement('button');
    copyMermaidButton.type = 'button';
    copyMermaidButton.className = 'ui95-button';
    copyMermaidButton.textContent = 'Copy Mermaid';

    controls.append(overlayToggle, refreshButton, copyMermaidButton);

    const moduleTitle = document.createElement('h4');
    moduleTitle.textContent = 'Runtime Modules';

    const moduleList = document.createElement('pre');

    const behaviorTitle = document.createElement('h4');
    behaviorTitle.textContent = 'Engine Behaviors';

    const behaviorList = document.createElement('pre');

    const connectionTitle = document.createElement('h4');
    connectionTitle.textContent = 'Biome Node Connections';

    const graphCanvas = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    graphCanvas.classList.add('debug-graph-svg');

    const connectionList = document.createElement('pre');

    const mermaidTitle = document.createElement('h4');
    mermaidTitle.textContent = 'Mermaid Source';

    const mermaidSource = document.createElement('pre');

    root.append(
        controls,
        moduleTitle,
        moduleList,
        behaviorTitle,
        behaviorList,
        connectionTitle,
        graphCanvas,
        connectionList,
        mermaidTitle,
        mermaidSource,
    );
    frame.content.append(root);

    const refresh = () => {
        const moduleIds = options.getModuleIds();
        const behaviorIds = options.getBehaviorIds();
        const mermaid = options.getBiomeGraphMermaid();
        const edges = parseMermaidEdges(mermaid);

        const overlayEnabled = options.isOverlayEnabled();
        overlayToggle.textContent = overlayEnabled ? 'Overlay: ON' : 'Overlay: OFF';

        moduleList.textContent = moduleIds.length > 0
            ? moduleIds.map((id) => `- ${id}`).join('\n')
            : 'No modules registered.';

        behaviorList.textContent = behaviorIds.length > 0
            ? behaviorIds.map((id) => `- ${id}`).join('\n')
            : 'No engine behaviors registered.';

        connectionList.textContent = edges.length > 0
            ? edges.map((edge) => `${edge.from} -> ${edge.to}`).join('\n')
            : 'No graph edges parsed.';

        const labels = parseMermaidLabels(mermaid);
        renderGraphSvg(graphCanvas, labels, edges);

        mermaidSource.textContent = mermaid;
    };

    overlayToggle.addEventListener('click', () => {
        options.onToggleOverlay(!options.isOverlayEnabled());
        refresh();
    });

    refreshButton.addEventListener('click', () => {
        refresh();
    });

    copyMermaidButton.addEventListener('click', async () => {
        const mermaid = options.getBiomeGraphMermaid();
        try {
            await navigator.clipboard.writeText(mermaid);
            copyMermaidButton.textContent = 'Copied';
        } catch {
            copyMermaidButton.textContent = 'Copy Failed';
        }
        setTimeout(() => {
            copyMermaidButton.textContent = 'Copy Mermaid';
        }, 1200);
    });

    const open = () => {
        frame.setOpen(true);
        frame.setMinimized(false);
        refresh();
    };

    const close = () => {
        frame.setOpen(false);
    };

    const toggle = () => {
        const state = frame.getState();
        if (state.open && !state.minimized) {
            close();
            return;
        }
        open();
    };

    return {
        open,
        close,
        toggle,
        refresh,
        destroy: () => {
            frame.destroy();
        },
    };
}
