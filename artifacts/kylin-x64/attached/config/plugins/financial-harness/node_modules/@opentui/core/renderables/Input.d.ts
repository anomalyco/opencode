import type { PasteEvent } from "../lib/KeyHandler.js";
import type { RenderContext } from "../types.js";
import { TextareaRenderable, type TextareaOptions, type TextareaAction, type KeyBinding as TextareaKeyBinding } from "./Textarea.js";
export type InputAction = TextareaAction;
export type InputKeyBinding = TextareaKeyBinding;
export interface InputRenderableOptions extends Omit<TextareaOptions, "height" | "minHeight" | "maxHeight" | "initialValue"> {
    /** Initial text value (newlines are stripped) */
    value?: string;
    /** Maximum number of characters allowed */
    maxLength?: number;
    /** Placeholder text (Input only supports string, not StyledText) */
    placeholder?: string;
}
export declare enum InputRenderableEvents {
    INPUT = "input",
    CHANGE = "change",
    ENTER = "enter"
}
/**
 * InputRenderable - A single-line text input component.
 *
 * Extends TextareaRenderable with single-line constraints:
 * - Height is always 1
 * - No text wrapping
 * - Newlines are stripped from input
 * - Enter key submits instead of inserting newline
 *
 * Inherits all keybindings from TextareaRenderable.
 */
export declare class InputRenderable extends TextareaRenderable {
    private _maxLength;
    private _lastCommittedValue;
    private static readonly defaultOptions;
    constructor(ctx: RenderContext, options: InputRenderableOptions);
    /**
     * Prevent newlines in single-line input
     */
    newLine(): boolean;
    /**
     * Handle paste - strip newlines and enforce maxLength
     */
    handlePaste(event: PasteEvent): void;
    /**
     * Insert text - strip newlines and enforce maxLength
     */
    insertText(text: string): void;
    get value(): string;
    set value(value: string);
    focus(): void;
    blur(): void;
    submit(): boolean;
    deleteCharBackward(): boolean;
    deleteChar(): boolean;
    deleteLine(): boolean;
    deleteWordBackward(): boolean;
    deleteWordForward(): boolean;
    deleteToLineStart(): boolean;
    deleteToLineEnd(): boolean;
    undo(): boolean;
    redo(): boolean;
    deleteCharacter(direction: "backward" | "forward"): void;
    set maxLength(maxLength: number);
    get maxLength(): number;
    set placeholder(placeholder: string);
    get placeholder(): string;
    set initialValue(value: string);
}
