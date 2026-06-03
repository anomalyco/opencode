import type { ErrorConstructorTag, SerovalConstant, SerovalNodeType, SerovalObjectFlags, Symbols } from './constants';
import type { SpecialReference } from './special-reference';
export interface SerovalBaseNode {
    t: SerovalNodeType;
    i: number | undefined;
    s: unknown;
    c: string | undefined;
    m: string | undefined;
    p: SerovalObjectRecordNode | undefined;
    e: SerovalMapRecordNode | undefined;
    a: (SerovalNode | 0)[] | undefined;
    f: SerovalNode | undefined;
    b: number | undefined;
    o: SerovalObjectFlags | undefined;
    l: number | undefined;
}
export type SerovalObjectRecordKey = string | SerovalNode;
export interface SerovalObjectRecordNode {
    k: SerovalObjectRecordKey[];
    v: SerovalNode[];
}
export interface SerovalMapRecordNode {
    k: SerovalNode[];
    v: SerovalNode[];
}
export interface SerovalNumberNode extends SerovalBaseNode {
    t: SerovalNodeType.Number;
    s: number;
}
export interface SerovalStringNode extends SerovalBaseNode {
    t: SerovalNodeType.String;
    s: string;
}
export interface SerovalConstantNode extends SerovalBaseNode {
    t: SerovalNodeType.Constant;
    s: SerovalConstant;
}
export type SerovalPrimitiveNode = SerovalNumberNode | SerovalStringNode | SerovalConstantNode;
export interface SerovalIndexedValueNode extends SerovalBaseNode {
    t: SerovalNodeType.IndexedValue;
    i: number;
}
export interface SerovalBigIntNode extends SerovalBaseNode {
    t: SerovalNodeType.BigInt;
    s: string;
}
export interface SerovalDateNode extends SerovalBaseNode {
    t: SerovalNodeType.Date;
    i: number;
    s: string;
}
export interface SerovalRegExpNode extends SerovalBaseNode {
    t: SerovalNodeType.RegExp;
    i: number;
    c: string;
    m: string;
}
export interface SerovalArrayBufferNode extends SerovalBaseNode {
    t: SerovalNodeType.ArrayBuffer;
    i: number;
    s: string;
    f: SerovalNodeWithID;
}
export interface SerovalTypedArrayNode extends SerovalBaseNode {
    t: SerovalNodeType.TypedArray;
    i: number;
    c: string;
    f: SerovalNode;
    b: number;
    l: number;
}
export interface SerovalBigIntTypedArrayNode extends SerovalBaseNode {
    t: SerovalNodeType.BigIntTypedArray;
    i: number;
    c: string;
    f: SerovalNode;
    b: number;
    l: number;
}
export type SerovalSemiPrimitiveNode = SerovalBigIntNode | SerovalDateNode | SerovalRegExpNode | SerovalTypedArrayNode | SerovalBigIntTypedArrayNode;
export interface SerovalSetNode extends SerovalBaseNode {
    t: SerovalNodeType.Set;
    i: number;
    a: SerovalNode[];
}
export interface SerovalMapNode extends SerovalBaseNode {
    t: SerovalNodeType.Map;
    i: number;
    e: SerovalMapRecordNode;
    f: SerovalNodeWithID;
}
export interface SerovalArrayNode extends SerovalBaseNode {
    t: SerovalNodeType.Array;
    a: (SerovalNode | 0)[];
    i: number;
    o: SerovalObjectFlags;
}
export interface SerovalObjectNode extends SerovalBaseNode {
    t: SerovalNodeType.Object;
    p: SerovalObjectRecordNode;
    i: number;
    o: SerovalObjectFlags;
}
export interface SerovalNullConstructorNode extends SerovalBaseNode {
    t: SerovalNodeType.NullConstructor;
    p: SerovalObjectRecordNode;
    i: number;
    o: SerovalObjectFlags;
}
export interface SerovalPromiseNode extends SerovalBaseNode {
    t: SerovalNodeType.Promise;
    s: 0 | 1;
    f: SerovalNode;
    i: number;
}
export interface SerovalErrorNode extends SerovalBaseNode {
    t: SerovalNodeType.Error;
    s: ErrorConstructorTag;
    m: string;
    p: SerovalObjectRecordNode | undefined;
    i: number;
}
export interface SerovalAggregateErrorNode extends SerovalBaseNode {
    t: SerovalNodeType.AggregateError;
    i: number;
    m: string;
    p: SerovalObjectRecordNode | undefined;
}
export interface SerovalWKSymbolNode extends SerovalBaseNode {
    t: SerovalNodeType.WKSymbol;
    i: number;
    s: Symbols;
}
export interface SerovalReferenceNode extends SerovalBaseNode {
    t: SerovalNodeType.Reference;
    i: number;
    s: string;
}
export interface SerovalDataViewNode extends SerovalBaseNode {
    t: SerovalNodeType.DataView;
    i: number;
    f: SerovalNode;
    b: number;
    l: number;
}
export interface SerovalBoxedNode extends SerovalBaseNode {
    t: SerovalNodeType.Boxed;
    i: number;
    f: SerovalNode;
}
export interface SerovalPromiseConstructorNode extends SerovalBaseNode {
    t: SerovalNodeType.PromiseConstructor;
    i: number;
    s: number;
    f: SerovalNodeWithID;
}
export interface SerovalPromiseResolveNode extends SerovalBaseNode {
    t: SerovalNodeType.PromiseSuccess;
    i: number;
    a: [resolver: SerovalNodeWithID, resolved: SerovalNode];
}
export interface SerovalPromiseRejectNode extends SerovalBaseNode {
    t: SerovalNodeType.PromiseFailure;
    i: number;
    a: [resolver: SerovalNodeWithID, resolved: SerovalNode];
}
export interface SerovalPluginNode extends SerovalBaseNode {
    t: SerovalNodeType.Plugin;
    i: number;
    s: Record<string, SerovalNode>;
    c: string;
}
/**
 * Represents special values as placeholders
 */
