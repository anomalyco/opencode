import type { PluginAccessOptions, SerovalMode } from '../plugin';
import { SpecialReference } from '../special-reference';
import type { SerovalArrayBufferNode, SerovalAsyncIteratorFactoryNode, SerovalIndexedValueNode, SerovalIteratorFactoryNode, SerovalMapNode, SerovalNode, SerovalNullConstructorNode, SerovalObjectNode, SerovalObjectRecordNode, SerovalPromiseConstructorNode, SerovalReferenceNode, SerovalSpecialReferenceNode, SerovalWKSymbolNode } from '../types';
export interface BaseParserContextOptions extends PluginAccessOptions {
    disabledFeatures?: number;
    refs?: Map<unknown, number>;
    depthLimit?: number;
}
export declare const enum ParserNodeType {
    Fresh = 0,
    Indexed = 1,
    Referenced = 2
}
export interface FreshNode {
    type: ParserNodeType.Fresh;
    value: number;
}
export interface IndexedNode {
    type: ParserNodeType.Indexed;
    value: SerovalIndexedValueNode;
}
export interface ReferencedNode {
    type: ParserNodeType.Referenced;
    value: SerovalReferenceNode;
}
type ObjectNode = FreshNode | IndexedNode | ReferencedNode;
export interface BaseParserContext extends PluginAccessOptions {
    readonly mode: SerovalMode;
    marked: Set<number>;
    refs: Map<unknown, number>;
    features: number;
    depthLimit: number;
}
export declare function createBaseParserContext(mode: SerovalMode, options: BaseParserContextOptions): BaseParserContext;
/**
 * Ensures that the value (based on an identifier) has been visited by the parser.
 * @param ctx
 * @param id
 */
export declare function markParserRef(ctx: BaseParserContext, id: number): void;
export declare function isParserRefMarked(ctx: BaseParserContext, id: number): boolean;
/**
 * Creates an identifier for a value
 * @param ctx
 * @param current
 */
export declare function createIndexForValue<T>(ctx: BaseParserContext, current: T): number;
export declare function getNodeForIndexedValue<T>(ctx: BaseParserContext, current: T): FreshNode | IndexedNode;
export declare function getReferenceNode<T>(ctx: BaseParserContext, current: T): ObjectNode;
/**
 * Parsing methods
 */
export declare function parseWellKnownSymbol(ctx: BaseParserContext, current: symbol): SerovalIndexedValueNode | SerovalWKSymbolNode | SerovalReferenceNode;
export declare function parseSpecialReference(ctx: BaseParserContext, ref: SpecialReference): SerovalIndexedValueNode | SerovalSpecialReferenceNode;
export declare function parseIteratorFactory(ctx: BaseParserContext): SerovalIndexedValueNode | SerovalIteratorFactoryNode;
export declare function parseAsyncIteratorFactory(ctx: BaseParserContext): SerovalIndexedValueNode | SerovalAsyncIteratorFactoryNode;
export declare function createObjectNode(id: number, current: Record<string, unknown>, empty: boolean, record: SerovalObjectRecordNode): SerovalObjectNode | SerovalNullConstructorNode;
export declare function createMapNode(ctx: BaseParserContext, id: number, k: SerovalNode[], v: SerovalNode[]): SerovalMapNode;
export declare function createPromiseConstructorNode(ctx: BaseParserContext, id: number, resolver: number): SerovalPromiseConstructorNode;
export declare function createArrayBufferNode(ctx: BaseParserContext, id: number, current: ArrayBuffer): SerovalArrayBufferNode;
export {};
//# sourceMappingURL=parser.d.ts.map