import type { EditBuffer } from "../edit-buffer.js";
import type { EditorView } from "../editor-view.js";
export interface Extmark {
    id: number;
    start: number;
    end: number;
    virtual: boolean;
    styleId?: number;
    priority?: number;
    data?: any;
    typeId: number;
}
export interface ExtmarkOptions {
    start: number;
    end: number;
    virtual?: boolean;
    styleId?: number;
    priority?: number;
    data?: any;
    typeId?: number;
    metadata?: any;
}
/**
 * WARNING: This is simulating extmarks in the edit buffer
 * and will move to a real native implementation in the future.
 * Use with caution.
 */
export declare class ExtmarksController {
    private editBuffer;
    private editorView;
    private extmarks;
    private extmarksByTypeId;
    private metadata;
    private nextId;
    private destroyed;
    private history;
    private typeNameToId;
    private typeIdToName;
    private nextTypeId;
    private originalMoveCursorLeft;
    private originalMoveCursorRight;
    private originalSetCursorByOffset;
    private originalMoveUpVisual;
    private originalMoveDownVisual;
    private originalDeleteCharBackward;
    private originalDeleteChar;
    private originalInsertText;
    private originalInsertChar;
    private originalDeleteRange;
    private originalSetText;
    private originalReplaceText;
    private originalClear;
    private originalNewLine;
    private originalDeleteLine;
    private originalEditorViewDeleteSelectedText;
    private originalUndo;
    private originalRedo;
    constructor(editBuffer: EditBuffer, editorView: EditorView);
    private wrapCursorMovement;
    private wrapDeletion;
    private wrapInsertion;
    private wrapEditorViewDeleteSelectedText;
    private setupContentChangeListener;
    private deleteExtmarkById;
    private findVirtualExtmarkContaining;
    private adjustExtmarksAfterInsertion;
    adjustExtmarksAfterDeletion(deleteOffset: number, length: number): void;
    private offsetToPosition;
    private positionToOffset;
    private updateHighlights;
    private offsetExcludingNewlines;
    create(options: ExtmarkOptions): number;
    delete(id: number): boolean;
    get(id: number): Extmark | null;
    getAll(): Extmark[];
    getVirtual(): Extmark[];
    getAtOffset(offset: number): Extmark[];
    getAllForTypeId(typeId: number): Extmark[];
    clear(): void;
    private saveSnapshot;
    private restoreSnapshot;
    private wrapUndoRedo;
    registerType(typeName: string): number;
    getTypeId(typeName: string): number | null;
    getTypeName(typeId: number): string | null;
    getMetadataFor(extmarkId: number): any;
    destroy(): void;
}
export declare function createExtmarksController(editBuffer: EditBuffer, editorView: EditorView): ExtmarksController;
