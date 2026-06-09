import type { GameCommand, GameEvent } from './protocol';
import type { InventoryState } from '../inventory/InventoryModel';
import { ToolComponent } from './ToolComponent';
import { WorldModel } from '../world/WorldModel';
import { getTotalResourceCount, deductResource } from '../inventory/InventoryModel';

export class GameSimulation {
    readonly world: WorldModel;
    readonly tools: ToolComponent;
    inventory: InventoryState | null = null;

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
            if (hits.length === 0) {
                if (this.world.revealFromEmptyClick(command.x, command.y)) {
                    return [{ type: 'WorldChunkDirty', keys: this.world.getDirtyChunkKeys() }];
                }
                return [];
            }

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

        if (command.type === 'PlaceBeacon') {
            const BEACON_ORE_COST = 10;
            if (this.inventory) {
                const oreCount = getTotalResourceCount(this.inventory, 'debug-asteroid-ore');
                if (oreCount < BEACON_ORE_COST) {
                    return [
                        {
                            type: 'BeaconPlacementFailed',
                            x: command.x,
                            y: command.y,
                            reason: 'insufficient_ore',
                        },
                    ];
                }
            }

            const placed = this.world.placeBeacon(command.x, command.y);
            if (!placed) {
                const reason = this.world.getBeaconPlacementFailureReason(command.x, command.y);
                return [
                    {
                        type: 'BeaconPlacementFailed',
                        x: command.x,
                        y: command.y,
                        reason,
                    },
                ];
            }

            if (this.inventory) {
                deductResource(this.inventory, 'debug-asteroid-ore', BEACON_ORE_COST);
            }

            return [
                {
                    type: 'BeaconPlaced',
                    id: placed.id,
                    x: placed.x,
                    y: placed.y,
                    parentId: placed.parentId,
                },
                { type: 'WorldChunkDirty', keys: this.world.getDirtyChunkKeys() },
            ];
        }

        return [];
    }
}
