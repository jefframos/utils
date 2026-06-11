/**
 * MiningSystem
 * Encapsulates all mining behavior: ore gathering, retargeting, cooldown management.
 * Separated from WorldModel to isolate mining mechanics.
 */

import { getToolDefinition } from '../../core/ToolComponent';
import type { WorldEntity } from '../WorldModel';
import type { TileDamageHit } from '../../core/protocol.ts';

export interface MiningSystemContext {
    getEntity(id: string): WorldEntity | null;
    isMineableFrontierSolid(x: number, y: number): boolean;
    findClosestMineTargetPlan(entity: WorldEntity, options: any): any | null;
    reserveMineTarget(x: number, y: number, workerId: string): boolean;
    releaseMineTarget(x: number, y: number, workerId: string): void;
    mineSingleAt(x: number, y: number, damage: number): TileDamageHit | null;
    markChunkDirtyAt(x: number, y: number): void;
    trackDamageHit(hit: TileDamageHit): void;
    /** Returns how many ore the entity can still carry (capped at slot size). */
    getAvailableCarryCapacity(entity: WorldEntity): number;
    /** Cap damage so yielded ore doesn't exceed availableCapacity. Returns capped damage. */
    capDamageToCapacity(x: number, y: number, damage: number, availableCapacity: number): number;
}

export class MiningSystem {
    constructor(private context: MiningSystemContext) { }

    /**
     * Update worker mining per tick.
     * Handles damage application, ore carrying, cooldown, and retargeting.
     * @returns true if mining completed and entity should move to next command
     */
    updateWorkerMining(entity: WorldEntity, deltaMs: number): boolean {
        if (!entity.mining) return false;
        if (!entity.deployed || entity.movement) return false;

        const mining = entity.mining;
        const atApproach = Math.round(entity.x) === mining.approachX && Math.round(entity.y) === mining.approachY;
        const targetStillMineable = this.context.isMineableFrontierSolid(mining.targetX, mining.targetY);

        if (!targetStillMineable || !atApproach) {
            const plan = this.context.findClosestMineTargetPlan(entity, {
                anchorX: mining.anchorX,
                anchorY: mining.anchorY,
                lastMinedX: mining.lastMinedX,
                lastMinedY: mining.lastMinedY,
            });

            if (!plan) {
                return true; // Mining failed, signal to complete command
            }

            if (this.context.reserveMineTarget(plan.targetX, plan.targetY, entity.id)) {
                mining.targetX = plan.targetX;
                mining.targetY = plan.targetY;
                mining.approachX = plan.approachX;
                mining.approachY = plan.approachY;
                mining.anchorX = plan.anchorX;
                mining.anchorY = plan.anchorY;
                mining.cooldownMs = 0;
                mining.miningProgressMs = 0;
                entity.movement = {
                    path: plan.path,
                    stepIndex: 1,
                    progress: 0,
                    mode: 'move',
                };
            }
            return false;
        }

        const tool = entity.toolId ? getToolDefinition(entity.toolId) : undefined;
        if (!tool) {
            return true; // No tool, signal to complete command
        }

        if (mining.cooldownMs > 0) {
            mining.cooldownMs = Math.max(0, mining.cooldownMs - deltaMs);
            return false;
        }

        const rawDamage = Math.max(1, Math.floor(tool.tileDamage * Math.max(1, entity.minePower ?? 1)));

        // Cap damage so ore yield doesn't exceed available carry capacity
        const available = this.context.getAvailableCarryCapacity(entity);
        if (available <= 0) {
            // Inventory full — stop mining, caller will handle dropoff
            return true;
        }
        const damage = this.context.capDamageToCapacity(mining.targetX, mining.targetY, rawDamage, available);

        const hit = this.context.mineSingleAt(mining.targetX, mining.targetY, damage);

        if (!hit) {
            this.context.releaseMineTarget(mining.targetX, mining.targetY, entity.id);
            return true; // Hit failed, signal to complete command
        }

        this.context.trackDamageHit(hit);

        const toolCadenceMs = Math.max(60, Math.round(1000 / Math.max(0.1, tool.hitsPerSecond)));
        const workerCadenceMs = Math.max(0, Math.round(entity.mineCooldownMs ?? 0));
        mining.cooldownMs = workerCadenceMs > 0
            ? Math.min(workerCadenceMs, toolCadenceMs)
            : toolCadenceMs;
        mining.miningProgressMs += deltaMs;

        if (hit.oreYield > 0) {
            mining.carriedOre += hit.oreYield;
            mining.lastMinedX = mining.targetX;
            mining.lastMinedY = mining.targetY;
        }

        if (hit.opened) {
            this.context.releaseMineTarget(mining.targetX, mining.targetY, entity.id);
        }

        return false;
    }
}
