export type CanvasSurfaceRole = 'world' | 'overlay' | 'ui';

export type CanvasSurface = {
    id: string;
    canvas: HTMLCanvasElement;
    role: CanvasSurfaceRole;
    pixelRatioCap?: number;
};

export type CanvasSurfaceSnapshot = {
    id: string;
    role: CanvasSurfaceRole;
    width: number;
    height: number;
    pixelRatio: number;
};

export class CanvasSurfaceRegistry {
    private readonly surfaces = new Map<string, CanvasSurface>();

    register(surface: CanvasSurface): void {
        this.surfaces.set(surface.id, surface);
    }

    unregister(id: string): void {
        this.surfaces.delete(id);
    }

    has(id: string): boolean {
        return this.surfaces.has(id);
    }

    get(id: string): CanvasSurface | undefined {
        return this.surfaces.get(id);
    }

    list(): CanvasSurface[] {
        return Array.from(this.surfaces.values());
    }

    snapshot(): CanvasSurfaceSnapshot[] {
        return this.list().map((surface) => {
            const rect = surface.canvas.getBoundingClientRect();
            const dprCap = surface.pixelRatioCap ?? 2;
            const pixelRatio = Math.min(window.devicePixelRatio || 1, dprCap);
            return {
                id: surface.id,
                role: surface.role,
                width: Math.max(1, Math.floor(rect.width * pixelRatio)),
                height: Math.max(1, Math.floor(rect.height * pixelRatio)),
                pixelRatio,
            };
        });
    }
}
