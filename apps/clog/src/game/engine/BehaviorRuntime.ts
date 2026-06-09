import { CanvasSurfaceRegistry } from './CanvasSurfaceRegistry';

export type BehaviorContext = {
    surfaces: CanvasSurfaceRegistry;
};

export type EngineBehavior = {
    id: string;
    onInit?: (context: BehaviorContext) => void;
    onTick?: (context: BehaviorContext, deltaMs: number) => void;
    onDispose?: (context: BehaviorContext) => void;
};

export class BehaviorRuntime {
    private readonly behaviors = new Map<string, EngineBehavior>();

    register(behavior: EngineBehavior, context: BehaviorContext): void {
        this.behaviors.set(behavior.id, behavior);
        behavior.onInit?.(context);
    }

    unregister(behaviorId: string, context: BehaviorContext): void {
        const existing = this.behaviors.get(behaviorId);
        if (!existing) return;
        existing.onDispose?.(context);
        this.behaviors.delete(behaviorId);
    }

    tick(context: BehaviorContext, deltaMs: number): void {
        for (const behavior of this.behaviors.values()) {
            behavior.onTick?.(context, deltaMs);
        }
    }

    dispose(context: BehaviorContext): void {
        for (const behavior of this.behaviors.values()) {
            behavior.onDispose?.(context);
        }
        this.behaviors.clear();
    }
}
