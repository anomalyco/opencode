export interface ToolHeader {
    icon: string;
    title: string;
    description?: string;
}
export declare function formatToolHeader(toolName: string, input: Record<string, unknown>): ToolHeader;
