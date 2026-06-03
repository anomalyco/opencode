import type { TextRenderable } from "./Text.js";
import { BaseRenderable, type BaseRenderableOptions } from "../Renderable.js";
import { RGBA } from "../lib/RGBA.js";
import { StyledText } from "../lib/styled-text.js";
import { type TextChunk } from "../text-buffer.js";
import type { RenderContext } from "../types.js";
export interface TextNodeOptions extends BaseRenderableOptions {
    fg?: string | RGBA;
    bg?: string | RGBA;
    attributes?: number;
    link?: {
        url: string;
    };
}
declare const BrandedTextNodeRenderable: unique symbol;
export declare function isTextNodeRenderable(obj: any): obj is TextNodeRenderable;
export declare class TextNodeRenderable extends BaseRenderable {
    [BrandedTextNodeRenderable]: boolean;
    private _fg?;
    private _bg?;
    private _attributes;
    private _link?;
    private _children;
    parent: TextNodeRenderable | null;
    constructor(options: TextNodeOptions);
    get children(): (string | TextNodeRenderable)[];
    set children(children: (string | TextNodeRenderable)[]);
    requestRender(): void;
    add(obj: TextNodeRenderable | StyledText | string, index?: number): number;
    replace(obj: TextNodeRenderable | string, index: number): void;
    insertBefore(child: string | TextNodeRenderable | StyledText, anchorNode: TextNodeRenderable | string | unknown): this;
    remove(id: string): this;
    clear(): void;
    mergeStyles(parentStyle: {
        fg?: RGBA;
        bg?: RGBA;
        attributes: number;
        link?: {
            url: string;
        };
    }): {
        fg?: RGBA;
        bg?: RGBA;
        attributes: number;
        link?: {
            url: string;
        };
    };
    gatherWithInheritedStyle(parentStyle?: {
        fg?: RGBA;
        bg?: RGBA;
        attributes: number;
        link?: {
            url: string;
        };
    }): TextChunk[];
    static fromString(text: string, options?: Partial<TextNodeOptions>): TextNodeRenderable;
    static fromNodes(nodes: TextNodeRenderable[], options?: Partial<TextNodeOptions>): TextNodeRenderable;
    toChunks(parentStyle?: {
        fg?: RGBA;
        bg?: RGBA;
        attributes: number;
        link?: {
            url: string;
        };
    }): TextChunk[];
    getChildren(): BaseRenderable[];
    getChildrenCount(): number;
    getRenderable(id: string): BaseRenderable | undefined;
    getRenderableIndex(id: string): number;
    get fg(): RGBA | undefined;
    set fg(fg: RGBA | string | undefined);
    set bg(bg: RGBA | string | undefined);
    get bg(): RGBA | undefined;
    set attributes(attributes: number);
    get attributes(): number;
    set link(link: {
        url: string;
    } | undefined);
    get link(): {
        url: string;
    } | undefined;
    findDescendantById(id: string): BaseRenderable | undefined;
}
export declare class RootTextNodeRenderable extends TextNodeRenderable {
    private readonly ctx;
    textParent: TextRenderable;
    constructor(ctx: RenderContext, options: TextNodeOptions, textParent: TextRenderable);
    requestRender(): void;
}
export {};
