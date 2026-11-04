import type { Extmark } from "./extmarks.js";
export interface ExtmarksSnapshot {
    extmarks: Map<number, Extmark>;
    nextId: number;
}
export declare class ExtmarksHistory {
    private undoStack;
    private redoStack;
    saveSnapshot(extmarks: Map<number, Extmark>, nextId: number): void;
    undo(): ExtmarksSnapshot | null;
    redo(): ExtmarksSnapshot | null;
    pushRedo(snapshot: ExtmarksSnapshot): void;
    pushUndo(snapshot: ExtmarksSnapshot): void;
    clear(): void;
    canUndo(): boolean;
    canRedo(): boolean;
}
