import { createFloatingWindow } from './FloatingWindow';
import type { MapControlsWindowMeta } from '../meta/GameMetaStore';
import type { ToolDefinition } from '../core/ToolComponent';

type MapControlPanelOptions = {
    initialSeed: number;
    initialWindowState: MapControlsWindowMeta;
    weapons: ToolDefinition[];
    initialWeaponId: string;
    onGenerate: (seed: number) => void;
    onSave: () => void;
    onCenterBase: () => void;
    onSelectWeapon: (weaponId: string) => void;
    onWindowStateChange: (state: MapControlsWindowMeta) => void;
};

export type MapControlPanel = {
    setStatus: (text: string) => void;
    getRootElement: () => HTMLElement;
    open: () => void;
    destroy: () => void;
};

export function createMapControlPanel(options: MapControlPanelOptions): MapControlPanel {
    const frame = createFloatingWindow({
        title: 'Map Controls',
        className: 'map-controls-window',
        initialState: options.initialWindowState,
        onStateChange: (state) => {
            options.onWindowStateChange(state);
        },
    });

    const root = document.createElement('div');
    root.className = 'map-panel';

    const seedLabel = document.createElement('label');
    seedLabel.textContent = 'Seed';
    seedLabel.htmlFor = 'seed-input';

    const seedInput = document.createElement('input');
    seedInput.className = 'ui95-input';
    seedInput.id = 'seed-input';
    seedInput.type = 'number';
    seedInput.value = String(options.initialSeed);
    seedInput.step = '1';

    const newMapButton = document.createElement('button');
    newMapButton.type = 'button';
    newMapButton.className = 'ui95-button';
    newMapButton.textContent = 'Generate New Map';

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'ui95-button';
    saveButton.textContent = 'Save Map';

    const centerBaseButton = document.createElement('button');
    centerBaseButton.type = 'button';
    centerBaseButton.className = 'ui95-button';
    centerBaseButton.textContent = 'Center To Base';

    const weaponButton = document.createElement('button');
    weaponButton.type = 'button';
    weaponButton.className = 'ui95-button';

    let currentWeaponIndex = Math.max(0, options.weapons.findIndex((entry) => entry.id === options.initialWeaponId));
    const applyWeaponButtonLabel = () => {
        const weapon = options.weapons[currentWeaponIndex] ?? options.weapons[0];
        weaponButton.textContent = `Weapon: ${weapon.name}`;
        weaponButton.title = `Switch weapon (current: ${weapon.name})`;
    };
    applyWeaponButtonLabel();

    const status = document.createElement('p');
    status.className = 'map-panel-status';
    status.textContent = 'Auto-load uses your last saved map.';

    newMapButton.addEventListener('click', () => {
        const parsed = Number.parseInt(seedInput.value, 10);
        const seed = Number.isFinite(parsed) ? parsed : Math.floor(Math.random() * 9999999);
        seedInput.value = String(seed);
        options.onGenerate(seed);
    });

    saveButton.addEventListener('click', () => {
        options.onSave();
    });

    centerBaseButton.addEventListener('click', () => {
        options.onCenterBase();
    });

    weaponButton.addEventListener('click', () => {
        currentWeaponIndex = (currentWeaponIndex + 1) % options.weapons.length;
        const weapon = options.weapons[currentWeaponIndex];
        options.onSelectWeapon(weapon.id);
        applyWeaponButtonLabel();
    });

    root.append(seedLabel, seedInput, newMapButton, saveButton, centerBaseButton, weaponButton, status);
    frame.content.appendChild(root);

    return {
        setStatus: (text: string) => {
            status.textContent = text;
        },
        getRootElement: () => frame.root,
        open: () => {
            frame.setOpen(true);
            frame.setMinimized(false);
        },
        destroy: () => {
            frame.destroy();
        },
    };
}
