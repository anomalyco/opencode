import { ALL_ENABLED, Feature } from '../compat';
import {
  CONSTANT_VAL,
  ERROR_CONSTRUCTOR,
  NIL,
  SerovalNodeType,
  SerovalObjectFlags,
  SYMBOL_REF,
} from '../constants';
import {
  ARRAY_BUFFER_CONSTRUCTOR,
  PROMISE_CONSTRUCTOR,
  type PromiseConstructorResolver,
} from '../constructors';
import {
  SerovalDepthLimitError,
  SerovalDeserializationError,
  SerovalMalformedNodeError,
  SerovalMissingInstanceError,
  SerovalMissingPluginError,
  SerovalUnsupportedNodeError,
} from '../errors';
import type { PluginAccessOptions } from '../plugin';
import { SerovalMode } from '../plugin';
import { getReference } from '../reference';
import { createSequence, type Sequence, sequenceToIterator } from '../sequence';
import type { Stream } from '../stream';
import { createStream, isStream, streamToAsyncIterable } from '../stream';
import { deserializeString } from '../string';
import {
  SYM_ASYNC_ITERATOR,
  SYM_IS_CONCAT_SPREADABLE,
  SYM_ITERATOR,
  SYM_TO_STRING_TAG,
} from '../symbols';
import type {
  SerovalAggregateErrorNode,
  SerovalArrayBufferNode,
  SerovalArrayNode,
  SerovalAsyncIteratorFactoryInstanceNode,
  SerovalAsyncIteratorFactoryNode,
  SerovalBigIntTypedArrayNode,
  SerovalBoxedNode,
  SerovalDataViewNode,
  SerovalDateNode,
  SerovalErrorNode,
  SerovalIteratorFactoryInstanceNode,
  SerovalIteratorFactoryNode,
  SerovalMapNode,
  SerovalNode,
  SerovalNullConstructorNode,
  SerovalObjectNode,
  SerovalObjectRecordNode,
  SerovalPluginNode,
  SerovalPromiseConstructorNode,
  SerovalPromiseNode,
  SerovalPromiseRejectNode,
  SerovalPromiseResolveNode,
  SerovalReferenceNode,
  SerovalRegExpNode,
  SerovalSequenceNode,
  SerovalSetNode,
  SerovalStreamConstructorNode,
  SerovalStreamNextNode,
  SerovalStreamReturnNode,
  SerovalStreamThrowNode,
  SerovalTypedArrayNode,
} from '../types';
import type {
  BigIntTypedArrayValue,
  TypedArrayValue,
} from '../utils/typed-array';
import { getTypedArrayConstructor } from '../utils/typed-array';

const MAX_BASE64_LENGTH = 1_000_000; // ~0.75MB decoded
const MAX_BIGINT_LENGTH = 10_000;
const MAX_REGEXP_SOURCE_LENGTH = 20_000;

function applyObjectFlag(obj: unknown, flag: SerovalObjectFlags): unknown {
  switch (flag) {
    case SerovalObjectFlags.Frozen:
      return Object.freeze(obj);
    case SerovalObjectFlags.NonExtensible:
      return Object.preventExtensions(obj);
    case SerovalObjectFlags.Sealed:
      return Object.seal(obj);
    default:
      return obj;
  }
}

type AssignableValue = AggregateError | Error | Iterable<unknown>;
type AssignableNode = SerovalAggregateErrorNode | SerovalErrorNode;

export interface BaseDeserializerContextOptions extends PluginAccessOptions {
  refs?: Map<number, unknown>;
  features?: number;
  disabledFeatures?: number;
  depthLimit?: number;
}

export interface BaseDeserializerContext extends PluginAccessOptions {
  readonly mode: SerovalMode;
  /**
   * Mapping ids to values
   */
  refs: Map<number, unknown>;
  features: number;
  depthLimit: number;
}

const DEFAULT_DEPTH_LIMIT = 1000;

export function createBaseDeserializerContext(
  mode: SerovalMode,
  options: BaseDeserializerContextOptions,
): BaseDeserializerContext {
  return {
    mode,
    plugins: options.plugins,
    refs: options.refs || new Map(),
    features: options.features ?? ALL_ENABLED ^ (options.disabledFeatures || 0),
    depthLimit: options.depthLimit || DEFAULT_DEPTH_LIMIT,
  };
}

