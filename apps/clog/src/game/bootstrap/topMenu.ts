type TopMenuOptions = {
    onOpenMapControls: () => void;
    onOpenToolInspector: () => void;
};

export type TopMenuHandle = {
    root: HTMLElement;
    destroy: () => void;
};

export function createTopMenu(options: TopMenuOptions): TopMenuHandle {
    const topToolbar = document.createElement('nav');
    topToolbar.className = 'top-menu-bar';
    topToolbar.setAttribute('aria-label', 'Game menu bar');

    const mapMenu = document.createElement('div');
    mapMenu.className = 'top-menu';

    const mapMenuButton = document.createElement('button');
    mapMenuButton.type = 'button';
    mapMenuButton.className = 'top-menu-button';
    mapMenuButton.textContent = 'Map';
    mapMenuButton.title = 'Map menu';
    mapMenuButton.setAttribute('aria-haspopup', 'menu');
    mapMenuButton.setAttribute('aria-expanded', 'false');

    const mapMenuList = document.createElement('div');
    mapMenuList.className = 'top-menu-list';
    mapMenuList.setAttribute('role', 'menu');

    const openMapControlsItem = document.createElement('button');
    openMapControlsItem.type = 'button';
    openMapControlsItem.className = 'top-menu-item';
    openMapControlsItem.textContent = 'Open Map Controls';
    openMapControlsItem.title = 'Open the map controls window';
    openMapControlsItem.setAttribute('role', 'menuitem');

    const openToolInspectorItem = document.createElement('button');
    openToolInspectorItem.type = 'button';
    openToolInspectorItem.className = 'top-menu-item';
    openToolInspectorItem.textContent = 'Open Tool Inspector';
    openToolInspectorItem.title = 'Open the tool inspector window';
    openToolInspectorItem.setAttribute('role', 'menuitem');

    mapMenuList.append(openMapControlsItem, openToolInspectorItem);
    mapMenu.append(mapMenuButton, mapMenuList);
    topToolbar.append(mapMenu);

    const closeMapMenu = () => {
        mapMenu.classList.remove('is-open');
        mapMenuButton.setAttribute('aria-expanded', 'false');
    };

    const onRootClick = (event: MouseEvent) => {
        if (!mapMenu.contains(event.target as Node)) {
            closeMapMenu();
        }
    };

    mapMenuButton.addEventListener('click', (event) => {
        event.stopPropagation();
        const willOpen = !mapMenu.classList.contains('is-open');
        closeMapMenu();
        if (willOpen) {
            mapMenu.classList.add('is-open');
            mapMenuButton.setAttribute('aria-expanded', 'true');
        }
    });

    openMapControlsItem.addEventListener('click', () => {
        options.onOpenMapControls();
        closeMapMenu();
    });

    openToolInspectorItem.addEventListener('click', () => {
        options.onOpenToolInspector();
        closeMapMenu();
    });

    window.addEventListener('click', onRootClick);

    return {
        root: topToolbar,
        destroy: () => {
            window.removeEventListener('click', onRootClick);
            topToolbar.remove();
        },
    };
}
