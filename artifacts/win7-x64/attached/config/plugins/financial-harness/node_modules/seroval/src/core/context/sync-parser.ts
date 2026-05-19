import {
  createAggregateErrorNode,
  createArrayNode,
  createAsyncIteratorFactoryInstanceNode,
  createBigIntNode,
  createBigIntTypedArrayNode,
  createBoxedNode,
  createDataViewNode,
  createDateNode,
  createErrorNode,
  createIteratorFactoryInstanceNode,
  createNumberNode,
  createPluginNode,
  createRegExpNode,
  createSequenceNode,
  createSetNode,
  createStreamConstructorNode,
  createStreamNextNode,
  createStreamReturnNode,
  createStreamThrowNode,
  createStringNode,
  createTypedArrayNode,
} from '../base-primitives';
import { Feature } from '../compat';
import { NIL, SerovalNodeType } from '../constants';
import {
  SerovalDepthLimitError,
  SerovalParserError,
  SerovalUnsupportedTypeError,
} from '../errors';
import { FALSE_NODE, NULL_NODE, TRUE_NODE, UNDEFINED_NODE } from '../literals';
import { createSerovalNode } from '../node';
import { OpaqueReference } from '../opaque-reference';
import { type Plugin, SerovalMode } from '../plugin';
import {
  createSequenceFromIterable,
  isSequence,
  type Sequence,
} from '../sequence';
import { SpecialReference } from '../special-reference';
import type { Stream } from '../stream';
import {
  createStream,
  createStreamFromAsyncIterable,
  isStream,
} from '../stream';
import { serializeString } from '../string';
import {
  SYM_ASYNC_ITERATOR,
  SYM_IS_CONCAT_SPREADABLE,
  SYM_ITERATOR,
  SYM_TO_STRING_TAG,
} from '../symbols';
import type {
  SerovalAggregateErrorNode,
  SerovalArrayNode,
  SerovalBigIntTypedArrayNode,
  SerovalBoxedNode,
  SerovalDataViewNode,
  SerovalErrorNode,
  SerovalMapNode,
  SerovalNode,
  SerovalNodeWithID,
  SerovalNullConstructorNode,
  SerovalObjectNode,
  SerovalObjectRecordKey,
  SerovalObjectRecordNode,
  SerovalPluginNode,
  SerovalPromiseConstructorNode,
  SerovalSequenceNode,
  SerovalSetNode,
  SerovalTypedArrayNode,
} from '../types';
import { getErrorOptions } from '../utils/error';
import type {
  BigIntTypedArrayValue,
  TypedArrayValue,
} from '../utils/typed-array';
import type { BaseParserContext, BaseParserContextOptions } from './parser';
import {
  createArrayBufferNode,
  createBaseParserContext,
  createIndexForValue,
  createMapNode,
  createObjectNode,
  createPromiseConstructorNode,
  getReferenceNode,
  parseAsyncIteratorFactory,
  parseIteratorFactory,
  ParserNodeType,
  parseSpecialReference,
  parseWellKnownSymbol,
} from './parser';

type ObjectLikeNode = SerovalObjectNode | SerovalNullConstructorNode;

export type SyncParserContextOptions = BaseParserContextOptions;

const enum ParserMode {
  Sync = 1,
  Stream = 2,
}

export interface SyncParserContext {
  type: ParserMode.Sync;
  base: BaseParserContext;
  child: SyncParsePluginContext | undefined;
}

export function createSyncParserContext(
  mode: SerovalMode,
  options: SyncParserContextOptions,
): SyncParserContext {
  return {
    type: ParserMode.Sync,
    base: createBaseParserContext(mode, options),
    child: NIL,
  };
}

export class SyncParsePluginContext {
  constructor(
    private _p: SyncParserContext,
    private depth: number,
  ) {}

  parse<T>(current: T): SerovalNode {
    return parseSOS(this._p, this.depth, current);
  }
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
export class StreamParsePluginContext {
  constructor(
    private _p: StreamParserContext,
    private depth: number,
  ) {}

  parse<T>(current: T): SerovalNode {
    return parseSOS(this._p, this.depth, current);
  }

