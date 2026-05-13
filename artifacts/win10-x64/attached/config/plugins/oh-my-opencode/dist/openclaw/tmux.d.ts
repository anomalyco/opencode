export declare function getCurrentTmuxSession(): string | null;
export declare function getTmuxSessionName(): Promise<string | null>;
export declare function captureTmuxPane(paneId: string, lines?: number): Promise<string | null>;
export declare function sendToPane(paneId: string, text: string, confirm?: boolean): Promise<boolean>;
export declare function isTmuxAvailable(): Promise<boolean>;
export declare function analyzePaneContent(content: string | null): {
    confidence: number;
};
