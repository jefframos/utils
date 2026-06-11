export type MinimapMarkerMeta = {
    id: string;
    label: string;
    x: number;
    y: number;
    colorKey: 'color1' | 'color2' | 'color3';
};

export type MinimapWindowMeta = {
    open: boolean;
    minimized: boolean;
    left: number;
    top: number;
    width: number;
    height: number;
    showFullMap: boolean;
    zoomLevel: number;
    centerX: number;
    centerY: number;
    markers: MinimapMarkerMeta[];
};

export type MapControlsWindowMeta = {
    open: boolean;
    minimized: boolean;
    left: number;
    top: number;
    width: number;
    height: number;
};

export type InventoryWindowMeta = {
    open: boolean;
    minimized: boolean;
    left: number;
    top: number;
    width: number;
    height: number;
};

export type ToolInspectorWindowMeta = {
    open: boolean;
    minimized: boolean;
    left: number;
    top: number;
    width: number;
    height: number;
};

export type InventoryItemDetailsWindowMeta = {
    open: boolean;
    minimized: boolean;
    left: number;
    top: number;
    width: number;
    height: number;
};

export type EntityDetailsWindowMeta = {
    open: boolean;
    minimized: boolean;
    left: number;
    top: number;
    width: number;
    height: number;
};

export type BuildPanelWindowMeta = {
    open: boolean;
    minimized: boolean;
    left: number;
    top: number;
    width: number;
    height: number;
};

export type GameMeta = {
    windows: {
        minimap: MinimapWindowMeta;
        mapControls: MapControlsWindowMeta;
        inventory: InventoryWindowMeta;
        toolInspector: ToolInspectorWindowMeta;
        inventoryItemDetails: InventoryItemDetailsWindowMeta;
        entityDetails: EntityDetailsWindowMeta;
        buildPanel: BuildPanelWindowMeta;
    };
};

type Listener = (meta: GameMeta) => void;

export class GameMetaStore {
    private readonly listeners = new Set<Listener>();

    constructor(private meta: GameMeta) { }

    getMeta(): GameMeta {
        return this.meta;
    }

    updateMinimap(next: Partial<MinimapWindowMeta>): void {
        this.meta = {
            ...this.meta,
            windows: {
                ...this.meta.windows,
                minimap: {
                    ...this.meta.windows.minimap,
                    ...next,
                },
            },
        };
        this.emit();
    }

    updateMapControls(next: Partial<MapControlsWindowMeta>): void {
        this.meta = {
            ...this.meta,
            windows: {
                ...this.meta.windows,
                mapControls: {
                    ...this.meta.windows.mapControls,
                    ...next,
                },
            },
        };
        this.emit();
    }

    updateInventory(next: Partial<InventoryWindowMeta>): void {
        this.meta = {
            ...this.meta,
            windows: {
                ...this.meta.windows,
                inventory: {
                    ...this.meta.windows.inventory,
                    ...next,
                },
            },
        };
        this.emit();
    }

    updateToolInspector(next: Partial<ToolInspectorWindowMeta>): void {
        this.meta = {
            ...this.meta,
            windows: {
                ...this.meta.windows,
                toolInspector: {
                    ...this.meta.windows.toolInspector,
                    ...next,
                },
            },
        };
        this.emit();
    }

    updateInventoryItemDetails(next: Partial<InventoryItemDetailsWindowMeta>): void {
        this.meta = {
            ...this.meta,
            windows: {
                ...this.meta.windows,
                inventoryItemDetails: {
                    ...this.meta.windows.inventoryItemDetails,
                    ...next,
                },
            },
        };
        this.emit();
    }

    updateEntityDetails(next: Partial<EntityDetailsWindowMeta>): void {
        this.meta = {
            ...this.meta,
            windows: {
                ...this.meta.windows,
                entityDetails: {
                    ...this.meta.windows.entityDetails,
                    ...next,
                },
            },
        };
        this.emit();
    }

    updateBuildPanel(next: Partial<BuildPanelWindowMeta>): void {
        this.meta = {
            ...this.meta,
            windows: {
                ...this.meta.windows,
                buildPanel: {
                    ...this.meta.windows.buildPanel,
                    ...next,
                },
            },
        };
        this.emit();
    }

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private emit(): void {
        for (const listener of this.listeners) {
            listener(this.meta);
        }
    }
}
