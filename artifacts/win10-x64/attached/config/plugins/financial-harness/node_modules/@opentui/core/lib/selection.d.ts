import { Renderable, type ViewportBounds } from "../index.js";
import { fonts } from "./ascii.font.js";
export declare class Selection {
    private _anchor;
    private _focus;
    private _selectedRenderables;
    private _touchedRenderables;
    private _isActive;
    private _isDragging;
    private _isStart;
    constructor(anchorRenderable: Renderable, anchor: {
        x: number;
        y: number;
    }, focus: {
        x: number;
        y: number;
    });
    get isStart(): boolean;
    set isStart(value: boolean);
    get anchor(): {
        x: number;
        y: number;
    };
    get focus(): {
        x: number;
        y: number;
    };
    set focus(value: {
        x: number;
        y: number;
    });
    get isActive(): boolean;
    set isActive(value: boolean);
    get isDragging(): boolean;
    set isDragging(value: boolean);
    get bounds(): ViewportBounds;
    updateSelectedRenderables(selectedRenderables: Renderable[]): void;
    get selectedRenderables(): Renderable[];
    updateTouchedRenderables(touchedRenderables: Renderable[]): void;
    get touchedRenderables(): Renderable[];
    getSelectedText(): string;
}
export interface LocalSelectionBounds {
    anchorX: number;
    anchorY: number;
    focusX: number;
    focusY: number;
    isActive: boolean;
}
export declare function convertGlobalToLocalSelection(globalSelection: Selection | null, localX: number, localY: number): LocalSelectionBounds | null;
export declare class ASCIIFontSelectionHelper {
    private getText;
    private getFont;
    private localSelection;
    constructor(getText: () => string, getFont: () => keyof typeof fonts);
    hasSelection(): boolean;
    getSelection(): {
        start: number;
        end: number;
    } | null;
    shouldStartSelection(localX: number, localY: number, width: number, height: number): boolean;
    onLocalSelectionChanged(localSelection: LocalSelectionBounds | null, width: number, height: number): boolean;
}
