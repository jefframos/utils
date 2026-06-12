import { DEFAULT_TOOL, TOOL_DEFINITIONS, type ToolDefinition } from '../content/tools.ts';

export type { ToolDefinition } from '../content/tools.ts';

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
        return TOOL_DEFINITIONS;
    }
}