export interface VanillaDeserializerContextOptions
  extends Omit<BaseDeserializerContextOptions, 'refs'> {
  markedRefs: number[] | Set<number>;
}

export interface VanillaDeserializerState {
  marked: Set<number>;
}

export interface VanillaDeserializerContext {
  mode: SerovalMode.Vanilla;
  base: BaseDeserializerContext;
  child: DeserializePluginContext | undefined;
  state: VanillaDeserializerState;
}

export function createVanillaDeserializerContext(
  options: VanillaDeserializerContextOptions,
): VanillaDeserializerContext {
  return {
    mode: SerovalMode.Vanilla,
    base: createBaseDeserializerContext(SerovalMode.Vanilla, options),
    child: NIL,
    state: {
      marked: new Set(options.markedRefs),
    },
  };
}

export interface CrossDeserializerContext {
  mode: SerovalMode.Cross;
  base: BaseDeserializerContext;
  child: DeserializePluginContext | undefined;
}

export type CrossDeserializerContextOptions = BaseDeserializerContextOptions;

export function createCrossDeserializerContext(
  options: CrossDeserializerContextOptions,
): CrossDeserializerContext {
  return {
    mode: SerovalMode.Cross,
    base: createBaseDeserializerContext(SerovalMode.Cross, options),
    child: NIL,
  };
}

type DeserializerContext =
  | VanillaDeserializerContext
  | CrossDeserializerContext;

export class DeserializePluginContext {
  constructor(
    private _p: DeserializerContext,
    private depth: number,
  ) {}

  deserialize<T>(node: SerovalNode): T {
    return deserialize(this._p, this.depth, node) as T;
  }
}

function guardIndexedValue(ctx: BaseDeserializerContext, id: number): void {
  if (id < 0 || !Number.isFinite(id) || !Number.isInteger(id)) {
    throw new SerovalMalformedNodeError({
      t: SerovalNodeType.IndexedValue,
      i: id,
    } as SerovalNode);
  }
  if (ctx.refs.has(id)) {
    throw new Error('Conflicted ref id: ' + id);
  }
}

function assignIndexedValueVanilla<T>(
  ctx: VanillaDeserializerContext,
  id: number,
  value: T,
): T {
  guardIndexedValue(ctx.base, id);
  if (ctx.state.marked.has(id)) {
    ctx.base.refs.set(id, value);
  }
  return value;
}

function assignIndexedValueCross<T>(
  ctx: CrossDeserializerContext,
  id: number,
  value: T,
): T {
  guardIndexedValue(ctx.base, id);
  ctx.base.refs.set(id, value);
  return value;
}

function assignIndexedValue<T>(
  ctx: DeserializerContext,
  id: number,
  value: T,
): T {
  return ctx.mode === SerovalMode.Vanilla
    ? assignIndexedValueVanilla(ctx, id, value)
    : assignIndexedValueCross(ctx, id, value);
}

function deserializeKnownValue<
  T extends Record<string, unknown>,
  K extends keyof T,
>(node: SerovalNode, record: T, key: K): T[K] {
  if (Object.hasOwn(record, key)) {
    return record[key];
  }
  throw new SerovalMalformedNodeError(node);
}

function deserializeReference(
  ctx: DeserializerContext,
  node: SerovalReferenceNode,
): unknown {
  return assignIndexedValue(
    ctx,
    node.i,
    getReference(deserializeString(node.s)),
  );
}

function deserializeArray(
  ctx: DeserializerContext,
  depth: number,
  node: SerovalArrayNode,
): unknown[] {
  const items = node.a;
  const len = items.length;
  const result: unknown[] = assignIndexedValue(
    ctx,
    node.i,
    new Array<unknown>(len),
  );
  for (let i = 0, item: SerovalNode | 0; i < len; i++) {
    item = items[i];
    if (item) {
      result[i] = deserialize(ctx, depth, item);
    }
  }
  applyObjectFlag(result, node.o);
  return result;
}

function isValidKey(key: string): boolean {
  switch (key) {
    case 'constructor':
    case '__proto__':
    case 'prototype':
    case '__defineGetter__':
    case '__defineSetter__':
    case '__lookupGetter__':
    case '__lookupSetter__':
      // case 'then':
      return false;
    default:
      return true;
  }
}

