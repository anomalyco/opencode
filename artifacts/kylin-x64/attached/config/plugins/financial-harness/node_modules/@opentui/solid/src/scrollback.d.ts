import { type CliRenderer, type ScrollbackRenderContext, type ScrollbackWriter } from "@opentui/core";
import { type JSX } from "solid-js";
export interface SolidScrollbackWriterOptions {
    width?: number;
    height?: number;
    rowColumns?: number;
    startOnNewLine?: boolean;
    trailingNewline?: boolean;
}
export type SolidScrollbackNode = (ctx: ScrollbackRenderContext) => JSX.Element;
export declare function createScrollbackWriter(node: SolidScrollbackNode, options?: SolidScrollbackWriterOptions): ScrollbackWriter;
export declare function writeSolidToScrollback(renderer: CliRenderer, node: SolidScrollbackNode, options?: SolidScrollbackWriterOptions): void;
