import type { SerovalNode } from './types';
export declare class SerovalError extends Error {
    cause: unknown;
    constructor(type: string, cause: unknown);
}
export declare class SerovalParserError extends SerovalError {
    constructor(cause: unknown);
}
export declare class SerovalSerializationError extends SerovalError {
    constructor(cause: unknown);
}
export declare class SerovalDeserializationError extends SerovalError {
    constructor(cause: unknown);
}
export declare class SerovalUnsupportedTypeError extends Error {
    value: unknown;
    constructor(value: unknown);
}
export declare class SerovalUnsupportedNodeError extends Error {
    constructor(node: SerovalNode);
}
export declare class SerovalMissingPluginError extends Error {
    constructor(tag: string);
}
export declare class SerovalMissingInstanceError extends Error {
    constructor(tag: string);
}
export declare class SerovalMissingReferenceError extends Error {
    value: unknown;
    constructor(value: unknown);
}
export declare class SerovalMissingReferenceForIdError extends Error {
    constructor(id: string);
}
export declare class SerovalUnknownTypedArrayError extends Error {
    constructor(name: string);
}
export declare class SerovalMalformedNodeError extends Error {
    constructor(node: SerovalNode);
}
export declare class SerovalConflictedNodeIdError extends Error {
    constructor(node: SerovalNode);
}
export declare class SerovalDepthLimitError extends Error {
    constructor(limit: number);
}
//# sourceMappingURL=errors.d.ts.map