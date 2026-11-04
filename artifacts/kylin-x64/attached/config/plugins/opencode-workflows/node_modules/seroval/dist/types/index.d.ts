export { Feature } from './core/compat';
export type { AsyncParsePluginContext, AsyncParserContextOptions, } from './core/context/async-parser';
export type { BaseDeserializerContextOptions, CrossDeserializerContextOptions, DeserializePluginContext, VanillaDeserializerContextOptions, } from './core/context/deserializer';
export type { BaseParserContextOptions } from './core/context/parser';
export type { BaseSerializerContextOptions, CrossContextOptions, CrossSerializerContextOptions, SerializePluginContext, VanillaSerializerContextOptions, } from './core/context/serializer';
export type { StreamParsePluginContext, StreamParserContextOptions, SyncParsePluginContext, SyncParserContextOptions, } from './core/context/sync-parser';
export * from './core/cross';
export * from './core/errors';
export { getCrossReferenceHeader } from './core/keys';
export { OpaqueReference } from './core/opaque-reference';
export * from './core/plugin';
export { createReference } from './core/reference';
export { default as Serializer } from './core/Serializer';
export { createStream } from './core/stream';
export type { Stream, StreamListener } from './core/stream';
export * from './core/tree';
export type { SerovalNode } from './core/types';
//# sourceMappingURL=index.d.ts.map