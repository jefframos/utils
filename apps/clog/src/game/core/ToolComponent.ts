export type ToolDefinition = {
    id: string;
    name: string;
    tileDamage: number;
    hitOnClick: boolean;
    hitOnHold: boolean;
    hitsPerSecond: number;
    damageMode: 'precise' | 'blunt';
    bluntRadius: number;
};

export const WEAPON_DEFINITIONS: ToolDefinition[] = [
    {
        id: 'starter-cutter',
        name: 'Starter Cutter',
        tileDamage: 3,
        hitOnClick: true,
        hitOnHold: true,
        hitsPerSecond: 3,
        damageMode: 'precise',
        bluntRadius: 0,
    },
    {
        id: 'shock-mallet',
        name: 'Shock Mallet',
        tileDamage: 2,
        hitOnClick: true,
        hitOnHold: false,
        hitsPerSecond: 3,
        damageMode: 'blunt',
        bluntRadius: 1,
    },
];

export const DEFAULT_TOOL: ToolDefinition = WEAPON_DEFINITIONS[0];

export class ToolComponent {
    private activeTool: ToolDefinition;

    constructor(initialTool: ToolDefinition = DEFAULT_TOOL) {
        this.activeTool = initialTool;
    }

    getActiveTool(): ToolDefinition {
        return this.activeTool;
    }

    setActiveTool(tool: ToolDefinition): void {
        this.activeTool = tool;
    }

    getAllTools(): ToolDefinition[] {
        return WEAPON_DEFINITIONS;
    }
}
