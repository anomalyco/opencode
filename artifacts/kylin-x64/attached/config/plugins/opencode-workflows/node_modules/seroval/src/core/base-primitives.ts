import type { WellKnownSymbols } from './constants';
import { INV_SYMBOL_REF, NIL, SerovalNodeType } from './constants';
import {
  INFINITY_NODE,
  NAN_NODE,
  NEG_INFINITY_NODE,
  NEG_ZERO_NODE,
} from './literals';
import { createSerovalNode } from './node';
import { getReferenceID } from './reference';
import { serializeString } from './string';
import type {
  SerovalAggregateErrorNode,
  SerovalArrayNode,
  SerovalAsyncIteratorFactoryInstanceNode,
  SerovalBigIntNode,
  SerovalBigIntTypedArrayNode,
  SerovalBoxedNode,
  SerovalConstantNode,
  SerovalDataViewNode,
  SerovalDateNode,
  SerovalErrorNode,
  SerovalIndexedValueNode,
  SerovalIteratorFactoryInstanceNode,
  SerovalNode,
  SerovalNodeWithID,
  SerovalNumberNode,
  SerovalObjectRecordNode,
  SerovalPluginNode,
  SerovalReferenceNode,
  SerovalRegExpNode,
  SerovalSequenceNode,
  SerovalSetNode,
  SerovalStreamConstructorNode,
  SerovalStreamNextNode,
  SerovalStreamReturnNode,
  SerovalStreamThrowNode,
  SerovalStringNode,
  SerovalTypedArrayNode,
  SerovalWKSymbolNode,
} from './types';
import { getErrorConstructor } from './utils/error';
import { getObjectFlag } from './utils/get-object-flag';
import type {
  BigIntTypedArrayValue,
  TypedArrayValue,
} from './utils/typed-array';

