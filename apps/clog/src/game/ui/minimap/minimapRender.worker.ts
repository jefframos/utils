import { handleMinimapWorkerMessage } from './MinimapRenderer';

let context: OffscreenCanvasRenderingContext2D | null = null;

self.onmessage = (event: MessageEvent<unknown>) => {
    const next = handleMinimapWorkerMessage(
        context,
        event.data as Parameters<typeof handleMinimapWorkerMessage>[1],
    );
    context = next;
};
