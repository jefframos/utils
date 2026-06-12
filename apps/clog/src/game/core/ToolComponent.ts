import { DEFAULT_TOOL, TOOL_DEFINITIONS, type ToolDefinition } from '../content/tools.ts';

export type { ToolDefinition } from '../content/tools.ts';

export class ToolComponent {
    private activeToolId: string;

    constructor(initialTool: ToolDefinition = DEFAULT_TOOL) {
        this.activeToolId = initialTool.id;
    }

    getActiveTool(): ToolDefinition {
        return TOOL_DEFINITIONS.find((entry) => entry.id === this.activeToolId) ?? DEFAULT_TOOL;
    }

    setActiveTool(tool: ToolDefinition): void {
        this.activeToolId = tool.id;
    }

    getAllTools(): ToolDefinition[] {
        return TOOL_DEFINITIONS;
    }
}