export function createNumberNode(
  value: number,
): SerovalConstantNode | SerovalNumberNode {
  switch (value) {
    case Number.POSITIVE_INFINITY:
      return INFINITY_NODE;
    case Number.NEGATIVE_INFINITY:
      return NEG_INFINITY_NODE;
  }
  if (value !== value) {
    return NAN_NODE;
  }
  if (Object.is(value, -0)) {
    return NEG_ZERO_NODE;
  }
  return createSerovalNode(
    SerovalNodeType.Number,
    NIL,
    value,
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

export function createStringNode(value: string): SerovalStringNode {
  return createSerovalNode(
    SerovalNodeType.String,
    NIL,
    serializeString(value),
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

export function createBigIntNode(current: bigint): SerovalBigIntNode {
  return createSerovalNode(
    SerovalNodeType.BigInt,
    NIL,
    '' + current,
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

export function createIndexedValueNode(id: number): SerovalIndexedValueNode {
  return createSerovalNode(
    SerovalNodeType.IndexedValue,
    id,
    NIL,
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

export function createDateNode(id: number, current: Date): SerovalDateNode {
  const timestamp = current.valueOf();
  return createSerovalNode(
    SerovalNodeType.Date,
    id,
    timestamp !== timestamp ? '' : current.toISOString(),
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

export function createRegExpNode(
  id: number,
  current: RegExp,
): SerovalRegExpNode {
  return createSerovalNode(
    SerovalNodeType.RegExp,
    id,
    NIL,
    serializeString(current.source),
    current.flags,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
  );
}

export function createWKSymbolNode(
  id: number,
  current: WellKnownSymbols,
): SerovalWKSymbolNode {
  return createSerovalNode(
    SerovalNodeType.WKSymbol,
    id,
    INV_SYMBOL_REF[current],
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

export function createReferenceNode<T>(
  id: number,
  ref: T,
): SerovalReferenceNode {
  return createSerovalNode(
    SerovalNodeType.Reference,
    id,
    serializeString(getReferenceID(ref)),
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

export function createPluginNode(
  id: number,
  tag: string,
  value: Record<string, SerovalNode>,
): SerovalPluginNode {
  return createSerovalNode(
    SerovalNodeType.Plugin,
    id,
    value,
    serializeString(tag),
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

export function createArrayNode(
  id: number,
  current: unknown[],
  parsedItems: SerovalArrayNode['a'],
): SerovalArrayNode {
  return createSerovalNode(
    SerovalNodeType.Array,
    id,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    parsedItems,
    NIL,
    NIL,
    getObjectFlag(current),
    NIL,
  );
}

export function createBoxedNode(
  id: number,
  boxed: SerovalNode,
): SerovalBoxedNode {
  return createSerovalNode(
    SerovalNodeType.Boxed,
    id,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    boxed,
    NIL,
    NIL,
    NIL,
  );
}

export function createTypedArrayNode(
  id: number,
  current: TypedArrayValue,
  buffer: SerovalNode,
): SerovalTypedArrayNode {
  return createSerovalNode(
    SerovalNodeType.TypedArray,
    id,
    NIL,
    current.constructor.name,
    NIL,
    NIL,
    NIL,
    NIL,
    buffer,
    current.byteOffset,
    NIL,
    current.length,
  );
}

export function createBigIntTypedArrayNode(
  id: number,
  current: BigIntTypedArrayValue,
  buffer: SerovalNode,
): SerovalBigIntTypedArrayNode {
  return createSerovalNode(
    SerovalNodeType.BigIntTypedArray,
    id,
    NIL,
    current.constructor.name,
    NIL,
    NIL,
    NIL,
    NIL,
    buffer,
    current.byteOffset,
    NIL,
    current.byteLength,
  );
}

export function createDataViewNode(
  id: number,
  current: DataView,
  buffer: SerovalNode,
): SerovalDataViewNode {
  return createSerovalNode(
    SerovalNodeType.DataView,
    id,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    buffer,
    current.byteOffset,
    NIL,
    current.byteLength,
  );
}

export function createErrorNode(
  id: number,
  current: Error,
  options: SerovalObjectRecordNode | undefined,
): SerovalErrorNode {
  return createSerovalNode(
    SerovalNodeType.Error,
    id,
    getErrorConstructor(current),
    NIL,
    serializeString(current.message),
    options,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
  );
}

export function createAggregateErrorNode(
  id: number,
  current: AggregateError,
  options: SerovalObjectRecordNode | undefined,
): SerovalAggregateErrorNode {
  return createSerovalNode(
    SerovalNodeType.AggregateError,
    id,
    getErrorConstructor(current),
    NIL,
    serializeString(current.message),
    options,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
  );
}

export function createSetNode(
  id: number,
  items: SerovalNode[],
): SerovalSetNode {
  return createSerovalNode(
    SerovalNodeType.Set,
    id,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    items,
    NIL,
    NIL,
    NIL,
    NIL,
  );
}

export function createIteratorFactoryInstanceNode(
  factory: SerovalNodeWithID,
  items: SerovalNodeWithID,
): SerovalIteratorFactoryInstanceNode {
  return createSerovalNode(
    SerovalNodeType.IteratorFactoryInstance,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    [factory, items],
    NIL,
    NIL,
    NIL,
    NIL,
  );
}

export function createAsyncIteratorFactoryInstanceNode(
  factory: SerovalNodeWithID,
  items: SerovalNodeWithID,
): SerovalAsyncIteratorFactoryInstanceNode {
  return createSerovalNode(
    SerovalNodeType.AsyncIteratorFactoryInstance,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    [factory, items],
    NIL,
    NIL,
    NIL,
    NIL,
  );
}

export function createStreamConstructorNode(
  id: number,
  factory: SerovalNodeWithID,
  sequence: SerovalNode[],
): SerovalStreamConstructorNode {
  return createSerovalNode(
    SerovalNodeType.StreamConstructor,
    id,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    sequence,
    factory,
    NIL,
    NIL,
    NIL,
  );
}

export function createStreamNextNode(
  id: number,
  parsed: SerovalNode,
): SerovalStreamNextNode {
  return createSerovalNode(
    SerovalNodeType.StreamNext,
    id,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    parsed,
    NIL,
    NIL,
    NIL,
  );
}

export function createStreamThrowNode(
  id: number,
  parsed: SerovalNode,
): SerovalStreamThrowNode {
  return createSerovalNode(
    SerovalNodeType.StreamThrow,
    id,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    parsed,
    NIL,
    NIL,
    NIL,
  );
}

export function createStreamReturnNode(
  id: number,
  parsed: SerovalNode,
): SerovalStreamReturnNode {
  return createSerovalNode(
    SerovalNodeType.StreamReturn,
    id,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    parsed,
    NIL,
    NIL,
    NIL,
  );
}

export function createSequenceNode(
  id: number,
  sequence: SerovalNode[],
  throwAt: number,
  doneAt: number,
): SerovalSequenceNode {
  return createSerovalNode(
    SerovalNodeType.Sequence,
    id,
    throwAt,
    NIL,
    NIL,
    NIL,
    NIL,
    sequence,
    NIL,
    NIL,
    NIL,
    doneAt,
  );
}
