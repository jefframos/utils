type RenderWorkerMessage =
    | { type: 'engine:init' }
    | { type: 'engine:tick'; deltaMs: number }
    | {
        type: 'surfaces:update';
        surfaces: Array<{ id: string; role: 'world' | 'overlay' | 'ui'; width: number; height: number; pixelRatio: number }>;
    };

type RenderWorkerState = {
    ready: boolean;
    lastTickMs: number;
    surfaces: Map<string, { role: 'world' | 'overlay' | 'ui'; width: number; height: number; pixelRatio: number }>;
};

const state: RenderWorkerState = {
    ready: false,
    lastTickMs: 0,
    surfaces: new Map(),
};

self.onmessage = (event: MessageEvent<RenderWorkerMessage>) => {
    const message = event.data;
    if (message.type === 'engine:init') {
        state.ready = true;
        return;
    }

    if (!state.ready) return;

    if (message.type === 'surfaces:update') {
        state.surfaces.clear();
        for (const surface of message.surfaces) {
            state.surfaces.set(surface.id, {
                role: surface.role,
                width: surface.width,
                height: surface.height,
                pixelRatio: surface.pixelRatio,
            });
        }
        return;
    }

    if (message.type === 'engine:tick') {
        state.lastTickMs = message.deltaMs;
    }
};
