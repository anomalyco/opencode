import { type Pointer } from "bun:ffi";
import { RGBA } from "./lib/RGBA.js";
type StyledChunkInput = {
    text: string;
    fg?: RGBA | null;
    bg?: RGBA | null;
    attributes?: number | null;
    link?: {
        url: string;
    } | string | null;
};
export declare const StyledChunkStruct: import("bun-ffi-structs").DefineStructReturnType<[readonly ["text", "char*"], readonly ["text_len", "u64", {
    readonly lengthOf: "text";
}], readonly ["fg", "pointer", {
    readonly optional: true;
    readonly packTransform: (rgba?: RGBA) => Pointer | null;
    readonly unpackTransform: (ptr?: Pointer) => RGBA | undefined;
}], readonly ["bg", "pointer", {
    readonly optional: true;
    readonly packTransform: (rgba?: RGBA) => Pointer | null;
    readonly unpackTransform: (ptr?: Pointer) => RGBA | undefined;
}], readonly ["attributes", "u32", {
    readonly default: 0;
}], readonly ["link", "char*", {
    readonly default: "";
}], readonly ["link_len", "u64", {
    readonly lengthOf: "link";
}]], {
    readonly mapValue: (chunk: StyledChunkInput) => StyledChunkInput;
}>;
export declare const HighlightStruct: import("bun-ffi-structs").DefineStructReturnType<[readonly ["start", "u32"], readonly ["end", "u32"], readonly ["styleId", "u32"], readonly ["priority", "u8", {
    readonly default: 0;
}], readonly ["hlRef", "u16", {
    readonly default: 0;
}]], {}>;
export declare const LogicalCursorStruct: import("bun-ffi-structs").DefineStructReturnType<[readonly ["row", "u32"], readonly ["col", "u32"], readonly ["offset", "u32"]], {}>;
export declare const VisualCursorStruct: import("bun-ffi-structs").DefineStructReturnType<[readonly ["visualRow", "u32"], readonly ["visualCol", "u32"], readonly ["logicalRow", "u32"], readonly ["logicalCol", "u32"], readonly ["offset", "u32"]], {}>;
export declare const TerminalCapabilitiesStruct: import("bun-ffi-structs").DefineStructReturnType<[readonly ["kitty_keyboard", "bool_u8"], readonly ["kitty_graphics", "bool_u8"], readonly ["rgb", "bool_u8"], readonly ["unicode", import("bun-ffi-structs").EnumDef<{
    wcwidth: number;
    unicode: number;
}>], readonly ["sgr_pixels", "bool_u8"], readonly ["color_scheme_updates", "bool_u8"], readonly ["explicit_width", "bool_u8"], readonly ["scaled_text", "bool_u8"], readonly ["sixel", "bool_u8"], readonly ["focus_tracking", "bool_u8"], readonly ["sync", "bool_u8"], readonly ["bracketed_paste", "bool_u8"], readonly ["hyperlinks", "bool_u8"], readonly ["osc52", "bool_u8"], readonly ["explicit_cursor_positioning", "bool_u8"], readonly ["term_name", "char*"], readonly ["term_name_len", "u64", {
    readonly lengthOf: "term_name";
}], readonly ["term_version", "char*"], readonly ["term_version_len", "u64", {
    readonly lengthOf: "term_version";
}], readonly ["term_from_xtversion", "bool_u8"]], {}>;
export declare const EncodedCharStruct: import("bun-ffi-structs").DefineStructReturnType<[readonly ["width", "u8"], readonly ["char", "u32"]], {}>;
export declare const LineInfoStruct: import("bun-ffi-structs").DefineStructReturnType<[readonly ["startCols", readonly ["u32"]], readonly ["startColsLen", "u32", {
    readonly lengthOf: "startCols";
}], readonly ["widthCols", readonly ["u32"]], readonly ["widthColsLen", "u32", {
    readonly lengthOf: "widthCols";
}], readonly ["sources", readonly ["u32"]], readonly ["sourcesLen", "u32", {
    readonly lengthOf: "sources";
}], readonly ["wraps", readonly ["u32"]], readonly ["wrapsLen", "u32", {
    readonly lengthOf: "wraps";
}], readonly ["widthColsMax", "u32"]], {}>;
export declare const MeasureResultStruct: import("bun-ffi-structs").DefineStructReturnType<[readonly ["lineCount", "u32"], readonly ["widthColsMax", "u32"]], {}>;
export declare const CursorStateStruct: import("bun-ffi-structs").DefineStructReturnType<[readonly ["x", "u32"], readonly ["y", "u32"], readonly ["visible", "bool_u8"], readonly ["style", "u8"], readonly ["blinking", "bool_u8"], readonly ["r", "f32"], readonly ["g", "f32"], readonly ["b", "f32"], readonly ["a", "f32"]], {}>;
export declare const CursorStyleOptionsStruct: import("bun-ffi-structs").DefineStructReturnType<[readonly ["style", "u8", {
    readonly default: 255;
}], readonly ["blinking", "u8", {
    readonly default: 255;
}], readonly ["color", "pointer", {
    readonly optional: true;
    readonly packTransform: (rgba?: RGBA) => Pointer | null;
    readonly unpackTransform: (ptr?: Pointer) => RGBA | undefined;
}], readonly ["cursor", "u8", {
    readonly default: 255;
}]], {}>;
export declare const GridDrawOptionsStruct: import("bun-ffi-structs").DefineStructReturnType<[readonly ["drawInner", "bool_u8", {
    readonly default: true;
}], readonly ["drawOuter", "bool_u8", {
    readonly default: true;
}]], {}>;
export type BuildOptions = {
    gpaSafeStats: boolean;
    gpaMemoryLimitTracking: boolean;
};
export declare const BuildOptionsStruct: import("bun-ffi-structs").DefineStructReturnType<[readonly ["gpaSafeStats", "bool_u8"], readonly ["gpaMemoryLimitTracking", "bool_u8"]], {}>;
export type AllocatorStats = {
    totalRequestedBytes: number;
    activeAllocations: number;
    smallAllocations: number;
    largeAllocations: number;
    requestedBytesValid: boolean;
};
export declare const AllocatorStatsStruct: import("bun-ffi-structs").DefineStructReturnType<[readonly ["totalRequestedBytes", "u64"], readonly ["activeAllocations", "u64"], readonly ["smallAllocations", "u64"], readonly ["largeAllocations", "u64"], readonly ["requestedBytesValid", "bool_u8"]], {}>;
export type GrowthPolicy = "grow" | "block";
export type NativeSpanFeedOptions = {
    chunkSize?: number;
    initialChunks?: number;
    maxBytes?: bigint;
    growthPolicy?: GrowthPolicy;
    autoCommitOnFull?: boolean;
    spanQueueCapacity?: number;
};
export type NativeSpanFeedStats = {
    bytesWritten: bigint;
    spansCommitted: bigint;
    chunks: number;
    pendingSpans: number;
};
export type SpanInfo = {
    chunkPtr: Pointer;
    offset: number;
    len: number;
    chunkIndex: number;
};
export type ReserveInfo = {
    ptr: Pointer;
    len: number;
};
export declare const NativeSpanFeedOptionsStruct: import("bun-ffi-structs").DefineStructReturnType<[readonly ["chunkSize", "u32", {
    readonly default: number;
}], readonly ["initialChunks", "u32", {
    readonly default: 2;
}], readonly ["maxBytes", "u64", {
    readonly default: 0n;
}], readonly ["growthPolicy", import("bun-ffi-structs").EnumDef<{
    grow: number;
    block: number;
}>, {
    readonly default: "grow";
}], readonly ["autoCommitOnFull", "bool_u8", {
    readonly default: true;
}], readonly ["spanQueueCapacity", "u32", {
    readonly default: 0;
}]], {}>;
export declare const NativeSpanFeedStatsStruct: import("bun-ffi-structs").DefineStructReturnType<[readonly ["bytesWritten", "u64"], readonly ["spansCommitted", "u64"], readonly ["chunks", "u32"], readonly ["pendingSpans", "u32"]], {}>;
export declare const SpanInfoStruct: import("bun-ffi-structs").DefineStructReturnType<[readonly ["chunkPtr", "pointer"], readonly ["offset", "u32"], readonly ["len", "u32"], readonly ["chunkIndex", "u32"], readonly ["reserved", "u32", {
    readonly default: 0;
}]], {
    readonly reduceValue: (value: {
        chunkPtr: Pointer;
        offset: number;
        len: number;
        chunkIndex: number;
    }) => {
        chunkPtr: Pointer;
        offset: number;
        len: number;
        chunkIndex: number;
    };
}>;
export declare const ReserveInfoStruct: import("bun-ffi-structs").DefineStructReturnType<[readonly ["ptr", "pointer"], readonly ["len", "u32"], readonly ["reserved", "u32", {
    readonly default: 0;
}]], {
    readonly reduceValue: (value: {
        ptr: Pointer;
        len: number;
    }) => {
        ptr: Pointer;
        len: number;
    };
}>;
export {};