function isValidSymbol(symbol: symbol): boolean {
  switch (symbol) {
    case SYM_ASYNC_ITERATOR:
    case SYM_IS_CONCAT_SPREADABLE:
    case SYM_TO_STRING_TAG:
    case SYM_ITERATOR:
      return true;
    default:
      return false;
  }
}

function assignStringProperty(
  object: Record<string | symbol, unknown>,
  key: string,
  value: unknown,
): void {
  if (isValidKey(key)) {
    object[key] = value;
  } else {
    Object.defineProperty(object, key, {
      value,
      configurable: true,
      enumerable: true,
      writable: true,
    });
  }
}

function assignProperty(
  ctx: DeserializerContext,
  depth: number,
  object: Record<string | symbol, unknown>,
  key: string | SerovalNode,
  value: SerovalNode,
): void {
  if (typeof key === 'string') {
    assignStringProperty(
      object,
      deserializeString(key),
      deserialize(ctx, depth, value),
    );
  } else {
    const actual = deserialize(ctx, depth, key);
    switch (typeof actual) {
      case 'string':
        assignStringProperty(object, actual, deserialize(ctx, depth, value));
        break;
      case 'symbol':
        if (isValidSymbol(actual)) {
          object[actual] = deserialize(ctx, depth, value);
        }
        break;
      default:
        throw new SerovalMalformedNodeError(key);
    }
  }
}

function deserializeProperties(
  ctx: DeserializerContext,
  depth: number,
  node: SerovalObjectRecordNode,
  result: Record<string | symbol, unknown>,
): Record<string | symbol, unknown> {
  const keys = node.k;
  const len = keys.length;
  if (len > 0) {
    for (let i = 0, vals = node.v, len = keys.length; i < len; i++) {
      assignProperty(ctx, depth, result, keys[i], vals[i]);
    }
  }
  return result;
}

function deserializeObject(
  ctx: DeserializerContext,
  depth: number,
  node: SerovalObjectNode | SerovalNullConstructorNode,
): Record<string, unknown> {
  const result = assignIndexedValue(
    ctx,
    node.i,
    (node.t === SerovalNodeType.Object ? {} : Object.create(null)) as Record<
      string,
      unknown
    >,
  );
  deserializeProperties(ctx, depth, node.p, result);
  applyObjectFlag(result, node.o);
  return result;
}

function deserializeDate(
  ctx: DeserializerContext,
  node: SerovalDateNode,
): Date {
  return assignIndexedValue(ctx, node.i, new Date(node.s));
}

function deserializeRegExp(
  ctx: DeserializerContext,
  node: SerovalRegExpNode,
): RegExp {
  if (ctx.base.features & Feature.RegExp) {
    const source = deserializeString(node.c);
    if (source.length > MAX_REGEXP_SOURCE_LENGTH) {
      throw new SerovalMalformedNodeError(node);
    }
    return assignIndexedValue(ctx, node.i, new RegExp(source, node.m));
  }
  throw new SerovalUnsupportedNodeError(node);
}

function deserializeSet(
  ctx: DeserializerContext,
  depth: number,
  node: SerovalSetNode,
): Set<unknown> {
  const result = assignIndexedValue(ctx, node.i, new Set<unknown>());
  for (let i = 0, items = node.a, len = items.length; i < len; i++) {
    result.add(deserialize(ctx, depth, items[i]));
  }
  return result;
}

function deserializeMap(
  ctx: DeserializerContext,
  depth: number,
  node: SerovalMapNode,
): Map<unknown, unknown> {
  const result = assignIndexedValue(ctx, node.i, new Map<unknown, unknown>());
  for (
    let i = 0, keys = node.e.k, vals = node.e.v, len = keys.length;
    i < len;
    i++
  ) {
    result.set(
      deserialize(ctx, depth, keys[i]),
      deserialize(ctx, depth, vals[i]),
    );
  }
  return result;
}

