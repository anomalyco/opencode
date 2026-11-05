import * as core from "../core/index.js";
import { type ZodError } from "./errors.js";
export type ZodSafeParseResult<T> = ZodSafeParseSuccess<T> | ZodSafeParseError<T>;
export type ZodSafeParseSuccess<T> = {
    success: true;
    data: T;
    error?: never;
};
export type ZodSafeParseError<T> = {
    success: false;
    data?: never;
    error: ZodError<T>;
};
export declare const parse: <T extends core.$ZodType>(schema: T, value: unknown, _ctx?: core.ParseContext<core.$ZodIssue>, _params?: {
    callee?: core.util.AnyFunc;
    Err?: core.$ZodErrorClass;
}) => core.output<T>;
export declare const parseAsync: <T extends core.$ZodType>(schema: T, value: unknown, _ctx?: core.ParseContext<core.$ZodIssue>, _params?: {
    callee?: core.util.AnyFunc;
    Err?: core.$ZodErrorClass;
}) => Promise<core.output<T>>;
export declare const safeParse: <T extends core.$ZodType>(schema: T, value: unknown, _ctx?: core.ParseContext<core.$ZodIssue>) => ZodSafeParseResult<core.output<T>>;
export declare const safeParseAsync: <T extends core.$ZodType>(schema: T, value: unknown, _ctx?: core.ParseContext<core.$ZodIssue>) => Promise<ZodSafeParseResult<core.output<T>>>;
export declare const encode: <T extends core.$ZodType>(schema: T, value: core.output<T>, _ctx?: core.ParseContext<core.$ZodIssue>) => core.input<T>;
export declare const decode: <T extends core.$ZodType>(schema: T, value: core.input<T>, _ctx?: core.ParseContext<core.$ZodIssue>) => core.output<T>;
export declare const encodeAsync: <T extends core.$ZodType>(schema: T, value: core.output<T>, _ctx?: core.ParseContext<core.$ZodIssue>) => Promise<core.input<T>>;
export declare const decodeAsync: <T extends core.$ZodType>(schema: T, value: core.input<T>, _ctx?: core.ParseContext<core.$ZodIssue>) => Promise<core.output<T>>;
export declare const safeEncode: <T extends core.$ZodType>(schema: T, value: core.output<T>, _ctx?: core.ParseContext<core.$ZodIssue>) => ZodSafeParseResult<core.input<T>>;
export declare const safeDecode: <T extends core.$ZodType>(schema: T, value: core.input<T>, _ctx?: core.ParseContext<core.$ZodIssue>) => ZodSafeParseResult<core.output<T>>;
export declare const safeEncodeAsync: <T extends core.$ZodType>(schema: T, value: core.output<T>, _ctx?: core.ParseContext<core.$ZodIssue>) => Promise<ZodSafeParseResult<core.input<T>>>;
export declare const safeDecodeAsync: <T extends core.$ZodType>(schema: T, value: core.input<T>, _ctx?: core.ParseContext<core.$ZodIssue>) => Promise<ZodSafeParseResult<core.output<T>>>;