export interface SerovalSpecialReferenceNode extends SerovalBaseNode {
    t: SerovalNodeType.SpecialReference;
    i: number;
    s: SpecialReference;
}
export interface SerovalIteratorFactoryNode extends SerovalBaseNode {
    t: SerovalNodeType.IteratorFactory;
    i: number;
    f: SerovalNodeWithID;
}
export interface SerovalIteratorFactoryInstanceNode extends SerovalBaseNode {
    t: SerovalNodeType.IteratorFactoryInstance;
    a: [instance: SerovalNodeWithID, sequence: SerovalNodeWithID];
}
export interface SerovalAsyncIteratorFactoryNode extends SerovalBaseNode {
    t: SerovalNodeType.AsyncIteratorFactory;
    i: number;
    a: [promise: SerovalNodeWithID, symbol: SerovalNodeWithID];
}
export interface SerovalAsyncIteratorFactoryInstanceNode extends SerovalBaseNode {
    t: SerovalNodeType.AsyncIteratorFactoryInstance;
    a: [instance: SerovalNodeWithID, sequence: SerovalNodeWithID];
}
export interface SerovalStreamConstructorNode extends SerovalBaseNode {
    t: SerovalNodeType.StreamConstructor;
    i: number;
    a: SerovalNode[];
    f: SerovalNodeWithID;
}
export interface SerovalStreamNextNode extends SerovalBaseNode {
    t: SerovalNodeType.StreamNext;
    i: number;
    f: SerovalNode;
}
export interface SerovalStreamThrowNode extends SerovalBaseNode {
    t: SerovalNodeType.StreamThrow;
    i: number;
    f: SerovalNode;
}
export interface SerovalStreamReturnNode extends SerovalBaseNode {
    t: SerovalNodeType.StreamReturn;
    i: number;
    f: SerovalNode;
}
export interface SerovalSequenceNode extends SerovalBaseNode {
    t: SerovalNodeType.Sequence;
    i: number;
    s: number;
    a: SerovalNode[];
    l: number;
}
export type SerovalSyncNode = SerovalPrimitiveNode | SerovalIndexedValueNode | SerovalSemiPrimitiveNode | SerovalSetNode | SerovalMapNode | SerovalArrayNode | SerovalObjectNode | SerovalNullConstructorNode | SerovalPromiseNode | SerovalErrorNode | SerovalAggregateErrorNode | SerovalWKSymbolNode | SerovalReferenceNode | SerovalArrayBufferNode | SerovalDataViewNode | SerovalBoxedNode | SerovalPluginNode | SerovalSpecialReferenceNode | SerovalIteratorFactoryNode | SerovalIteratorFactoryInstanceNode | SerovalAsyncIteratorFactoryNode | SerovalAsyncIteratorFactoryInstanceNode | SerovalSequenceNode;
export type SerovalAsyncNode = SerovalPromiseNode | SerovalPromiseConstructorNode | SerovalPromiseResolveNode | SerovalPromiseRejectNode | SerovalStreamConstructorNode | SerovalStreamNextNode | SerovalStreamThrowNode | SerovalStreamReturnNode;
export type SerovalNode = SerovalSyncNode | SerovalAsyncNode;
export type SerovalNodeWithID = Extract<SerovalNode, {
    i: number;
}>;
//# sourceMappingURL=types.d.ts.map