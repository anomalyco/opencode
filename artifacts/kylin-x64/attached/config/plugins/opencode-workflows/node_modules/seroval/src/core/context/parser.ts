import {
  createIndexedValueNode,
  createReferenceNode,
  createWKSymbolNode,
} from '../base-primitives';
import { ALL_ENABLED } from '../compat';
import type { WellKnownSymbols } from '../constants';
import { INV_SYMBOL_REF, NIL, SerovalNodeType } from '../constants';
import { SerovalUnsupportedTypeError } from '../errors';
import { createSerovalNode } from '../node';
import type { PluginAccessOptions, SerovalMode } from '../plugin';
import { hasReferenceID } from '../reference';
import {
  ASYNC_ITERATOR,
  ITERATOR,
  SPECIAL_REFS,
  SpecialReference,
} from '../special-reference';
import { serializeString } from '../string';
import { SYM_ASYNC_ITERATOR, SYM_ITERATOR } from '../symbols';
import type {
  SerovalArrayBufferNode,
  SerovalAsyncIteratorFactoryNode,
  SerovalIndexedValueNode,
  SerovalIteratorFactoryNode,
  SerovalMapNode,
  SerovalNode,
  SerovalNullConstructorNode,
  SerovalObjectNode,
  SerovalObjectRecordNode,
  SerovalPromiseConstructorNode,
  SerovalReferenceNode,
  SerovalSpecialReferenceNode,
  SerovalWKSymbolNode,
} from '../types';
import { getObjectFlag } from '../utils/get-object-flag';

export interface BaseParserContextOptions extends PluginAccessOptions {
  disabledFeatures?: number;
  refs?: Map<unknown, number>;
  depthLimit?: number;
}

