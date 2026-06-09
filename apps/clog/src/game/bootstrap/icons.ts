export type ActionIcon = 'target' | 'map' | 'debug' | 'inventory';

export function makeIconSvg(type: ActionIcon): string {
    if (type === 'target') {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="square"/></svg>';
    }
    if (type === 'map') {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5l5-2 5 2 8-3v14l-8 3-5-2-5 2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 4.5v15M13 6.5v15" stroke="currentColor" stroke-width="1.6"/></svg>';
    }
    if (type === 'inventory') {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4 9h16M8 5v14M14 5v14" stroke="currentColor" stroke-width="1.6"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16M4 12h16" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="5.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>';
}

export function createActionButton(icon: ActionIcon, label: string, tooltip: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ui95-button action-button';
    button.title = tooltip;
    button.setAttribute('aria-label', label);
    button.innerHTML = `<span class="action-button-icon" aria-hidden="true">${makeIconSvg(icon)}</span>`;
    return button;
}

export function getToolIconSvg(toolId: string): string {
    return toolId.includes('mallet')
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="4" width="9" height="6" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 10l-6 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M5 19l2-2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18h8l5-12h-8L4 18Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 6l3-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
}
