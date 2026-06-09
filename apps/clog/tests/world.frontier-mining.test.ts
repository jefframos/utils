import { describe, expect, it } from 'vitest';
import { GameSimulation } from '../src/game/core/GameSimulation';
import { WorldModel } from '../src/game/world/WorldModel';

describe('world mining frontier rules', () => {
    it('generates hidden natural void gaps for asteroid-belt spacing', () => {
        const world = new WorldModel(1337, {
            persistentTileDamage: false,
            transientDamageWindowMs: 5000,
        });

        let hiddenVoidCount = 0;
        let visibleOpenCount = 0;
        let solidCount = 0;
        const unknownVoidByBand = [0, 0, 0, 0];
        const visited = new Uint8Array(world.width * world.height);
        const asteroidBodies: number[] = [];
        for (let y = 0; y < world.height; y++) {
            for (let x = 0; x < world.width; x++) {
                const tile = world.getTile(x, y);
                if (!tile) continue;
                if (tile.solid) {
                    solidCount++;
                    continue;
                }
                if (tile.visibility === 'Unknown') {
                    hiddenVoidCount++;
                    const band = Math.min(3, Math.floor((x / world.width) * 4));
                    unknownVoidByBand[band]++;
                }
                if (tile.visibility === 'Open') visibleOpenCount++;
            }
        }

        for (let y = 0; y < world.height; y++) {
            for (let x = 0; x < world.width; x++) {
                const startIndex = y * world.width + x;
                if (visited[startIndex] === 1) continue;
                const tile = world.getTile(x, y);
                if (!tile?.solid) continue;

                let componentSize = 0;
                const queue: Array<{ x: number; y: number }> = [{ x, y }];
                visited[startIndex] = 1;

                while (queue.length > 0) {
                    const current = queue.pop();
                    if (!current) continue;
                    componentSize++;

                    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                        const tx = current.x + ox;
                        const ty = current.y + oy;
                        if (tx < 0 || ty < 0 || tx >= world.width || ty >= world.height) continue;
                        const nextIndex = ty * world.width + tx;
                        if (visited[nextIndex] === 1) continue;

                        const nextTile = world.getTile(tx, ty);
                        if (!nextTile?.solid) continue;

                        visited[nextIndex] = 1;
                        queue.push({ x: tx, y: ty });
                    }
                }

                asteroidBodies.push(componentSize);
            }
        }

        const significantBodies = asteroidBodies.filter((size) => size >= 24);
        const largestBody = Math.max(...asteroidBodies);

        expect(hiddenVoidCount).toBeGreaterThan(2800);
        expect(visibleOpenCount).toBeGreaterThan(0);
        expect(solidCount).toBeGreaterThan(5000);
        expect(solidCount).toBeLessThan(world.width * world.height - 1200);
        expect(significantBodies.length).toBeGreaterThan(2);
        for (const count of unknownVoidByBand) {
            expect(count).toBeGreaterThan(120);
        }
    });

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

    it('reveals nearby area when clicking empty open space', () => {
        const world = new WorldModel(1337, {
            persistentTileDamage: false,
            transientDamageWindowMs: 5000,
        });

        let target: { x: number; y: number } | null = null;
        for (let y = 0; y < world.height && !target; y++) {
            for (let x = 0; x < world.width; x++) {
                const tile = world.getTile(x, y);
                if (!tile || tile.solid || tile.visibility !== 'Open') continue;
                let hasUnknownNearby = false;
                for (let oy = -2; oy <= 2 && !hasUnknownNearby; oy++) {
                    for (let ox = -2; ox <= 2; ox++) {
                        const neighbor = world.getTile(x + ox, y + oy);
                        if (neighbor?.visibility === 'Unknown') {
                            hasUnknownNearby = true;
                            break;
                        }
                    }
                }
                if (hasUnknownNearby) {
                    target = { x, y };
                    break;
                }
            }
        }

        expect(target).not.toBeNull();
        if (!target) return;

        const changed = world.revealFromEmptyClick(target.x, target.y);
        expect(changed).toBe(true);
    });

    it('emits world dirty event when click explores empty space', () => {
        const world = new WorldModel(1337, {
            persistentTileDamage: false,
            transientDamageWindowMs: 5000,
        });
        const simulation = new GameSimulation(world);

        let target: { x: number; y: number } | null = null;
        for (let y = 0; y < world.height && !target; y++) {
            for (let x = 0; x < world.width; x++) {
                const tile = world.getTile(x, y);
                if (!tile || tile.solid || tile.visibility !== 'Open') continue;
                let hasUnknownNearby = false;
                for (let oy = -2; oy <= 2 && !hasUnknownNearby; oy++) {
                    for (let ox = -2; ox <= 2; ox++) {
                        const neighbor = world.getTile(x + ox, y + oy);
                        if (neighbor?.visibility === 'Unknown') {
                            hasUnknownNearby = true;
                            break;
                        }
                    }
                }
                if (hasUnknownNearby) {
                    target = { x, y };
                    break;
                }
            }
        }

        expect(target).not.toBeNull();
        if (!target) return;

        const events = simulation.execute({
            type: 'MineTile',
            x: target.x,
            y: target.y,
            trigger: 'click',
        });

        expect(events.some((event) => event.type === 'WorldChunkDirty')).toBe(true);
        expect(events.some((event) => event.type === 'TileDamaged')).toBe(false);
    });

    it('emits world dirty event when hold explores empty space', () => {
        const world = new WorldModel(1337, {
            persistentTileDamage: false,
            transientDamageWindowMs: 5000,
        });
        const simulation = new GameSimulation(world);

        let target: { x: number; y: number } | null = null;
        for (let y = 0; y < world.height && !target; y++) {
            for (let x = 0; x < world.width; x++) {
                const tile = world.getTile(x, y);
                if (!tile || tile.solid || tile.visibility !== 'Open') continue;
                let hasUnknownNearby = false;
                for (let oy = -2; oy <= 2 && !hasUnknownNearby; oy++) {
                    for (let ox = -2; ox <= 2; ox++) {
                        const neighbor = world.getTile(x + ox, y + oy);
                        if (neighbor?.visibility === 'Unknown') {
                            hasUnknownNearby = true;
                            break;
                        }
                    }
                }
                if (hasUnknownNearby) {
                    target = { x, y };
                    break;
                }
            }
        }

        expect(target).not.toBeNull();
        if (!target) return;

        const events = simulation.execute({
            type: 'MineTile',
            x: target.x,
            y: target.y,
            trigger: 'hold',
        });

        expect(events.some((event) => event.type === 'WorldChunkDirty')).toBe(true);
        expect(events.some((event) => event.type === 'TileDamaged')).toBe(false);
    });
});
