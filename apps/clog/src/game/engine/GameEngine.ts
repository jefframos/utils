import { BehaviorRuntime, type EngineBehavior } from './BehaviorRuntime';
import { CanvasSurfaceRegistry } from './CanvasSurfaceRegistry';
import { isRenderWorkerSupported, RenderWorkerBridge } from './worker/RenderWorkerBridge';

export type GameEngineOptions = {
    useWorker?: boolean;
};

export type GameEngine = {
    surfaces: CanvasSurfaceRegistry;
    registerBehavior: (behavior: EngineBehavior) => void;
    unregisterBehavior: (behaviorId: string) => void;
    listBehaviorIds: () => string[];
    start: () => void;
    stop: () => void;
    destroy: () => void;
};

export function createGameEngine(options: GameEngineOptions = {}): GameEngine {
    const surfaces = new CanvasSurfaceRegistry();
    const behaviors = new BehaviorRuntime();
    const context = { surfaces };

    const workerBridge = options.useWorker && isRenderWorkerSupported()
        ? new RenderWorkerBridge()
        : null;

    let running = false;
    let rafId = 0;
    let lastTs = 0;

    const onFrame = (timestamp: number) => {
        if (!running) return;
        if (lastTs === 0) lastTs = timestamp;
        const deltaMs = timestamp - lastTs;
        lastTs = timestamp;

        behaviors.tick(context, deltaMs);

        if (workerBridge) {
            workerBridge.postSurfaceSnapshot(surfaces.snapshot());
            workerBridge.tick(deltaMs);
        }

        rafId = requestAnimationFrame(onFrame);
    };

    return {
        surfaces,
        registerBehavior: (behavior) => {
            behaviors.register(behavior, context);
        },
        unregisterBehavior: (behaviorId) => {
            behaviors.unregister(behaviorId, context);
        },
        listBehaviorIds: () => {
            return behaviors.listBehaviorIds();
        },
        start: () => {
            if (running) return;
            running = true;
            lastTs = 0;
            rafId = requestAnimationFrame(onFrame);
        },
        stop: () => {
            if (!running) return;
            running = false;
            cancelAnimationFrame(rafId);
        },
        destroy: () => {
            if (running) {
                running = false;
                cancelAnimationFrame(rafId);
            }
            behaviors.dispose(context);
            workerBridge?.dispose();
        },
    };
}
