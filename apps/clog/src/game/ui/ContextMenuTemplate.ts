export type ContextMenuItem = {
    id: string;
    label: string;
    onSelect: () => void;
    disabled?: boolean;
};

export type ContextMenuState = {
    x: number;
    y: number;
    items: ContextMenuItem[];
};

export type ContextMenuController = {
    open: (state: ContextMenuState) => void;
    close: () => void;
    destroy: () => void;
    getRoot: () => HTMLDivElement;
};

export function createContextMenuTemplate(className = 'context-menu-template'): ContextMenuController {
    const root = document.createElement('div');
    root.className = className;
    root.hidden = true;
    root.setAttribute('role', 'menu');

    const close = () => {
        root.hidden = true;
        root.innerHTML = '';
    };

    const open = (state: ContextMenuState) => {
        root.innerHTML = '';
        for (const item of state.items) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'context-menu-item';
            button.textContent = item.label;
            button.setAttribute('role', 'menuitem');
            button.disabled = item.disabled === true;
            button.addEventListener('click', () => {
                if (button.disabled) return;
                item.onSelect();
                close();
            });
            root.appendChild(button);
        }

        root.style.left = `${state.x}px`;
        root.style.top = `${state.y}px`;
        root.hidden = false;
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
