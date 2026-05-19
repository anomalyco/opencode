import type { AsyncParserContextOptions } from '../context/async-parser';
import type { CrossDeserializerContextOptions } from '../context/deserializer';
import type { CrossContextOptions } from '../context/serializer';
import type { StreamParserContextOptions, SyncParserContextOptions } from '../context/sync-parser';
import type { SerovalNode } from '../types';
export interface CrossSerializeOptions extends SyncParserContextOptions, CrossContextOptions {
}
export declare function crossSerialize<T>(source: T, options?: CrossSerializeOptions): string;
export interface CrossSerializeAsyncOptions extends AsyncParserContextOptions, CrossContextOptions {
}
export declare function crossSerializeAsync<T>(source: T, options?: CrossSerializeAsyncOptions): Promise<string>;
export type ToCrossJSONOptions = SyncParserContextOptions;
export declare function toCrossJSON<T>(source: T, options?: ToCrossJSONOptions): SerovalNode;
export type ToCrossJSONAsyncOptions = AsyncParserContextOptions;
export declare function toCrossJSONAsync<T>(source: T, options?: ToCrossJSONAsyncOptions): Promise<SerovalNode>;
export interface CrossSerializeStreamOptions extends Omit<StreamParserContextOptions, 'onParse'>, CrossContextOptions {
    onSerialize: (data: string, initial: boolean) => void;
}
export declare function crossSerializeStream<T>(source: T, options: CrossSerializeStreamOptions): () => void;
export type ToCrossJSONStreamOptions = StreamParserContextOptions;
export declare function toCrossJSONStream<T>(source: T, options: ToCrossJSONStreamOptions): () => void;
export type FromCrossJSONOptions = CrossDeserializerContextOptions;
export declare function fromCrossJSON<T>(source: SerovalNode, options: FromCrossJSONOptions): T;
//# sourceMappingURL=index.d.ts.map