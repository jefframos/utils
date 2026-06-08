export type FloatingWindowState = {
    open: boolean;
    minimized: boolean;
    left: number;
    top: number;
    width: number;
    height: number;
};

type FloatingWindowOptions = {
    title: string;
    className?: string;
    initialState: FloatingWindowState;
    onStateChange?: (state: FloatingWindowState) => void;
};

export type FloatingWindow = {
    root: HTMLElement;
    content: HTMLElement;
    setOpen: (open: boolean) => void;
    setMinimized: (minimized: boolean) => void;
    getState: () => FloatingWindowState;
    destroy: () => void;
};

let nextFloatingWindowZIndex = 30;

function bringFloatingWindowToFront(root: HTMLElement): void {
    root.style.zIndex = String(nextFloatingWindowZIndex++);
}

export function createFloatingWindow(options: FloatingWindowOptions): FloatingWindow {
    const root = document.createElement('section');
    root.className = `floating-window ${options.className ?? ''}`.trim();

    const header = document.createElement('header');
    header.className = 'floating-window-header';

    const title = document.createElement('h3');
    title.textContent = options.title;

    const controls = document.createElement('div');
    controls.className = 'floating-window-controls';

    const minimizeButton = document.createElement('button');
    minimizeButton.type = 'button';
    minimizeButton.className = 'ui95-button floating-window-minimize';
    minimizeButton.setAttribute('aria-label', 'Minimize window');
    minimizeButton.textContent = '\u2014';

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'ui95-button floating-window-close';
    closeButton.setAttribute('aria-label', 'Close window');
    closeButton.textContent = 'x';

    controls.append(minimizeButton, closeButton);

    header.append(title, controls);

    const content = document.createElement('div');
    content.className = 'floating-window-content';

    root.append(header, content);
    document.body.appendChild(root);

    let state: FloatingWindowState = { ...options.initialState };
    let dragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let startLeft = 0;
    let startTop = 0;

    const clamp = () => {
        const maxLeft = Math.max(8, window.innerWidth - root.offsetWidth - 8);
        const maxTop = Math.max(8, window.innerHeight - root.offsetHeight - 8);
        state.left = Math.max(8, Math.min(maxLeft, state.left));
        state.top = Math.max(8, Math.min(maxTop, state.top));
    };

    const apply = () => {
        root.hidden = !state.open;
        root.classList.toggle('is-minimized', state.minimized);
        root.style.left = `${state.left}px`;
        root.style.top = `${state.top}px`;
        root.style.width = `${state.width}px`;
        root.style.height = `${state.height}px`;
        minimizeButton.textContent = state.minimized ? '\u25A1' : '\u2014';
        minimizeButton.setAttribute('aria-label', state.minimized ? 'Restore window' : 'Minimize window');
        options.onStateChange?.({ ...state });
    };

    const setState = (patch: Partial<FloatingWindowState>) => {
        state = { ...state, ...patch };
        clamp();
        apply();
    };

    controls.addEventListener('mousedown', (event) => {
        // Keep titlebar buttons clickable without starting drag.
        event.stopPropagation();
    });

    root.addEventListener('mousedown', () => {
        if (state.open) {
            bringFloatingWindowToFront(root);
        }
    });

    header.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return;
        if ((event.target as HTMLElement)?.closest('.floating-window-controls')) return;
        dragging = true;
        dragStartX = event.clientX;
        dragStartY = event.clientY;
        startLeft = state.left;
        startTop = state.top;
        event.preventDefault();
    });

    const onMouseMove = (event: MouseEvent) => {
        if (!dragging) return;
        setState({
            left: startLeft + (event.clientX - dragStartX),
            top: startTop + (event.clientY - dragStartY),
        });
    };

    const onMouseUp = () => {
        dragging = false;
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    minimizeButton.addEventListener('click', () => {
        setState({ minimized: !state.minimized });
    });

    closeButton.addEventListener('click', () => {
        setState({ open: false, minimized: false });
    });

    const resizeObserver = new ResizeObserver(() => {
        if (root.hidden || state.minimized) return;
        const rect = root.getBoundingClientRect();
        const nextWidth = Math.round(rect.width);
        const nextHeight = Math.round(rect.height);
        if (nextWidth === state.width && nextHeight === state.height) return;
        state = {
            ...state,
            width: nextWidth,
            height: nextHeight,
        };
        options.onStateChange?.({ ...state });
    });
    resizeObserver.observe(root);

    const onWindowResize = () => {
        clamp();
        apply();
    };
    window.addEventListener('resize', onWindowResize);

    apply();
    bringFloatingWindowToFront(root);

    return {
        root,
        content,
        setOpen: (open: boolean) => {
            setState({ open });
            if (open) {
                bringFloatingWindowToFront(root);
            }
        },
        setMinimized: (minimized: boolean) => setState({ minimized }),
        getState: () => ({ ...state }),
        destroy: () => {
            resizeObserver.disconnect();
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            window.removeEventListener('resize', onWindowResize);
            root.remove();
        },
    };
}
