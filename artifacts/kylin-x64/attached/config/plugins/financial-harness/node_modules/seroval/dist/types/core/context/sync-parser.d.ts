import { SerovalMode } from '../plugin';
import type { SerovalNode } from '../types';
import type { BaseParserContext, BaseParserContextOptions } from './parser';
export type SyncParserContextOptions = BaseParserContextOptions;
declare const enum ParserMode {
    Sync = 1,
    Stream = 2
}
export interface SyncParserContext {
    type: ParserMode.Sync;
    base: BaseParserContext;
    child: SyncParsePluginContext | undefined;
}
export declare function createSyncParserContext(mode: SerovalMode, options: SyncParserContextOptions): SyncParserContext;
export declare class SyncParsePluginContext {
    private _p;
    private depth;
    constructor(_p: SyncParserContext, depth: number);
    parse<T>(current: T): SerovalNode;
}
export interface StreamParserContextOptions extends SyncParserContextOptions {
    onParse: (node: SerovalNode, initial: boolean) => void;
    onError?: (error: unknown) => void;
    onDone?: () => void;
}
export interface StreamParserContext {
    type: ParserMode.Stream;
    base: BaseParserContext;
    state: StreamParserState;
}
export declare class StreamParsePluginContext {
    private _p;
    private depth;
    constructor(_p: StreamParserContext, depth: number);
    parse<T>(current: T): SerovalNode;
    parseWithError<T>(current: T): SerovalNode | undefined;
    isAlive(): boolean;
    pushPendingState(): void;
    popPendingState(): void;
    onParse(node: SerovalNode): void;
    onError(error: unknown): void;
}
interface StreamParserState {
    alive: boolean;
    pending: number;
    initial: boolean;
    buffer: SerovalNode[];
    onParse: (node: SerovalNode, initial: boolean) => void;
    onError?: (error: unknown) => void;
    onDone?: () => void;
}
export declare function createStreamParserContext(options: StreamParserContextOptions): StreamParserContext;
type SOSParserContext = SyncParserContext | StreamParserContext;
export declare function parseSOS<T>(ctx: SOSParserContext, depth: number, current: T): SerovalNode;
export declare function parseTop<T>(ctx: SyncParserContext, current: T): SerovalNode;
export declare function startStreamParse<T>(ctx: StreamParserContext, current: T): void;
export declare function destroyStreamParse(ctx: StreamParserContext): void;
export {};
//# sourceMappingURL=sync-parser.d.ts.map