export const enum ParserNodeType {
  Fresh = 0,
  Indexed = 1,
  Referenced = 2,
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

export function createBaseParserContext(
  mode: SerovalMode,
  options: BaseParserContextOptions,
): BaseParserContext {
  return {
    plugins: options.plugins,
    mode,
    marked: new Set(),
    features: ALL_ENABLED ^ (options.disabledFeatures || 0),
    refs: options.refs || new Map(),
    depthLimit: options.depthLimit || 1000,
  };
}

/**
 * Ensures that the value (based on an identifier) has been visited by the parser.
 * @param ctx
 * @param id
 */
export function markParserRef(ctx: BaseParserContext, id: number): void {
  ctx.marked.add(id);
}

export function isParserRefMarked(ctx: BaseParserContext, id: number): boolean {
  return ctx.marked.has(id);
}

/**
 * Creates an identifier for a value
 * @param ctx
 * @param current
 */
export function createIndexForValue<T>(
  ctx: BaseParserContext,
  current: T,
): number {
  const id = ctx.refs.size;
  ctx.refs.set(current, id);
  return id;
}

export function getNodeForIndexedValue<T>(
  ctx: BaseParserContext,
  current: T,
): FreshNode | IndexedNode {
  const registeredId = ctx.refs.get(current);
  if (registeredId != null) {
    markParserRef(ctx, registeredId);
    return {
      type: ParserNodeType.Indexed,
      value: createIndexedValueNode(registeredId),
    };
  }
  return {
    type: ParserNodeType.Fresh,
    value: createIndexForValue(ctx, current),
  };
}

export function getReferenceNode<T>(
  ctx: BaseParserContext,
  current: T,
): ObjectNode {
  const indexed = getNodeForIndexedValue(ctx, current);
  if (indexed.type === ParserNodeType.Indexed) {
    return indexed;
  }
  // Special references are special ;)
  if (hasReferenceID(current)) {
    return {
      type: ParserNodeType.Referenced,
      value: createReferenceNode(indexed.value, current),
    };
  }
  return indexed;
}

/**
 * Parsing methods
 */
export function parseWellKnownSymbol(
  ctx: BaseParserContext,
  current: symbol,
): SerovalIndexedValueNode | SerovalWKSymbolNode | SerovalReferenceNode {
  const ref = getReferenceNode(ctx, current);
  if (ref.type !== ParserNodeType.Fresh) {
    return ref.value;
  }
  if (current in INV_SYMBOL_REF) {
    return createWKSymbolNode(ref.value, current as WellKnownSymbols);
  }
  throw new SerovalUnsupportedTypeError(current);
}

export function parseSpecialReference(
  ctx: BaseParserContext,
  ref: SpecialReference,
): SerovalIndexedValueNode | SerovalSpecialReferenceNode {
  const result = getNodeForIndexedValue(ctx, SPECIAL_REFS[ref]);
  if (result.type === ParserNodeType.Indexed) {
    return result.value;
  }
  return createSerovalNode(
    SerovalNodeType.SpecialReference,
    result.value,
    ref,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
  );
}

export function parseIteratorFactory(
  ctx: BaseParserContext,
): SerovalIndexedValueNode | SerovalIteratorFactoryNode {
  const result = getNodeForIndexedValue(ctx, ITERATOR);
  if (result.type === ParserNodeType.Indexed) {
    return result.value;
  }
  return createSerovalNode(
    SerovalNodeType.IteratorFactory,
    result.value,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    parseWellKnownSymbol(ctx, SYM_ITERATOR),
    NIL,
    NIL,
    NIL,
  );
}

export function parseAsyncIteratorFactory(
  ctx: BaseParserContext,
): SerovalIndexedValueNode | SerovalAsyncIteratorFactoryNode {
  const result = getNodeForIndexedValue(ctx, ASYNC_ITERATOR);
  if (result.type === ParserNodeType.Indexed) {
    return result.value;
  }
  return createSerovalNode(
    SerovalNodeType.AsyncIteratorFactory,
    result.value,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    [
      parseSpecialReference(ctx, SpecialReference.PromiseConstructor),
      parseWellKnownSymbol(ctx, SYM_ASYNC_ITERATOR),
    ],
    NIL,
    NIL,
    NIL,
    NIL,
  );
}

export function createObjectNode(
  id: number,
  current: Record<string, unknown>,
  empty: boolean,
  record: SerovalObjectRecordNode,
): SerovalObjectNode | SerovalNullConstructorNode {
  return createSerovalNode(
    empty ? SerovalNodeType.NullConstructor : SerovalNodeType.Object,
    id,
    NIL,
    NIL,
    NIL,
    record,
    NIL,
    NIL,
    NIL,
    NIL,
    getObjectFlag(current),
    NIL,
  );
}

export function createMapNode(
  ctx: BaseParserContext,
  id: number,
  k: SerovalNode[],
  v: SerovalNode[],
): SerovalMapNode {
  return createSerovalNode(
    SerovalNodeType.Map,
    id,
    NIL,
    NIL,
    NIL,
    NIL,
    { k, v },
    NIL,
    parseSpecialReference(ctx, SpecialReference.MapSentinel),
    NIL,
    NIL,
    NIL,
  );
}

export function createPromiseConstructorNode(
  ctx: BaseParserContext,
  id: number,
  resolver: number,
): SerovalPromiseConstructorNode {
  return createSerovalNode(
    SerovalNodeType.PromiseConstructor,
    id,
    resolver,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    parseSpecialReference(ctx, SpecialReference.PromiseConstructor),
    NIL,
    NIL,
    NIL,
  );
}

export function createArrayBufferNode(
  ctx: BaseParserContext,
  id: number,
  current: ArrayBuffer,
): SerovalArrayBufferNode {
  const bytes = new Uint8Array(current);
  let result = '';
  for (let i = 0, len = bytes.length; i < len; i++) {
    result += String.fromCharCode(bytes[i]);
  }
  return createSerovalNode(
    SerovalNodeType.ArrayBuffer,
    id,
    serializeString(btoa(result)),
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    parseSpecialReference(ctx, SpecialReference.ArrayBufferConstructor),
    NIL,
    NIL,
    NIL,
  );
}
