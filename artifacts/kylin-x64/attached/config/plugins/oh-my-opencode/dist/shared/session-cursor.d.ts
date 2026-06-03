type MessageTime = {
    created?: number | string;
} | number | string | undefined;
type MessageInfo = {
    id?: string;
    time?: MessageTime;
};
export type CursorMessage = {
    info?: MessageInfo;
};
export interface CursorState {
    lastKey?: string;
    lastCount: number;
}
export declare function consumeNewMessages<T extends CursorMessage>(sessionID: string | undefined, messages: T[]): T[];
export declare function resetMessageCursor(sessionID?: string): void;
export declare function getMessageCursor(sessionID: string | undefined): CursorState | undefined;
export declare function restoreMessageCursor(sessionID: string | undefined, cursor: CursorState | undefined): void;
export {};