function deserializeArrayBuffer(
  ctx: DeserializerContext,
  node: SerovalArrayBufferNode,
): ArrayBuffer {
  if (node.s.length > MAX_BASE64_LENGTH) {
    throw new SerovalMalformedNodeError(node);
  }
  const result = assignIndexedValue(
    ctx,
    node.i,
    ARRAY_BUFFER_CONSTRUCTOR(deserializeString(node.s)),
  );
  return result;
}

function deserializeTypedArray(
  ctx: DeserializerContext,
  depth: number,
  node: SerovalTypedArrayNode | SerovalBigIntTypedArrayNode,
): TypedArrayValue | BigIntTypedArrayValue {
  const construct = getTypedArrayConstructor(node.c) as Int8ArrayConstructor;
  const source = deserialize(ctx, depth, node.f) as ArrayBuffer;
  const offset = node.b ?? 0;
  if (offset < 0 || offset > source.byteLength) {
    throw new SerovalMalformedNodeError(node);
  }
  const result = assignIndexedValue(
    ctx,
    node.i,
    new construct(source, offset, node.l),
  );
  return result;
}

function deserializeDataView(
  ctx: DeserializerContext,
  depth: number,
  node: SerovalDataViewNode,
): DataView {
  const source = deserialize(ctx, depth, node.f) as ArrayBuffer;
  const offset = node.b ?? 0;
  if (offset < 0 || offset > source.byteLength) {
    throw new SerovalMalformedNodeError(node);
  }
  const result = assignIndexedValue(
    ctx,
    node.i,
    new DataView(source, offset, node.l),
  );
  return result;
}

function deserializeDictionary<T extends AssignableValue>(
  ctx: DeserializerContext,
  depth: number,
  node: AssignableNode,
  result: T,
): T {
  if (node.p) {
    const fields = deserializeProperties(ctx, depth, node.p, {});
    Object.defineProperties(result, Object.getOwnPropertyDescriptors(fields));
  }
  return result;
}

function deserializeAggregateError(
  ctx: DeserializerContext,
  depth: number,
  node: SerovalAggregateErrorNode,
): AggregateError {
  // Serialize the required arguments
  const result = assignIndexedValue(
    ctx,
    node.i,
    new AggregateError([], deserializeString(node.m)),
  );
  // `AggregateError` might've been extended
  // either through class or custom properties
  // Make sure to assign extra properties
  return deserializeDictionary(ctx, depth, node, result);
}

function deserializeError(
  ctx: DeserializerContext,
  depth: number,
  node: SerovalErrorNode,
): Error {
  const construct = deserializeKnownValue(node, ERROR_CONSTRUCTOR, node.s);
  const result = assignIndexedValue(
    ctx,
    node.i,
    new construct(deserializeString(node.m)),
  );
  return deserializeDictionary(ctx, depth, node, result);
}

function deserializePromise(
  ctx: DeserializerContext,
  depth: number,
  node: SerovalPromiseNode,
): Promise<unknown> {
  const deferred = PROMISE_CONSTRUCTOR();
  const result = assignIndexedValue(ctx, node.i, deferred.p);
  const deserialized = deserialize(ctx, depth, node.f);
  if (node.s) {
    deferred.s(deserialized);
  } else {
    deferred.f(deserialized);
  }
  return result;
}

function deserializeBoxed(
  ctx: DeserializerContext,
  depth: number,
  node: SerovalBoxedNode,
): unknown {
  return assignIndexedValue(
    ctx,
    node.i,
    // biome-ignore lint/style/useConsistentBuiltinInstantiation: intended
    Object(deserialize(ctx, depth, node.f)),
  );
}

function deserializePlugin(
  ctx: DeserializerContext,
  depth: number,
  node: SerovalPluginNode,
): unknown {
  const currentPlugins = ctx.base.plugins;
  if (currentPlugins) {
    const tag = deserializeString(node.c);
    for (let i = 0, len = currentPlugins.length; i < len; i++) {
      const plugin = currentPlugins[i];
      if (plugin.tag === tag) {
        return assignIndexedValue(
          ctx,
          node.i,
          plugin.deserialize(node.s, new DeserializePluginContext(ctx, depth), {
            id: node.i,
          }),
        );
      }
    }
  }
  throw new SerovalMissingPluginError(node.c);
}

