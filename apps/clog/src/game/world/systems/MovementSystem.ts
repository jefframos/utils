/**
 * MovementSystem
 * Encapsulates all movement behavior: path following, player movement, worker deployment.
 * Separated from WorldModel to isolate movement mechanics.
 */

import type { WorldEntity } from '../WorldModel';

export interface MovementSystemContext {
    getEntity(id: string): WorldEntity | null;
    markChunkDirtyAt(x: number, y: number): void;
    isInBaseDropoffZone(entity: WorldEntity, x: number, y: number): boolean;
}

export class MovementSystem {
    constructor(private context: MovementSystemContext) { }

    /**
     * Update worker movement path following per tick.
     * Advances entity along path and returns when movement completes.
     * @returns true if movement is now complete
     */
    updateWorkerMovement(entity: WorldEntity, deltaMs: number): boolean {
        if (!entity.movement) return false;

        const speed = Math.max(
            0.1,
            entity.walking?.speedTilesPerSecond ??
            entity.moveSpeedTilesPerSecond ??
            2.0
        );
        let remainingTiles = (speed * deltaMs) / 1000;

        while (remainingTiles > 0 && entity.movement.stepIndex < entity.movement.path.length) {
            const nextPoint = entity.movement.path[entity.movement.stepIndex];
            const distance = Math.hypot(nextPoint.x - entity.x, nextPoint.y - entity.y);

            if (distance === 0) {
                entity.x = nextPoint.x;
                entity.y = nextPoint.y;
                entity.movement.stepIndex++;
                entity.movement.progress = 0;
                continue;
            }

            const step = Math.min(remainingTiles, distance);
            const ratio = step / distance;
            entity.x += (nextPoint.x - entity.x) * ratio;
            entity.y += (nextPoint.y - entity.y) * ratio;
            entity.movement.progress += step;
            remainingTiles -= step;

            if (Math.hypot(nextPoint.x - entity.x, nextPoint.y - entity.y) <= 0.001) {
                entity.x = nextPoint.x;
                entity.y = nextPoint.y;
                entity.movement.stepIndex++;
                entity.movement.progress = 0;
            }

            if (entity.movement.mode === 'return' && entity.movement.homeId) {
                const home = this.context.getEntity(entity.movement.homeId);
                if (home && this.context.isInBaseDropoffZone(home, entity.x, entity.y)) {
                    entity.movement.stepIndex = entity.movement.path.length;
                    break;
                }
            }
        }

        if (entity.movement.stepIndex >= entity.movement.path.length) {
            entity.movement = null;
            return true;
        }

        return false;
    }

    /**
     * Update player movement path following per tick.
     * @returns true if movement is now complete
     */
    updatePlayerMovement(entity: WorldEntity, deltaMs: number): boolean {
        if (!entity.movement) return false;

        const speed = Math.max(
            0.1,
            entity.walking?.speedTilesPerSecond ??
            entity.moveSpeedTilesPerSecond ??
            2.5
        );
        let remainingTiles = (speed * deltaMs) / 1000;

        while (remainingTiles > 0 && entity.movement.stepIndex < entity.movement.path.length) {
            const nextPoint = entity.movement.path[entity.movement.stepIndex];
            const distance = Math.hypot(nextPoint.x - entity.x, nextPoint.y - entity.y);

            if (distance === 0) {
                entity.x = nextPoint.x;
                entity.y = nextPoint.y;
                entity.movement.stepIndex++;
                entity.movement.progress = 0;
                continue;
            }

            const step = Math.min(remainingTiles, distance);
            const ratio = step / distance;
            entity.x += (nextPoint.x - entity.x) * ratio;
            entity.y += (nextPoint.y - entity.y) * ratio;
            entity.movement.progress += step;
            remainingTiles -= step;

            if (Math.hypot(nextPoint.x - entity.x, nextPoint.y - entity.y) <= 0.001) {
                entity.x = nextPoint.x;
                entity.y = nextPoint.y;
                entity.movement.stepIndex++;
                entity.movement.progress = 0;
            }
        }

        if (entity.movement.stepIndex >= entity.movement.path.length) {
            entity.movement = null;
            return true;
        }

        return false;
    }
}
