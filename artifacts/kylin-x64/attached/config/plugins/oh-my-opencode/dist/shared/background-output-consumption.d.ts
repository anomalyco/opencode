export declare function recordBackgroundOutputConsumption(parentSessionID: string | undefined, parentMessageID: string | undefined, taskSessionID: string | undefined): void;
export declare function restoreBackgroundOutputConsumption(parentSessionID: string | undefined, parentMessageID: string | undefined): void;
export declare function clearBackgroundOutputConsumptionsForParentSession(sessionID: string | undefined): void;
export declare function clearBackgroundOutputConsumptionsForTaskSession(taskSessionID: string | undefined): void;
export declare function clearBackgroundOutputConsumptionState(): void;
