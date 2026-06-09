import { type GameMetaStore } from '../../meta/GameMetaStore';
import { type GameSimulation } from '../../core/GameSimulation';
import { type GameScene } from '../../scenes/GameScene';
import { createMinimapWindow, type MinimapWindow } from '../../ui/MinimapWindow';
import type { GameEngine } from '../../engine/GameEngine';
import type { RuntimeModule } from '../RuntimeModule';

export type MinimapUiModuleContext = {
    engine: GameEngine;
    simulation: GameSimulation;
    scene: GameScene;
    metaStore: GameMetaStore;
    minimapRef: { current: MinimapWindow | null };
};

export function createMinimapUiModule(): RuntimeModule<MinimapUiModuleContext> {
    return {
        id: 'ui:minimap-window',
        phase: 'ui',
        dependsOn: ['surface:world-main'],
        start: (context) => {
            const minimap = createMinimapWindow({
                world: context.simulation.world,
                metaStore: context.metaStore,
                getViewportRect: () => context.scene.getViewportWorldRectTiles(),
                onNavigate: (tileX, tileY) => {
                    context.scene.centerCameraOnTile(tileX, tileY);
                    minimap.refresh();
                },
            });

            context.minimapRef.current = minimap;
            context.engine.surfaces.register({
                id: 'ui-minimap',
                canvas: minimap.getCanvasElement(),
                role: 'ui',
                pixelRatioCap: 2,
            });

            minimap.refresh();

            const unsubscribeCamera = context.scene.onCameraChanged(() => {
                minimap.refresh();
            });

            const onResize = () => {
                minimap.refresh();
            };
            window.addEventListener('resize', onResize);

            return () => {
                unsubscribeCamera();
                window.removeEventListener('resize', onResize);
                context.engine.surfaces.unregister('ui-minimap');
                minimap.destroy();
                context.minimapRef.current = null;
            };
        },
    };
}
