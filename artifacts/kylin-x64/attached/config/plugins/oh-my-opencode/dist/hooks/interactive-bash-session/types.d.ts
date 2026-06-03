export interface InteractiveBashSessionState {
    sessionID: string;
    tmuxSessions: Set<string>;
    updatedAt: number;
}
export interface SerializedInteractiveBashSessionState {
    sessionID: string;
    tmuxSessions: string[];
    updatedAt: number;
}
