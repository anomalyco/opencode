export declare function renderAgentHeader(agent: string | null, model: string | null, variant: string | null, agentColorsByName: Record<string, string>): void;
export declare function openThinkBlock(): void;
export declare function closeThinkBlock(): void;
export declare function writePaddedText(text: string, atLineStart: boolean): {
    output: string;
    atLineStart: boolean;
};
