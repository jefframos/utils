import type { CanvasSurfaceSnapshot } from '../CanvasSurfaceRegistry';

type RenderWorkerMessage =
    | { type: 'engine:init' }
    | { type: 'engine:tick'; deltaMs: number }
    | { type: 'surfaces:update'; surfaces: CanvasSurfaceSnapshot[] };

export class RenderWorkerBridge {
    private readonly worker: Worker;

    constructor() {
        this.worker = new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });
        this.worker.postMessage({ type: 'engine:init' } satisfies RenderWorkerMessage);
    }

    postSurfaceSnapshot(surfaces: CanvasSurfaceSnapshot[]): void {
        this.worker.postMessage({ type: 'surfaces:update', surfaces } satisfies RenderWorkerMessage);
    }

    tick(deltaMs: number): void {
        this.worker.postMessage({ type: 'engine:tick', deltaMs } satisfies RenderWorkerMessage);
    }

    dispose(): void {
        this.worker.terminate();
    }
}

export function isRenderWorkerSupported(): boolean {
    return typeof Worker !== 'undefined';
}
