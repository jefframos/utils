import { describe, expect, it } from 'vitest';
import { WorldModel } from '../src/game/world/WorldModel';

describe('world mining frontier rules', () => {
    it('does not allow mining revealed solids away from the frontier', () => {
        const world = new WorldModel(1337, {
            persistentTileDamage: false,
            transientDamageWindowMs: 5000,
        });

        let candidate: { x: number; y: number; hp: number } | null = null;
        for (let y = 0; y < world.height && !candidate; y++) {
            for (let x = 0; x < world.width; x++) {
                const tile = world.getTile(x, y);
                if (!tile || !tile.solid) continue;
                if (tile.visibility !== 'Revealed') continue;
                if (world.isBiomeNearOpen(x, y)) continue;
                candidate = { x, y, hp: tile.hp };
                break;
            }
        }

        expect(candidate).not.toBeNull();
        if (!candidate) return;

        const hits = world.mineWithTool(candidate.x, candidate.y, 999, 'precise', 0);
        expect(hits.length).toBe(0);

        const tileAfter = world.getTile(candidate.x, candidate.y);
        expect(tileAfter?.hp).toBe(candidate.hp);
        expect(tileAfter?.solid).toBe(true);
    });

    it('allows mining solid tiles on the frontier edge', () => {
        const world = new WorldModel(1337, {
            persistentTileDamage: false,
            transientDamageWindowMs: 5000,
        });

        let frontier: { x: number; y: number; hp: number } | null = null;
        for (let y = 0; y < world.height && !frontier; y++) {
            for (let x = 0; x < world.width; x++) {
                const tile = world.getTile(x, y);
                if (!tile || !tile.solid) continue;
                if (!world.isBiomeNearOpen(x, y)) continue;
                frontier = { x, y, hp: tile.hp };
                break;
            }
        }

        expect(frontier).not.toBeNull();
        if (!frontier) return;

        const hits = world.mineWithTool(frontier.x, frontier.y, 1, 'precise', 0);
        expect(hits.length).toBeGreaterThan(0);

        const tileAfter = world.getTile(frontier.x, frontier.y);
        expect(tileAfter?.hp).toBeLessThan(frontier.hp);
    });

    it('marks only near-open solids as mineable frontier', () => {
        const world = new WorldModel(1337, {
            persistentTileDamage: false,
            transientDamageWindowMs: 5000,
        });

        let checked = 0;
        for (let y = 0; y < world.height && checked < 2000; y++) {
            for (let x = 0; x < world.width && checked < 2000; x++) {
                const tile = world.getTile(x, y);
                if (!tile || !tile.solid) continue;
                expect(world.isMineableFrontierSolid(x, y)).toBe(world.isBiomeNearOpen(x, y));
                checked++;
            }
        }

        expect(checked).toBeGreaterThan(0);
    });
});
