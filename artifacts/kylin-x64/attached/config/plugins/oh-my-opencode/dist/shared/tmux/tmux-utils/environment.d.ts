export type SplitDirection = "-h" | "-v";
export declare function isInsideTmuxEnvironment(environment: Record<string, string | undefined>): boolean;
export declare function isInsideTmux(): boolean;
export declare function getCurrentPaneId(): string | undefined;
