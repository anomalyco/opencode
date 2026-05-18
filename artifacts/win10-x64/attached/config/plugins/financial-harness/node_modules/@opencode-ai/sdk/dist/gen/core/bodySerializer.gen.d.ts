import type { ArrayStyle, ObjectStyle, SerializerOptions } from "./pathSerializer.gen.js";
export type QuerySerializer = (query: Record<string, unknown>) => string;
export type BodySerializer = (body: any) => any;
export interface QuerySerializerOptions {
    allowReserved?: boolean;
    array?: SerializerOptions<ArrayStyle>;
    object?: SerializerOptions<ObjectStyle>;
}
export declare const formDataBodySerializer: {
    bodySerializer: <T extends Record<string, any> | Array<Record<string, any>>>(body: T) => FormData;
};
export declare const jsonBodySerializer: {
    bodySerializer: <T>(body: T) => string;
};
export declare const urlSearchParamsBodySerializer: {
    bodySerializer: <T extends Record<string, any> | Array<Record<string, any>>>(body: T) => string;
};
