export type ModulePhase = 'core' | 'simulation' | 'rendering' | 'ui' | 'workers';

export type RuntimeModule<TContext> = {
    id: string;
    phase: ModulePhase;
    dependsOn?: string[];
    start: (context: TContext) => void | (() => void) | Promise<void | (() => void)>;
};

export const MODULE_PHASE_ORDER: ModulePhase[] = ['core', 'simulation', 'rendering', 'ui', 'workers'];

export function modulePhaseRank(phase: ModulePhase): number {
    return MODULE_PHASE_ORDER.indexOf(phase);
}
