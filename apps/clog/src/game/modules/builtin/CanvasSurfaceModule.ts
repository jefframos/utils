import type { CanvasSurfaceRole } from '../../engine/CanvasSurfaceRegistry';
import type { GameEngine } from '../../engine/GameEngine';
import type { RuntimeModule } from '../RuntimeModule';

export type SurfaceModuleContext = {
    engine: GameEngine;
};

type CanvasSurfaceModuleOptions = {
    id: string;
    moduleId?: string;
    role: CanvasSurfaceRole;
    canvas: HTMLCanvasElement;
    pixelRatioCap?: number;
};

export function createCanvasSurfaceModule(options: CanvasSurfaceModuleOptions): RuntimeModule<SurfaceModuleContext> {
    const moduleId = options.moduleId ?? `surface:${options.id}`;

    return {
        id: moduleId,
        phase: 'rendering',
        start: ({ engine }) => {
            engine.surfaces.register({
                id: options.id,
                canvas: options.canvas,
                role: options.role,
                pixelRatioCap: options.pixelRatioCap,
            });

            return () => {
                engine.surfaces.unregister(options.id);
            };
        },
    };
}
