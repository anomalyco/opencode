export type SessionModel = {
    providerID: string;
    modelID: string;
};
export declare function setSessionModel(sessionID: string, model: SessionModel): void;
export declare function getSessionModel(sessionID: string): SessionModel | undefined;
export declare function clearSessionModel(sessionID: string): void;
