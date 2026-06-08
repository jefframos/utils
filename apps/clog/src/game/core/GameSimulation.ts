import type { GameCommand, GameEvent } from './protocol';
import { ToolComponent } from './ToolComponent';
import { WorldModel } from '../world/WorldModel';

export class GameSimulation {
    readonly world: WorldModel;
    readonly tools: ToolComponent;

    constructor(world?: WorldModel) {
        this.world = world ?? new WorldModel();
        this.tools = new ToolComponent();
    }

    execute(command: GameCommand): GameEvent[] {
        if (command.type === 'MineTile') {
            const tool = this.tools.getActiveTool();
            if (command.trigger === 'click' && !tool.hitOnClick) return [];
            if (command.trigger === 'hold' && !tool.hitOnHold) return [];

            const hits = this.world.mineWithTool(
                command.x,
                command.y,
                tool.tileDamage,
                tool.damageMode,
                tool.bluntRadius,
            );
            if (hits.length === 0) return [];

            return [
                { type: 'TileDamaged', hits },
                { type: 'TileMined', x: command.x, y: command.y },
                { type: 'WorldChunkDirty', keys: this.world.getDirtyChunkKeys() },
            ];
        }

        if (command.type === 'GenerateWorld') {
            this.world.reset(command.seed);
            return [
                { type: 'WorldGenerated', seed: command.seed },
                { type: 'WorldChunkDirty', keys: this.world.getDirtyChunkKeys() },
            ];
        }

        if (command.type === 'LoadWorldSnapshot') {
            this.world.applySnapshot(command.snapshot);
            return [
                { type: 'WorldGenerated', seed: this.world.getSeed() },
                { type: 'WorldChunkDirty', keys: this.world.getDirtyChunkKeys() },
            ];
        }

        return [];
    }
}