  parseWithError<T>(current: T): SerovalNode | undefined {
    return parseWithError(this._p, this.depth, current);
  }

  isAlive(): boolean {
    return this._p.state.alive;
  }

  pushPendingState(): void {
    pushPendingState(this._p);
  }

  popPendingState(): void {
    popPendingState(this._p);
  }

  onParse(node: SerovalNode): void {
    onParse(this._p, node);
  }

  onError(error: unknown): void {
    onError(this._p, error);
  }
}

interface StreamParserState {
  // Life cycle
  alive: boolean;
  // Number of pending things
  pending: number;
  //
  initial: boolean;
  //
  buffer: SerovalNode[];
  // Callbacks
  onParse: (node: SerovalNode, initial: boolean) => void;
  onError?: (error: unknown) => void;
  onDone?: () => void;
}

function createStreamParserState(
  options: StreamParserContextOptions,
): StreamParserState {
  return {
    alive: true,
    pending: 0,
    initial: true,
    buffer: [],
    onParse: options.onParse,
    onError: options.onError,
    onDone: options.onDone,
  };
}

export function createStreamParserContext(
  options: StreamParserContextOptions,
): StreamParserContext {
  return {
    type: ParserMode.Stream,
    base: createBaseParserContext(SerovalMode.Cross, options),
    state: createStreamParserState(options),
  };
}

type SOSParserContext = SyncParserContext | StreamParserContext;

function parseItems(
  ctx: SOSParserContext,
  depth: number,
  current: unknown[],
): (SerovalNode | 0)[] {
  const nodes: (SerovalNode | 0)[] = [];
  for (let i = 0, len = current.length; i < len; i++) {
    if (i in current) {
      nodes[i] = parseSOS(ctx, depth, current[i]);
    } else {
      nodes[i] = 0;
    }
  }
  return nodes;
}

function parseArray(
  ctx: SOSParserContext,
  depth: number,
  id: number,
  current: unknown[],
): SerovalArrayNode {
  return createArrayNode(id, current, parseItems(ctx, depth, current));
}

function parseProperties(
  ctx: SOSParserContext,
  depth: number,
  properties: Record<string | symbol, unknown>,
): SerovalObjectRecordNode {
  const entries = Object.entries(properties);
  const keyNodes: SerovalObjectRecordKey[] = [];
  const valueNodes: SerovalNode[] = [];
  for (let i = 0, len = entries.length; i < len; i++) {
    keyNodes.push(serializeString(entries[i][0]));
    valueNodes.push(parseSOS(ctx, depth, entries[i][1]));
  }
  // Check special properties, symbols in this case
  if (SYM_ITERATOR in properties) {
    keyNodes.push(parseWellKnownSymbol(ctx.base, SYM_ITERATOR));
    valueNodes.push(
      createIteratorFactoryInstanceNode(
        parseIteratorFactory(ctx.base),
        parseSOS(
          ctx,
          depth,
          createSequenceFromIterable(
            properties as unknown as Iterable<unknown>,
          ),
        ) as SerovalNodeWithID,
      ),
    );
  }
  if (SYM_ASYNC_ITERATOR in properties) {
    keyNodes.push(parseWellKnownSymbol(ctx.base, SYM_ASYNC_ITERATOR));
    valueNodes.push(
      createAsyncIteratorFactoryInstanceNode(
        parseAsyncIteratorFactory(ctx.base),
        parseSOS(
          ctx,
          depth,
          ctx.type === ParserMode.Sync
            ? createStream()
            : createStreamFromAsyncIterable(
                properties as unknown as AsyncIterable<unknown>,
              ),
        ) as SerovalNodeWithID,
      ),
    );
  }
  if (SYM_TO_STRING_TAG in properties) {
    keyNodes.push(parseWellKnownSymbol(ctx.base, SYM_TO_STRING_TAG));
    valueNodes.push(createStringNode(properties[SYM_TO_STRING_TAG] as string));
  }
  if (SYM_IS_CONCAT_SPREADABLE in properties) {
    keyNodes.push(parseWellKnownSymbol(ctx.base, SYM_IS_CONCAT_SPREADABLE));
    valueNodes.push(
      properties[SYM_IS_CONCAT_SPREADABLE] ? TRUE_NODE : FALSE_NODE,
    );
  }
  return {
    k: keyNodes,
    v: valueNodes,
  };
}

function parsePlainObject(
  ctx: SOSParserContext,
  depth: number,
  id: number,
  current: Record<string, unknown>,
  empty: boolean,
): ObjectLikeNode {
  return createObjectNode(
    id,
    current,
    empty,
    parseProperties(ctx, depth, current),
  );
}

function parseBoxed(
  ctx: SOSParserContext,
  depth: number,
  id: number,
  current: object,
): SerovalBoxedNode {
  return createBoxedNode(id, parseSOS(ctx, depth, current.valueOf()));
}

function parseTypedArray(
  ctx: SOSParserContext,
  depth: number,
  id: number,
  current: TypedArrayValue,
): SerovalTypedArrayNode {
  return createTypedArrayNode(
    id,
    current,
    parseSOS(ctx, depth, current.buffer),
  );
}

function parseBigIntTypedArray(
  ctx: SOSParserContext,
  depth: number,
  id: number,
  current: BigIntTypedArrayValue,
): SerovalBigIntTypedArrayNode {
  return createBigIntTypedArrayNode(
    id,
    current,
    parseSOS(ctx, depth, current.buffer),
  );
}

function parseDataView(
  ctx: SOSParserContext,
  depth: number,
  id: number,
  current: DataView,
): SerovalDataViewNode {
  return createDataViewNode(id, current, parseSOS(ctx, depth, current.buffer));
}

function parseError(
  ctx: SOSParserContext,
  depth: number,
  id: number,
  current: Error,
): SerovalErrorNode {
  const options = getErrorOptions(current, ctx.base.features);
  return createErrorNode(
    id,
    current,
    options ? parseProperties(ctx, depth, options) : NIL,
  );
}

function parseAggregateError(
  ctx: SOSParserContext,
  depth: number,
  id: number,
  current: AggregateError,
): SerovalAggregateErrorNode {
  const options = getErrorOptions(current, ctx.base.features);
  return createAggregateErrorNode(
    id,
    current,
    options ? parseProperties(ctx, depth, options) : NIL,
  );
}

function parseMap(
  ctx: SOSParserContext,
  depth: number,
  id: number,
  current: Map<unknown, unknown>,
): SerovalMapNode {
  const keyNodes: SerovalNode[] = [];
  const valueNodes: SerovalNode[] = [];
  for (const [key, value] of current.entries()) {
    keyNodes.push(parseSOS(ctx, depth, key));
    valueNodes.push(parseSOS(ctx, depth, value));
  }
  return createMapNode(ctx.base, id, keyNodes, valueNodes);
}

function parseSet(
  ctx: SOSParserContext,
  depth: number,
  id: number,
  current: Set<unknown>,
): SerovalSetNode {
  const items: SerovalNode[] = [];
  for (const item of current.keys()) {
    items.push(parseSOS(ctx, depth, item));
  }
  return createSetNode(id, items);
}

function parseStream(
  ctx: SOSParserContext,
  depth: number,
  id: number,
  current: Stream<unknown>,
): SerovalNode {
  const result = createStreamConstructorNode(
    id,
    parseSpecialReference(ctx.base, SpecialReference.StreamConstructor),
    [],
  );
  if (ctx.type === ParserMode.Sync) {
    return result;
  }
  pushPendingState(ctx);
  current.on({
    next: value => {
      if (ctx.state.alive) {
        const parsed = parseWithError(ctx, depth, value);
        if (parsed) {
          onParse(ctx, createStreamNextNode(id, parsed));
        }
      }
    },
    throw: value => {
      if (ctx.state.alive) {
        const parsed = parseWithError(ctx, depth, value);
        if (parsed) {
          onParse(ctx, createStreamThrowNode(id, parsed));
        }
      }
      popPendingState(ctx);
    },
    return: value => {
      if (ctx.state.alive) {
        const parsed = parseWithError(ctx, depth, value);
        if (parsed) {
          onParse(ctx, createStreamReturnNode(id, parsed));
        }
      }
      popPendingState(ctx);
    },
  });
  return result;
}

function handlePromiseSuccess(
  this: StreamParserContext,
  id: number,
  depth: number,
  data: unknown,
): void {
  if (this.state.alive) {
    const parsed = parseWithError(this, depth, data);
    if (parsed) {
      onParse(
        this,
        createSerovalNode(
          SerovalNodeType.PromiseSuccess,
          id,
          NIL,
          NIL,
          NIL,
          NIL,
          NIL,
          [
            parseSpecialReference(this.base, SpecialReference.PromiseSuccess),
            parsed,
          ],
          NIL,
          NIL,
          NIL,
          NIL,
        ),
      );
    }
    popPendingState(this);
  }
}

function handlePromiseFailure(
  this: StreamParserContext,
  id: number,
  depth: number,
  data: unknown,
): void {
  if (this.state.alive) {
    const parsed = parseWithError(this, depth, data);
    if (parsed) {
      onParse(
        this,
        createSerovalNode(
          SerovalNodeType.PromiseFailure,
          id,
          NIL,
          NIL,
          NIL,
          NIL,
          NIL,
          [
            parseSpecialReference(this.base, SpecialReference.PromiseFailure),
            parsed,
          ],
          NIL,
          NIL,
          NIL,
          NIL,
        ),
      );
    }
  }
  popPendingState(this);
}

function parsePromise(
  ctx: SOSParserContext,
  depth: number,
  id: number,
  current: Promise<unknown>,
): SerovalPromiseConstructorNode {
  // Creates a unique reference for the promise resolver
  const resolver = createIndexForValue(ctx.base, {});
  if (ctx.type === ParserMode.Stream) {
    pushPendingState(ctx);
    current.then(
      handlePromiseSuccess.bind(ctx, resolver, depth),
      handlePromiseFailure.bind(ctx, resolver, depth),
    );
  }
  return createPromiseConstructorNode(ctx.base, id, resolver);
}

function parsePluginSync(
  ctx: SyncParserContext,
  depth: number,
  id: number,
  current: unknown,
  currentPlugins: Plugin<any, any>[],
): SerovalPluginNode | undefined {
  for (let i = 0, len = currentPlugins.length; i < len; i++) {
    const plugin = currentPlugins[i];
    if (plugin.parse.sync && plugin.test(current)) {
      return createPluginNode(
        id,
        plugin.tag,
        plugin.parse.sync(current, new SyncParsePluginContext(ctx, depth), {
          id,
        }),
      );
    }
  }
  return NIL;
}

function parsePluginStream(
  ctx: StreamParserContext,
  depth: number,
  id: number,
  current: unknown,
  currentPlugins: Plugin<any, any>[],
): SerovalPluginNode | undefined {
  for (let i = 0, len = currentPlugins.length; i < len; i++) {
    const plugin = currentPlugins[i];
    if (plugin.parse.stream && plugin.test(current)) {
      return createPluginNode(
        id,
        plugin.tag,
        plugin.parse.stream(current, new StreamParsePluginContext(ctx, depth), {
          id,
        }),
      );
    }
  }
  return NIL;
}

function parsePlugin(
  ctx: SOSParserContext,
  depth: number,
  id: number,
  current: unknown,
): SerovalPluginNode | undefined {
  const currentPlugins = ctx.base.plugins;
  if (currentPlugins) {
    return ctx.type === ParserMode.Sync
      ? parsePluginSync(ctx, depth, id, current, currentPlugins)
      : parsePluginStream(ctx, depth, id, current, currentPlugins);
  }
  return NIL;
}

function parseSequence(
  ctx: SOSParserContext,
  depth: number,
  id: number,
  current: Sequence,
): SerovalSequenceNode {
  const nodes: SerovalNode[] = [];
  for (let i = 0, len = current.v.length; i < len; i++) {
    nodes[i] = parseSOS(ctx, depth, current.v[i]);
  }
  return createSequenceNode(id, nodes, current.t, current.d);
}

function parseObjectPhase2(
  ctx: SOSParserContext,
  depth: number,
  id: number,
  current: object,
  currentClass: unknown,
): SerovalNode {
  switch (currentClass) {
    case Object:
      return parsePlainObject(
        ctx,
        depth,
        id,
        current as Record<string, unknown>,
        false,
      );
    case NIL:
      return parsePlainObject(
        ctx,
        depth,
        id,
        current as Record<string, unknown>,
        true,
      );
    case Date:
      return createDateNode(id, current as unknown as Date);
    case Error:
    case EvalError:
    case RangeError:
    case ReferenceError:
    case SyntaxError:
    case TypeError:
    case URIError:
      return parseError(ctx, depth, id, current as unknown as Error);
    case Number:
    case Boolean:
    case String:
    case BigInt:
      return parseBoxed(ctx, depth, id, current);
    case ArrayBuffer:
      return createArrayBufferNode(
        ctx.base,
        id,
        current as unknown as ArrayBuffer,
      );
    case Int8Array:
    case Int16Array:
    case Int32Array:
    case Uint8Array:
    case Uint16Array:
    case Uint32Array:
    case Uint8ClampedArray:
    case Float32Array:
    case Float64Array:
      return parseTypedArray(
        ctx,
        depth,
        id,
        current as unknown as TypedArrayValue,
      );
    case DataView:
      return parseDataView(ctx, depth, id, current as unknown as DataView);
    case Map:
      return parseMap(
        ctx,
        depth,
        id,
        current as unknown as Map<unknown, unknown>,
      );
    case Set:
      return parseSet(ctx, depth, id, current as unknown as Set<unknown>);
    default:
      break;
  }
  // Promises
  if (currentClass === Promise || current instanceof Promise) {
    return parsePromise(ctx, depth, id, current as unknown as Promise<unknown>);
  }
  const currentFeatures = ctx.base.features;
  if (currentFeatures & Feature.RegExp && currentClass === RegExp) {
    return createRegExpNode(id, current as unknown as RegExp);
  }
  // BigInt Typed Arrays
  if (currentFeatures & Feature.BigIntTypedArray) {
    switch (currentClass) {
      case BigInt64Array:
      case BigUint64Array:
        return parseBigIntTypedArray(
          ctx,
          depth,
          id,
          current as unknown as BigIntTypedArrayValue,
        );
      default:
        break;
    }
  }
  if (
    currentFeatures & Feature.AggregateError &&
    typeof AggregateError !== 'undefined' &&
    (currentClass === AggregateError || current instanceof AggregateError)
  ) {
    return parseAggregateError(
      ctx,
      depth,
      id,
      current as unknown as AggregateError,
    );
  }
  // Slow path. We only need to handle Errors and Iterators
  // since they have very broad implementations.
  if (current instanceof Error) {
    return parseError(ctx, depth, id, current);
  }
  // Generator functions don't have a global constructor
  // despite existing
  if (SYM_ITERATOR in current || SYM_ASYNC_ITERATOR in current) {
    return parsePlainObject(ctx, depth, id, current, !!currentClass);
  }
  throw new SerovalUnsupportedTypeError(current);
}

function parseObject(
  ctx: SOSParserContext,
  depth: number,
  id: number,
  current: object,
): SerovalNode {
  if (Array.isArray(current)) {
    return parseArray(ctx, depth, id, current);
  }
  if (isStream(current)) {
    return parseStream(ctx, depth, id, current);
  }
  if (isSequence(current)) {
    return parseSequence(ctx, depth, id, current);
  }
  const currentClass = current.constructor;
  if (currentClass === OpaqueReference) {
    return parseSOS(
      ctx,
      depth,
      (current as OpaqueReference<unknown, unknown>).replacement,
    );
  }
  const parsed = parsePlugin(ctx, depth, id, current);
  if (parsed) {
    return parsed;
  }
  return parseObjectPhase2(ctx, depth, id, current, currentClass);
}

function parseFunction(
  ctx: SOSParserContext,
  depth: number,
  current: unknown,
): SerovalNode {
  const ref = getReferenceNode(ctx.base, current);
  if (ref.type !== ParserNodeType.Fresh) {
    return ref.value;
  }
  const plugin = parsePlugin(ctx, depth, ref.value, current);
  if (plugin) {
    return plugin;
  }
  throw new SerovalUnsupportedTypeError(current);
}

export function parseSOS<T>(
  ctx: SOSParserContext,
  depth: number,
  current: T,
): SerovalNode {
  if (depth >= ctx.base.depthLimit) {
    throw new SerovalDepthLimitError(ctx.base.depthLimit);
  }
  switch (typeof current) {
    case 'boolean':
      return current ? TRUE_NODE : FALSE_NODE;
    case 'undefined':
      return UNDEFINED_NODE;
    case 'string':
      return createStringNode(current as string);
    case 'number':
      return createNumberNode(current as number);
    case 'bigint':
      return createBigIntNode(current as bigint);
    case 'object': {
      if (current) {
        const ref = getReferenceNode(ctx.base, current);
        return ref.type === ParserNodeType.Fresh
          ? parseObject(ctx, depth + 1, ref.value, current as object)
          : ref.value;
      }
      return NULL_NODE;
    }
    case 'symbol':
      return parseWellKnownSymbol(ctx.base, current);
    case 'function': {
      return parseFunction(ctx, depth, current);
    }
    default:
      throw new SerovalUnsupportedTypeError(current);
  }
}

export function parseTop<T>(ctx: SyncParserContext, current: T): SerovalNode {
  try {
    return parseSOS(ctx, 0, current);
  } catch (error) {
    throw error instanceof SerovalParserError
      ? error
      : new SerovalParserError(error);
  }
}

function onParse(ctx: StreamParserContext, node: SerovalNode): void {
  // If the value emitted happens to be during parsing, we push to the
  // buffer and emit after the initial parsing is done.
  if (ctx.state.initial) {
    ctx.state.buffer.push(node);
  } else {
    onParseInternal(ctx, node, false);
  }
}

function onError(ctx: StreamParserContext, error: unknown): void {
  if (ctx.state.onError) {
    ctx.state.onError(error);
  } else {
    throw error instanceof SerovalParserError
      ? error
      : new SerovalParserError(error);
  }
}

function onDone(ctx: StreamParserContext): void {
  if (ctx.state.onDone) {
    ctx.state.onDone();
  }
}

function onParseInternal(
  ctx: StreamParserContext,
  node: SerovalNode,
  initial: boolean,
): void {
  try {
    ctx.state.onParse(node, initial);
  } catch (error) {
    onError(ctx, error);
  }
}

function pushPendingState(ctx: StreamParserContext): void {
  ctx.state.pending++;
}

function popPendingState(ctx: StreamParserContext): void {
  if (--ctx.state.pending <= 0) {
    onDone(ctx);
  }
}

function parseWithError<T>(
  ctx: StreamParserContext,
  depth: number,
  current: T,
): SerovalNode | undefined {
  try {
    return parseSOS(ctx, depth, current);
  } catch (err) {
    onError(ctx, err);
    return NIL;
  }
}

export function startStreamParse<T>(
  ctx: StreamParserContext,
  current: T,
): void {
  const parsed = parseWithError(ctx, 0, current);
  if (parsed) {
    onParseInternal(ctx, parsed, true);
    ctx.state.initial = false;
    flushStreamParse(ctx, ctx.state);

    // Check if there's any pending pushes
    if (ctx.state.pending <= 0) {
      destroyStreamParse(ctx);
    }
  }
}

function flushStreamParse(
  ctx: StreamParserContext,
  state: StreamParserState,
): void {
  for (let i = 0, len = state.buffer.length; i < len; i++) {
    onParseInternal(ctx, state.buffer[i], false);
  }
}

export function destroyStreamParse(ctx: StreamParserContext): void {
  if (ctx.state.alive) {
    onDone(ctx);
    ctx.state.alive = false;
  }
}
