import type { ContextMenuController, ContextMenuItem } from './ContextMenuTemplate';

export type QueuedCommandGroup = {
    id: string;
    type: string;
    label: string;
    count: number;
    paused?: boolean;
};

export type QueuedCommandItemOptions = {
    contextMenu: ContextMenuController;
    menuDirection?: 'down' | 'up';
    onRemove?: (commandId: string) => void;
    onInterrupt?: () => void;
    onTogglePause?: () => void;
    isSelected?: boolean;
};

export type QueuedCommandItem = {
    render: () => HTMLElement;
    setSelected: (selected: boolean) => void;
    destroy: () => void;
};

export function createQueuedCommandItem(group: QueuedCommandGroup, options: QueuedCommandItemOptions): QueuedCommandItem {
    const item = document.createElement('div');
    item.className = 'entity-footer-queue-item';
    item.dataset.commandId = group.id;

    const update = () => {
        item.textContent = '';

        const label = document.createElement('span');
        label.className = 'entity-footer-queue-item-label';
        label.textContent = group.count > 1 ? `${group.type}(${group.count})` : group.type;
        label.title = group.label;

        if (group.paused) {
            item.classList.add('paused');
            const pausedBadge = document.createElement('span');
            pausedBadge.className = 'entity-footer-queue-item-paused';
            pausedBadge.textContent = '⏸';
            item.appendChild(pausedBadge);
        } else {
            item.classList.remove('paused');
        }

        item.appendChild(label);

        // Remove button for queued commands
        if (group.id.startsWith('queued-') && options.onRemove) {
            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'entity-footer-queue-remove';
            removeBtn.title = 'Remove this action';
            removeBtn.textContent = '✕';
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const actualId = group.id.replace(/^queued-/, '');
                options.onRemove?.(actualId);
            });
            item.appendChild(removeBtn);
        }

        if (options.isSelected) {
            item.classList.add('selected');
        } else {
            item.classList.remove('selected');
        }
    };

    // Context menu on right-click
    item.addEventListener('contextmenu', (e) => {
        e.preventDefault();

        const menuItems: ContextMenuItem[] = [];

        // Pause/Resume option
        if (options.onTogglePause) {
            menuItems.push({
                id: 'toggle-pause',
                label: group.paused ? '▶ Resume' : '⏸ Pause',
                onSelect: () => {
                    options.onTogglePause?.();
                },
            });
        }

        // Delete option
        if (group.id.startsWith('queued-') && options.onRemove) {
            menuItems.push({
                id: 'delete',
                label: '🗑 Delete',
                onSelect: () => {
                    const actualId = group.id.replace(/^queued-/, '');
                    options.onRemove?.(actualId);
                },
            });
        } else if (group.id.startsWith('current-') && options.onInterrupt) {
            menuItems.push({
                id: 'interrupt',
                label: '⏹ Interrupt',
                onSelect: () => {
                    options.onInterrupt?.();
                },
            });
        }

        if (menuItems.length > 0) {
            options.contextMenu.open({
                x: e.clientX,
                y: e.clientY,
                menuDirection: options.menuDirection ?? 'up',
                items: menuItems,
            });
        }
    });

    update();

    return {
        render: () => item,
        setSelected: (selected: boolean) => {
            options.isSelected = selected;
            update();
        },
        destroy: () => {
            item.remove();
        },
    };
}