function deserializePromiseConstructor(
  ctx: DeserializerContext,
  node: SerovalPromiseConstructorNode,
): unknown {
  return assignIndexedValue(
    ctx,
    node.i,
    assignIndexedValue(ctx, node.s, PROMISE_CONSTRUCTOR()).p,
  );
}

function deserializePromiseResolve(
  ctx: DeserializerContext,
  depth: number,
  node: SerovalPromiseResolveNode,
): unknown {
  const deferred = ctx.base.refs.get(node.i) as
    | PromiseConstructorResolver
    | undefined;
  if (deferred) {
    deferred.s(deserialize(ctx, depth, node.a[1]));
    return NIL;
  }
  throw new SerovalMissingInstanceError('Promise');
}

function deserializePromiseReject(
  ctx: DeserializerContext,
  depth: number,
  node: SerovalPromiseRejectNode,
): unknown {
  const deferred = ctx.base.refs.get(node.i) as
    | PromiseConstructorResolver
    | undefined;
  if (deferred) {
    deferred.f(deserialize(ctx, depth, node.a[1]));
    return NIL;
  }
  throw new SerovalMissingInstanceError('Promise');
}

function deserializeIteratorFactoryInstance(
  ctx: DeserializerContext,
  depth: number,
  node: SerovalIteratorFactoryInstanceNode,
): unknown {
  deserialize(ctx, depth, node.a[0]);
  const source = deserialize(ctx, depth, node.a[1]);
  return sequenceToIterator(source as Sequence);
}

function deserializeAsyncIteratorFactoryInstance(
  ctx: DeserializerContext,
  depth: number,
  node: SerovalAsyncIteratorFactoryInstanceNode,
): unknown {
  deserialize(ctx, depth, node.a[0]);
  const source = deserialize(ctx, depth, node.a[1]);
  return streamToAsyncIterable(source as Stream<any>);
}

function deserializeStreamConstructor(
  ctx: DeserializerContext,
  depth: number,
  node: SerovalStreamConstructorNode,
): unknown {
  const result = assignIndexedValue(ctx, node.i, createStream());
  const items = node.a;
  const len = items.length;
  if (len) {
    for (let i = 0; i < len; i++) {
      deserialize(ctx, depth, items[i]);
    }
  }
  return result;
}

function deserializeStreamNext(
  ctx: DeserializerContext,
  depth: number,
  node: SerovalStreamNextNode,
): unknown {
  const deferred = ctx.base.refs.get(node.i) as Stream<unknown> | undefined;
  if (deferred && isStream(deferred)) {
    deferred.next(deserialize(ctx, depth, node.f));
    return NIL;
  }
  throw new SerovalMissingInstanceError('Stream');
}

function deserializeStreamThrow(
  ctx: DeserializerContext,
  depth: number,
  node: SerovalStreamThrowNode,
): unknown {
  const deferred = ctx.base.refs.get(node.i) as Stream<unknown> | undefined;
  if (deferred && isStream(deferred)) {
    deferred.throw(deserialize(ctx, depth, node.f));
    return NIL;
  }
  throw new SerovalMissingInstanceError('Stream');
}

function deserializeStreamReturn(
  ctx: DeserializerContext,
  depth: number,
  node: SerovalStreamReturnNode,
): unknown {
  const deferred = ctx.base.refs.get(node.i) as Stream<unknown> | undefined;
  if (deferred && isStream(deferred)) {
    deferred.return(deserialize(ctx, depth, node.f));
    return NIL;
  }
  throw new SerovalMissingInstanceError('Stream');
}

function deserializeIteratorFactory(
  ctx: DeserializerContext,
  depth: number,
  node: SerovalIteratorFactoryNode,
): unknown {
  deserialize(ctx, depth, node.f);
  return NIL;
}

function deserializeAsyncIteratorFactory(
  ctx: DeserializerContext,
  depth: number,
  node: SerovalAsyncIteratorFactoryNode,
): unknown {
  deserialize(ctx, depth, node.a[1]);
  return NIL;
}

function deserializeSequence(
  ctx: DeserializerContext,
  depth: number,
  node: SerovalSequenceNode,
): Sequence {
  const result = assignIndexedValue(
    ctx,
    node.i,
    createSequence([], node.s, node.l),
  );
  for (let i = 0, len = node.a.length; i < len; i++) {
    result.v[i] = deserialize(ctx, depth, node.a[i]);
  }
  return result;
}

