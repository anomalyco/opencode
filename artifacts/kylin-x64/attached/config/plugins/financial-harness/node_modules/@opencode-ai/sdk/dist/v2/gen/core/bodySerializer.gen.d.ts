import type { ArrayStyle, ObjectStyle, SerializerOptions } from "./pathSerializer.gen.js";
export type QuerySerializer = (query: Record<string, unknown>) => string;
export type BodySerializer = (body: any) => any;
type QuerySerializerOptionsObject = {
    allowReserved?: boolean;
    array?: Partial<SerializerOptions<ArrayStyle>>;
    object?: Partial<SerializerOptions<ObjectStyle>>;
};
export type QuerySerializerOptions = QuerySerializerOptionsObject & {
    /**
     * Per-parameter serialization overrides. When provided, these settings
     * override the global array/object settings for specific parameter names.
     */
    parameters?: Record<string, QuerySerializerOptionsObject>;
};
export declare const formDataBodySerializer: {
    bodySerializer: <T extends Record<string, any> | Array<Record<string, any>>>(body: T) => FormData;
};
export declare const jsonBodySerializer: {
    bodySerializer: <T>(body: T) => string;
};
export declare const urlSearchParamsBodySerializer: {
    bodySerializer: <T extends Record<string, any> | Array<Record<string, any>>>(body: T) => string;
};
export {};
