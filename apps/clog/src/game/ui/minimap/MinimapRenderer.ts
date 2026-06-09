export type MinimapRenderTile = {
    x: number;
    y: number;
    w: number;
    h: number;
    color: string;
};

export type MinimapRenderChunk = {
    chunkX: number;
    chunkY: number;
    tiles: MinimapRenderTile[];
};

export type MinimapRenderMarker = {
    x: number;
    y: number;
    radius: number;
    color: string;
    selected: boolean;
};

export type MinimapRenderFrame = {
    width: number;
    height: number;
    backgroundColor: string;
    tiles: MinimapRenderTile[];
    chunks?: MinimapRenderChunk[];
    base: {
        x: number;
        y: number;
        radius: number;
        color: string;
    };
    markers: MinimapRenderMarker[];
    viewport: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
    lineColor: string;
    lineWidth: number;
};

type WorkerRenderMessage = {
    type: 'draw';
    frame: MinimapRenderFrame;
};

type WorkerInitMessage = {
    type: 'init';
    canvas: OffscreenCanvas;
};

type WorkerIncomingMessage = WorkerRenderMessage | WorkerInitMessage;

type MinimapRenderer = {
    render: (frame: MinimapRenderFrame) => void;
    destroy: () => void;
    usesWorker: boolean;
};

function drawFrame(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, frame: MinimapRenderFrame): void {
    if (ctx.canvas.width !== frame.width || ctx.canvas.height !== frame.height) {
        ctx.canvas.width = frame.width;
        ctx.canvas.height = frame.height;
    }

    ctx.clearRect(0, 0, frame.width, frame.height);
    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = frame.backgroundColor;
    ctx.fillRect(0, 0, frame.width, frame.height);

    if (frame.chunks && frame.chunks.length > 0) {
        for (const chunk of frame.chunks) {
            for (const tile of chunk.tiles) {
                ctx.fillStyle = tile.color;
                ctx.fillRect(tile.x, tile.y, tile.w, tile.h);
            }
        }
    } else {
        for (const tile of frame.tiles) {
            ctx.fillStyle = tile.color;
            ctx.fillRect(tile.x, tile.y, tile.w, tile.h);
        }
    }

    ctx.fillStyle = frame.base.color;
    ctx.fillRect(
        frame.base.x - frame.base.radius,
        frame.base.y - frame.base.radius,
        frame.base.radius * 2,
        frame.base.radius * 2,
    );

    for (const marker of frame.markers) {
        ctx.beginPath();
        ctx.arc(marker.x, marker.y, marker.radius, 0, Math.PI * 2);
        ctx.fillStyle = marker.color;
        ctx.fill();
        ctx.lineWidth = marker.selected ? Math.max(2, frame.lineWidth) : Math.max(1, frame.lineWidth * 0.8);
        ctx.strokeStyle = '#f8fafc';
        ctx.stroke();
    }

    ctx.strokeStyle = frame.lineColor;
    ctx.lineWidth = frame.lineWidth;
    ctx.strokeRect(frame.viewport.x, frame.viewport.y, frame.viewport.w, frame.viewport.h);
}

function canUseOffscreenWorker(canvas: HTMLCanvasElement): boolean {
    return typeof Worker !== 'undefined'
        && typeof OffscreenCanvas !== 'undefined'
        && typeof (canvas as HTMLCanvasElement & { transferControlToOffscreen?: unknown }).transferControlToOffscreen === 'function';
}

export function createMinimapRenderer(canvas: HTMLCanvasElement): MinimapRenderer {
    if (canUseOffscreenWorker(canvas)) {
        const worker = new Worker(new URL('./minimapRender.worker.ts', import.meta.url), { type: 'module' });
        const offscreen = (canvas as HTMLCanvasElement & { transferControlToOffscreen: () => OffscreenCanvas }).transferControlToOffscreen();
        worker.postMessage({ type: 'init', canvas: offscreen } satisfies WorkerInitMessage, [offscreen]);

        return {
            usesWorker: true,
            render: (frame) => {
                worker.postMessage({ type: 'draw', frame } satisfies WorkerRenderMessage);
            },
            destroy: () => {
                worker.terminate();
            },
        };
    }

    const context = canvas.getContext('2d');
    if (!context) {
        return {
            usesWorker: false,
            render: () => undefined,
            destroy: () => undefined,
        };
    }

    return {
        usesWorker: false,
        render: (frame) => {
            drawFrame(context, frame);
        },
        destroy: () => undefined,
    };
}

export function handleMinimapWorkerMessage(
    context: OffscreenCanvasRenderingContext2D | null,
    message: WorkerIncomingMessage,
): OffscreenCanvasRenderingContext2D | null {
    if (message.type === 'init') {
        return message.canvas.getContext('2d');
    }

    if (!context) return context;
    drawFrame(context, message.frame);
    return context;
}
