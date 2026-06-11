export type ContextMenuItem = {
    id: string;
    label: string;
    onSelect?: () => void;
    disabled?: boolean;
    disabledReason?: string;
    children?: ContextMenuItem[];
    submenuDirection?: 'right' | 'up';
};

export type ContextMenuState = {
    x: number;
    y: number;
    menuDirection?: 'down' | 'up';
    items: ContextMenuItem[];
};

export type ContextMenuController = {
    open: (state: ContextMenuState) => void;
    close: () => void;
    destroy: () => void;
    getRoot: () => HTMLDivElement;
};

export function createContextMenuTemplate(className = ''): ContextMenuController {
    const root = document.createElement('div');
    root.className = ['context-menu-template', className].filter(Boolean).join(' ');
    root.hidden = true;
    root.setAttribute('role', 'menu');

    const submenu = document.createElement('div');
    submenu.className = ['context-menu-template', 'context-submenu-template', className].filter(Boolean).join(' ');
    submenu.hidden = true;
    submenu.setAttribute('role', 'menu');
    root.appendChild(submenu);

    let activeState: ContextMenuState | null = null;

    const closeSubmenu = () => {
        submenu.hidden = true;
        submenu.innerHTML = '';
    };

    const renderSubmenu = (parentButton: HTMLButtonElement, children: ContextMenuItem[], direction: 'right' | 'up' = 'right') => {
        submenu.innerHTML = '';
        submenu.classList.toggle('is-dropup', direction === 'up');
        for (const item of children) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'context-menu-item';
            button.textContent = item.label;
            button.setAttribute('role', 'menuitem');
            button.disabled = item.disabled === true;
            if (item.disabledReason) {
                button.title = item.disabledReason;
            }

            if (item.children && item.children.length > 0) {
                button.classList.add('has-submenu');
                button.addEventListener('mouseenter', () => {
                    renderSubmenu(button, item.children ?? [], item.submenuDirection ?? 'right');
                });
            }

            button.addEventListener('click', () => {
                if (button.disabled) return;
                if (item.children && item.children.length > 0) {
                    renderSubmenu(button, item.children, item.submenuDirection ?? 'right');
                    return;
                }
                item.onSelect?.();
                close();
            });

            submenu.appendChild(button);
        }

        const parentRect = parentButton.getBoundingClientRect();
        const menuRect = root.getBoundingClientRect();

        if (direction === 'up') {
            submenu.style.left = `${Math.max(2, parentRect.left - menuRect.left)}px`;
            submenu.style.top = '2px';
            submenu.hidden = false;
            const submenuRect = submenu.getBoundingClientRect();
            const dropupTop = parentRect.top - menuRect.top - submenuRect.height + parentRect.height;
            submenu.style.top = `${Math.max(2, dropupTop)}px`;
            return;
        }

        submenu.style.left = `${Math.max(2, parentRect.right - menuRect.left - 2)}px`;
        submenu.style.top = `${Math.max(2, parentRect.top - menuRect.top)}px`;
        submenu.hidden = false;
    };

    const close = () => {
        root.hidden = true;
        closeSubmenu();
        for (const node of Array.from(root.querySelectorAll('.context-menu-item'))) {
            node.remove();
        }
        activeState = null;
    };

    const open = (state: ContextMenuState) => {
        activeState = state;
        closeSubmenu();
        for (const node of Array.from(root.querySelectorAll('.context-menu-item'))) {
            node.remove();
        }

        for (const item of state.items) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'context-menu-item';
            button.textContent = item.label;
            button.setAttribute('role', 'menuitem');
            button.disabled = item.disabled === true;
            if (item.disabledReason) {
                button.title = item.disabledReason;
            }

            if (item.children && item.children.length > 0) {
                button.classList.add('has-submenu');
                button.classList.toggle('is-dropup', item.submenuDirection === 'up');
                button.addEventListener('mouseenter', () => {
                    renderSubmenu(button, item.children ?? [], item.submenuDirection ?? 'right');
                });
            }

            button.addEventListener('click', () => {
                if (button.disabled) return;
                if (item.children && item.children.length > 0) {
                    renderSubmenu(button, item.children, item.submenuDirection ?? 'right');
                    return;
                }
                item.onSelect?.();
                close();
            });
            root.insertBefore(button, submenu);
        }

        root.style.left = `${Math.max(2, state.x)}px`;
        root.style.top = `${Math.max(2, state.y)}px`;
        root.hidden = false;

        const menuRect = root.getBoundingClientRect();
        const maxLeft = Math.max(2, window.innerWidth - menuRect.width - 2);
        const maxTop = Math.max(2, window.innerHeight - menuRect.height - 2);
        const left = Math.min(Math.max(2, state.x), maxLeft);
        const top = state.menuDirection === 'up'
            ? Math.min(Math.max(2, state.y - menuRect.height), maxTop)
            : Math.min(Math.max(2, state.y), maxTop);
        root.style.left = `${left}px`;
        root.style.top = `${top}px`;
    };

    const onWindowPointerDown = (event: PointerEvent) => {
        if (root.hidden) return;
        if (!root.contains(event.target as Node)) {
            close();
        }
    };

    const onWindowKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
            close();
            return;
        }

        if (event.key === 'ArrowRight' && !root.hidden && activeState) {
            const firstParent = root.querySelector<HTMLButtonElement>('.context-menu-item.has-submenu');
            if (firstParent) {
                const parentItem = activeState.items.find((entry) => entry.children && entry.children.length > 0);
                if (parentItem?.children) {
                    renderSubmenu(firstParent, parentItem.children, parentItem.submenuDirection ?? 'right');
                }
            }
        }
    };

    window.addEventListener('pointerdown', onWindowPointerDown);
    window.addEventListener('keydown', onWindowKeyDown);

    return {
        open,
        close,
        destroy: () => {
            window.removeEventListener('pointerdown', onWindowPointerDown);
            window.removeEventListener('keydown', onWindowKeyDown);
            root.remove();
        },
        getRoot: () => root,
    };
}
