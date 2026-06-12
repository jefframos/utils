export type GridPoint = { x: number; y: number };

export type ScanNearestPlan = {
    targetX: number;
    targetY: number;
    approachX: number;
    approachY: number;
    path: Array<GridPoint>;
    anchorX: number;
    anchorY: number;
};

type Candidate = {
    targetX: number;
    targetY: number;
    approachX: number;
    approachY: number;
    score: number;
    neighbors: number;
};

export type ScanNearestContext = {
    workerX: number;
    workerY: number;
    anchorX: number;
    anchorY: number;
    lastMinedX: number;
    lastMinedY: number;
    baseX: number;
    baseY: number;
    isOpenTile: (x: number, y: number) => boolean;
    canTargetTile: (x: number, y: number) => boolean;
    countSolidNeighbors: (x: number, y: number) => number;
    buildPath: (fromX: number, fromY: number, toX: number, toY: number) => Array<GridPoint> | null;
};

export class ScanNearestBehavior {
    constructor(
        private readonly config: {
            areaRadius: number;
            reseedScanRadius: number;
            minDenseNeighbors: number;
            maxStepFromLastMined: number;
        } = {
                areaRadius: 9,
                reseedScanRadius: 18,
                minDenseNeighbors: 2,
                maxStepFromLastMined: 3,
            },
    ) { }

    chooseNextPlan(context: ScanNearestContext): ScanNearestPlan | null {
        const workerX = Math.round(context.workerX);
        const workerY = Math.round(context.workerY);

        const localPlan = this.findBestPlanForAnchor(
            context,
            context.anchorX,
            context.anchorY,
            workerX,
            workerY,
            this.config.areaRadius,
            true,
        );
        if (localPlan) {
            return {
                ...localPlan,
                anchorX: Math.round(context.anchorX),
                anchorY: Math.round(context.anchorY),
            };
        }

        // If strict local chaining can't find a tile, still exhaust the current
        // anchor radius before reseeding to a different anchor.
        const anchorExhaustPlan = this.findBestPlanForAnchor(
            context,
            context.anchorX,
            context.anchorY,
            workerX,
            workerY,
            this.config.areaRadius,
            false,
        );
        if (anchorExhaustPlan) {
            return {
                ...anchorExhaustPlan,
                anchorX: Math.round(context.anchorX),
                anchorY: Math.round(context.anchorY),
            };
        }

        const nextAnchor = this.findNextAnchor(context);
        if (!nextAnchor) return null;

        const nextPlan = this.findBestPlanForAnchor(
            context,
            nextAnchor.x,
            nextAnchor.y,
            workerX,
            workerY,
            this.config.areaRadius,
            false,
        );
        if (!nextPlan) return null;

        return {
            ...nextPlan,
            anchorX: nextAnchor.x,
            anchorY: nextAnchor.y,
        };
    }

    private findNextAnchor(context: ScanNearestContext): GridPoint | null {
        const originX = Math.round(context.lastMinedX);
        const originY = Math.round(context.lastMinedY);
        const workerX = Math.round(context.workerX);
        const workerY = Math.round(context.workerY);
        const baseX = Math.round(context.baseX);
        const baseY = Math.round(context.baseY);
        const maxRadius = Math.max(1, this.config.reseedScanRadius);

        let best: { x: number; y: number; score: number } | null = null;

        for (let oy = -maxRadius; oy <= maxRadius; oy++) {
            for (let ox = -maxRadius; ox <= maxRadius; ox++) {
                const x = originX + ox;
                const y = originY + oy;
                const distToOrigin = Math.abs(ox) + Math.abs(oy);
                if (distToOrigin > maxRadius) continue;
                if (!context.canTargetTile(x, y)) continue;

                const neighbors = context.countSolidNeighbors(x, y);
                const distToBase = Math.abs(x - baseX) + Math.abs(y - baseY);
                const distToWorker = Math.abs(x - workerX) + Math.abs(y - workerY);
                const sparsePenalty = neighbors <= 1 ? 120 : 0;
                const score = distToWorker * 1.4 + distToOrigin * 0.6 + distToBase * 0.25 + sparsePenalty - neighbors * 2;

                if (!best || score < best.score) {
                    best = { x, y, score };
                }
            }
        }

        return best ? { x: best.x, y: best.y } : null;
    }

