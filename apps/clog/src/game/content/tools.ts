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

export const TOOL_DEFINITIONS: ToolDefinition[] = [
    {
        id: 'starter-cutter',
        name: 'Starter Cutter',
        tileDamage: 3,
        hitOnClick: true,
        hitOnHold: true,
        hitsPerSecond: 1,
        damageMode: 'precise',
        bluntRadius: 0,
    },
    {
        id: 'shock-mallet',
        name: 'Shock Mallet',
        tileDamage: 2,
        hitOnClick: true,
        hitOnHold: false,
        hitsPerSecond: 1,
        damageMode: 'blunt',
        bluntRadius: 1,
    },
];

export const DEFAULT_TOOL: ToolDefinition = TOOL_DEFINITIONS[0];

export function getToolDefinition(toolId: string): ToolDefinition | undefined {
    return TOOL_DEFINITIONS.find((entry) => entry.id === toolId);
}