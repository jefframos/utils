import { modulePhaseRank, type RuntimeModule } from './RuntimeModule';

type Cleanup = () => void;

export class ModuleHost<TContext> {
    private readonly modules = new Map<string, RuntimeModule<TContext>>();
    private readonly cleanups = new Map<string, Cleanup>();

    register(module: RuntimeModule<TContext>): void {
        this.modules.set(module.id, module);
    }

    async startAll(context: TContext): Promise<void> {
        const ordered = this.getOrderedModules();
        for (const module of ordered) {
            await this.startModule(module.id, context);
        }
    }

    async startModule(moduleId: string, context: TContext): Promise<void> {
        if (this.cleanups.has(moduleId)) return;

        const module = this.modules.get(moduleId);
        if (!module) {
            throw new Error(`Cannot start missing module: ${moduleId}`);
        }

        for (const dependencyId of module.dependsOn ?? []) {
            await this.startModule(dependencyId, context);
        }

        const cleanupOrVoid = await module.start(context);
        if (typeof cleanupOrVoid === 'function') {
            this.cleanups.set(module.id, cleanupOrVoid);
        } else {
            this.cleanups.set(module.id, () => undefined);
        }
    }

    disposeAll(): void {
        const startedIds = Array.from(this.cleanups.keys()).reverse();
        for (const moduleId of startedIds) {
            this.disposeModule(moduleId);
        }
    }

    disposeModule(moduleId: string): void {
        const cleanup = this.cleanups.get(moduleId);
        if (!cleanup) return;
        cleanup();
        this.cleanups.delete(moduleId);
    }

    private getOrderedModules(): RuntimeModule<TContext>[] {
        const list = Array.from(this.modules.values());
        list.sort((a, b) => {
            const phaseDelta = modulePhaseRank(a.phase) - modulePhaseRank(b.phase);
            if (phaseDelta !== 0) return phaseDelta;
            return a.id.localeCompare(b.id);
        });
        return list;
    }
}
