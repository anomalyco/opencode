import type { SerovalMode } from '../plugin';
import type { SerovalNode } from '../types';
import type { BaseParserContext, BaseParserContextOptions } from './parser';
export type AsyncParserContextOptions = BaseParserContextOptions;
export interface AsyncParserContext {
    base: BaseParserContext;
    child: AsyncParsePluginContext | undefined;
}
export declare function createAsyncParserContext(mode: SerovalMode, options: AsyncParserContextOptions): AsyncParserContext;
export declare class AsyncParsePluginContext {
    private _p;
    private depth;
    constructor(_p: AsyncParserContext, depth: number);
    parse<T>(current: T): Promise<SerovalNode>;
}
export declare function parseObjectAsync(ctx: AsyncParserContext, depth: number, id: number, current: object): Promise<SerovalNode>;
export declare function parseFunctionAsync(ctx: AsyncParserContext, depth: number, current: unknown): Promise<SerovalNode>;
export declare function parseAsync<T>(ctx: AsyncParserContext, depth: number, current: T): Promise<SerovalNode>;
export declare function parseTopAsync<T>(ctx: AsyncParserContext, current: T): Promise<SerovalNode>;
//# sourceMappingURL=async-parser.d.ts.map