    private findBestPlanForAnchor(
        context: ScanNearestContext,
        anchorX: number,
        anchorY: number,
        workerX: number,
        workerY: number,
        areaRadius: number,
        enforceChainRadius: boolean,
    ): Omit<ScanNearestPlan, 'anchorX' | 'anchorY'> | null {
        const startX = Math.round(anchorX);
        const startY = Math.round(anchorY);
        const baseX = Math.round(context.baseX);
        const baseY = Math.round(context.baseY);
        const lastX = Math.round(context.lastMinedX);
        const lastY = Math.round(context.lastMinedY);
        const queue: Array<GridPoint> = this.getAnchorOpenSeeds(context, startX, startY, areaRadius);
        if (queue.length === 0) return null;
        const previous = new Map<string, string | null>();
        for (const seed of queue) {
            previous.set(`${seed.x},${seed.y}`, null);
        }
        const maxApproachDistance = areaRadius + 1;

        // Cache worker->approach path checks for this planning pass to avoid
        // recomputing the same path for multiple adjacent candidate targets.
        const approachPathCache = new Map<string, Array<GridPoint> | null>();
        const getApproachPath = (approachX: number, approachY: number): Array<GridPoint> | null => {
            const key = `${approachX},${approachY}`;
            const cached = approachPathCache.get(key);
            if (cached !== undefined) {
                return cached;
            }
            const path = context.buildPath(workerX, workerY, approachX, approachY);
            approachPathCache.set(key, path);
            return path;
        };

        let bestDense: Candidate | null = null;
        let bestFallback: Candidate | null = null;

        let cursor = 0;
        while (cursor < queue.length) {
            const current = queue[cursor++];
            if (!current) continue;

            for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                const nx = current.x + ox;
                const ny = current.y + oy;

                if (context.canTargetTile(nx, ny)) {
                    const distToAnchor = Math.abs(nx - startX) + Math.abs(ny - startY);
                    if (distToAnchor > areaRadius) continue;

                    const distToLastMined = Math.abs(nx - lastX) + Math.abs(ny - lastY);
                    if (enforceChainRadius && distToLastMined > Math.max(1, this.config.maxStepFromLastMined)) continue;

                    const neighbors = context.countSolidNeighbors(nx, ny);
                    const distToBase = Math.abs(nx - baseX) + Math.abs(ny - baseY);
                    const distToWorker = Math.abs(nx - workerX) + Math.abs(ny - workerY);
                    const approachOffset = Math.abs(current.x - startX) + Math.abs(current.y - startY);
                    const sparsePenalty = neighbors <= 1 ? 300 : neighbors === 2 ? 35 : 0;
                    const score = enforceChainRadius
                        ? distToLastMined * 8 + distToAnchor * 1.2 + approachOffset * 0.25 + distToBase * 0.3 + sparsePenalty
                        : distToAnchor * 4.5 + distToWorker * 1.6 + approachOffset * 0.25 + distToBase * 0.35 + sparsePenalty;

                    const competesDense = neighbors >= this.config.minDenseNeighbors;
                    const currentBestScore = competesDense
                        ? (bestDense?.score ?? Number.POSITIVE_INFINITY)
                        : (bestFallback?.score ?? Number.POSITIVE_INFINITY);
                    if (score >= currentBestScore) continue;

                    const path = getApproachPath(current.x, current.y);
                    if (!path) continue;

                    const candidate: Candidate = {
                        targetX: nx,
                        targetY: ny,
                        approachX: current.x,
                        approachY: current.y,
                        score,
                        neighbors,
                    };

                    if (neighbors >= this.config.minDenseNeighbors) {
                        if (!bestDense || candidate.score < bestDense.score) {
                            bestDense = candidate;
                        }
                    } else if (!bestFallback || candidate.score < bestFallback.score) {
                        bestFallback = candidate;
                    }
                    continue;
                }

                if (!context.isOpenTile(nx, ny)) continue;
                const distToAnchorForApproach = Math.abs(nx - startX) + Math.abs(ny - startY);
                if (distToAnchorForApproach > maxApproachDistance) continue;
                const key = `${nx},${ny}`;
                if (previous.has(key)) continue;
                previous.set(key, `${current.x},${current.y}`);
                queue.push({ x: nx, y: ny });
            }
        }

        const selected = bestDense ?? bestFallback;
        if (!selected) return null;

        const selectedPath = getApproachPath(selected.approachX, selected.approachY);
        if (!selectedPath) return null;

        return {
            targetX: selected.targetX,
            targetY: selected.targetY,
            approachX: selected.approachX,
            approachY: selected.approachY,
            path: selectedPath,
        };
    }

    private getAnchorOpenSeeds(context: ScanNearestContext, anchorX: number, anchorY: number, areaRadius: number): Array<GridPoint> {
        const seeds: Array<GridPoint> = [];
        if (context.isOpenTile(anchorX, anchorY)) {
            seeds.push({ x: anchorX, y: anchorY });
            return seeds;
        }

        for (let r = 1; r <= areaRadius; r++) {
            for (let oy = -r; oy <= r; oy++) {
                const dy = Math.abs(oy);
                const dx = r - dy;
                for (const sx of [anchorX - dx, anchorX + dx]) {
                    const sy = anchorY + oy;
                    if (!context.isOpenTile(sx, sy)) continue;
                    seeds.push({ x: sx, y: sy });
                }
            }
            if (seeds.length > 0) {
                return this.uniquePoints(seeds);
            }
        }

        return [];
    }

    private uniquePoints(points: Array<GridPoint>): Array<GridPoint> {
        const seen = new Set<string>();
        const unique: Array<GridPoint> = [];
        for (const point of points) {
            const key = `${point.x},${point.y}`;
            if (seen.has(key)) continue;
            seen.add(key);
            unique.push(point);
        }
        return unique;
    }
}