function deserialize(
  ctx: DeserializerContext,
  depth: number,
  node: SerovalNode,
): unknown {
  if (depth > ctx.base.depthLimit) {
    throw new SerovalDepthLimitError(ctx.base.depthLimit);
  }
  depth += 1;
  switch (node.t) {
    case SerovalNodeType.Constant:
      return deserializeKnownValue(node, CONSTANT_VAL, node.s);
    case SerovalNodeType.Number:
      return Number(node.s);
    case SerovalNodeType.String:
      return deserializeString(String(node.s));
    case SerovalNodeType.BigInt:
      if (String(node.s).length > MAX_BIGINT_LENGTH) {
        throw new SerovalMalformedNodeError(node);
      }
      return BigInt(node.s);
    case SerovalNodeType.IndexedValue:
      return ctx.base.refs.get(node.i);
    case SerovalNodeType.Reference:
      return deserializeReference(ctx, node);
    case SerovalNodeType.Array:
      return deserializeArray(ctx, depth, node);
    case SerovalNodeType.Object:
    case SerovalNodeType.NullConstructor:
      return deserializeObject(ctx, depth, node);
    case SerovalNodeType.Date:
      return deserializeDate(ctx, node);
    case SerovalNodeType.RegExp:
      return deserializeRegExp(ctx, node);
    case SerovalNodeType.Set:
      return deserializeSet(ctx, depth, node);
    case SerovalNodeType.Map:
      return deserializeMap(ctx, depth, node);
    case SerovalNodeType.ArrayBuffer:
      return deserializeArrayBuffer(ctx, node);
    case SerovalNodeType.BigIntTypedArray:
    case SerovalNodeType.TypedArray:
      return deserializeTypedArray(ctx, depth, node);
    case SerovalNodeType.DataView:
      return deserializeDataView(ctx, depth, node);
    case SerovalNodeType.AggregateError:
      return deserializeAggregateError(ctx, depth, node);
    case SerovalNodeType.Error:
      return deserializeError(ctx, depth, node);
    case SerovalNodeType.Promise:
      return deserializePromise(ctx, depth, node);
    case SerovalNodeType.WKSymbol:
      return deserializeKnownValue(node, SYMBOL_REF, node.s);
    case SerovalNodeType.Boxed:
      return deserializeBoxed(ctx, depth, node);
    case SerovalNodeType.Plugin:
      return deserializePlugin(ctx, depth, node);
    case SerovalNodeType.PromiseConstructor:
      return deserializePromiseConstructor(ctx, node);
    case SerovalNodeType.PromiseSuccess:
      return deserializePromiseResolve(ctx, depth, node);
    case SerovalNodeType.PromiseFailure:
      return deserializePromiseReject(ctx, depth, node);
    case SerovalNodeType.IteratorFactoryInstance:
      return deserializeIteratorFactoryInstance(ctx, depth, node);
    case SerovalNodeType.AsyncIteratorFactoryInstance:
      return deserializeAsyncIteratorFactoryInstance(ctx, depth, node);
    case SerovalNodeType.StreamConstructor:
      return deserializeStreamConstructor(ctx, depth, node);
    case SerovalNodeType.StreamNext:
      return deserializeStreamNext(ctx, depth, node);
    case SerovalNodeType.StreamThrow:
      return deserializeStreamThrow(ctx, depth, node);
    case SerovalNodeType.StreamReturn:
      return deserializeStreamReturn(ctx, depth, node);
    case SerovalNodeType.IteratorFactory:
      return deserializeIteratorFactory(ctx, depth, node);
    case SerovalNodeType.AsyncIteratorFactory:
      return deserializeAsyncIteratorFactory(ctx, depth, node);
    // case SerovalNodeType.SpecialReference:
    case SerovalNodeType.Sequence:
      return deserializeSequence(ctx, depth, node);
    default:
      throw new SerovalUnsupportedNodeError(node);
  }
}

export function deserializeTop(
  ctx: DeserializerContext,
  node: SerovalNode,
): unknown {
  try {
    return deserialize(ctx, 0, node);
  } catch (error) {
    throw new SerovalDeserializationError(error);
  }
}
