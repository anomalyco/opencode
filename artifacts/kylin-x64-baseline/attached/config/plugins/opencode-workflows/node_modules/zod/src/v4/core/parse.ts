import * as core from "./core.js";
import * as errors from "./errors.js";
import type * as schemas from "./schemas.js";
import * as util from "./util.js";

export type $ZodErrorClass = { new (issues: errors.$ZodIssue[]): errors.$ZodError };

///////////        METHODS       ///////////
export type $Parse = <T extends schemas.$ZodType>(
  schema: T,
  value: unknown,
  _ctx?: schemas.ParseContext<errors.$ZodIssue>,
  _params?: { callee?: util.AnyFunc; Err?: $ZodErrorClass }
) => core.output<T>;

export const _parse: (_Err: $ZodErrorClass) => $Parse = (_Err) => (schema, value, _ctx, _params) => {
  const ctx: schemas.ParseContextInternal = _ctx ? Object.assign(_ctx, { async: false }) : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new core.$ZodAsyncError();
  }
  if (result.issues.length) {
    const e = new (_params?.Err ?? _Err)(result.issues.map((iss) => util.finalizeIssue(iss, ctx, core.config())));
    util.captureStackTrace(e, _params?.callee);
    throw e;
  }
  return result.value as core.output<typeof schema>;
};

export const parse: $Parse = /* @__PURE__*/ _parse(errors.$ZodRealError);

export type $ParseAsync = <T extends schemas.$ZodType>(
  schema: T,
  value: unknown,
  _ctx?: schemas.ParseContext<errors.$ZodIssue>,
  _params?: { callee?: util.AnyFunc; Err?: $ZodErrorClass }
) => Promise<core.output<T>>;

export const _parseAsync: (_Err: $ZodErrorClass) => $ParseAsync = (_Err) => async (schema, value, _ctx, params) => {
  const ctx: schemas.ParseContextInternal = _ctx ? Object.assign(_ctx, { async: true }) : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) result = await result;
  if (result.issues.length) {
    const e = new (params?.Err ?? _Err)(result.issues.map((iss) => util.finalizeIssue(iss, ctx, core.config())));
    util.captureStackTrace(e, params?.callee);
    throw e;
  }
  return result.value as core.output<typeof schema>;
};

export const parseAsync: $ParseAsync = /* @__PURE__*/ _parseAsync(errors.$ZodRealError);

export type $SafeParse = <T extends schemas.$ZodType>(
  schema: T,
  value: unknown,
  _ctx?: schemas.ParseContext<errors.$ZodIssue>
) => util.SafeParseResult<core.output<T>>;

export const _safeParse: (_Err: $ZodErrorClass) => $SafeParse = (_Err) => (schema, value, _ctx) => {
  const ctx: schemas.ParseContextInternal = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new core.$ZodAsyncError();
  }

  return result.issues.length
    ? {
        success: false,
        error: new (_Err ?? errors.$ZodError)(result.issues.map((iss) => util.finalizeIssue(iss, ctx, core.config()))),
      }
    : ({ success: true, data: result.value } as any);
};
export const safeParse: $SafeParse = /* @__PURE__*/ _safeParse(errors.$ZodRealError);

export type $SafeParseAsync = <T extends schemas.$ZodType>(
  schema: T,
  value: unknown,
  _ctx?: schemas.ParseContext<errors.$ZodIssue>
) => Promise<util.SafeParseResult<core.output<T>>>;

export const _safeParseAsync: (_Err: $ZodErrorClass) => $SafeParseAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx: schemas.ParseContextInternal = _ctx ? Object.assign(_ctx, { async: true }) : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) result = await result;

  return result.issues.length
    ? {
        success: false,
        error: new _Err(result.issues.map((iss) => util.finalizeIssue(iss, ctx, core.config()))),
      }
    : ({ success: true, data: result.value } as any);
};

export const safeParseAsync: $SafeParseAsync = /* @__PURE__*/ _safeParseAsync(errors.$ZodRealError);

// Codec functions
export type $Encode = <T extends schemas.$ZodType>(
  schema: T,
  value: core.output<T>,
  _ctx?: schemas.ParseContext<errors.$ZodIssue>
) => core.input<T>;

export const _encode: (_Err: $ZodErrorClass) => $Encode = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? Object.assign(_ctx, { direction: "backward" as const }) : { direction: "backward" as const };
  return _parse(_Err)(schema, value, ctx as any) as any;
};

export const encode: $Encode = /* @__PURE__*/ _encode(errors.$ZodRealError);

export type $Decode = <T extends schemas.$ZodType>(
  schema: T,
  value: core.input<T>,
  _ctx?: schemas.ParseContext<errors.$ZodIssue>
) => core.output<T>;

export const _decode: (_Err: $ZodErrorClass) => $Decode = (_Err) => (schema, value, _ctx) => {
  return _parse(_Err)(schema, value, _ctx);
};

export const decode: $Decode = /* @__PURE__*/ _decode(errors.$ZodRealError);

export type $EncodeAsync = <T extends schemas.$ZodType>(
  schema: T,
  value: core.output<T>,
  _ctx?: schemas.ParseContext<errors.$ZodIssue>
) => Promise<core.input<T>>;

export const _encodeAsync: (_Err: $ZodErrorClass) => $EncodeAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? Object.assign(_ctx, { direction: "backward" as const }) : { direction: "backward" as const };
  return _parseAsync(_Err)(schema, value, ctx as any) as any;
};

export const encodeAsync: $EncodeAsync = /* @__PURE__*/ _encodeAsync(errors.$ZodRealError);

export type $DecodeAsync = <T extends schemas.$ZodType>(
  schema: T,
  value: core.input<T>,
  _ctx?: schemas.ParseContext<errors.$ZodIssue>
) => Promise<core.output<T>>;

export const _decodeAsync: (_Err: $ZodErrorClass) => $DecodeAsync = (_Err) => async (schema, value, _ctx) => {
  return _parseAsync(_Err)(schema, value, _ctx);
};

export const decodeAsync: $DecodeAsync = /* @__PURE__*/ _decodeAsync(errors.$ZodRealError);

export type $SafeEncode = <T extends schemas.$ZodType>(
  schema: T,
  value: core.output<T>,
  _ctx?: schemas.ParseContext<errors.$ZodIssue>
) => util.SafeParseResult<core.input<T>>;

export const _safeEncode: (_Err: $ZodErrorClass) => $SafeEncode = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? Object.assign(_ctx, { direction: "backward" as const }) : { direction: "backward" as const };
  return _safeParse(_Err)(schema, value, ctx as any) as any;
};

export const safeEncode: $SafeEncode = /* @__PURE__*/ _safeEncode(errors.$ZodRealError);

export type $SafeDecode = <T extends schemas.$ZodType>(
  schema: T,
  value: core.input<T>,
  _ctx?: schemas.ParseContext<errors.$ZodIssue>
) => util.SafeParseResult<core.output<T>>;

export const _safeDecode: (_Err: $ZodErrorClass) => $SafeDecode = (_Err) => (schema, value, _ctx) => {
  return _safeParse(_Err)(schema, value, _ctx);
};

export const safeDecode: $SafeDecode = /* @__PURE__*/ _safeDecode(errors.$ZodRealError);

export type $SafeEncodeAsync = <T extends schemas.$ZodType>(
  schema: T,
  value: core.output<T>,
  _ctx?: schemas.ParseContext<errors.$ZodIssue>
) => Promise<util.SafeParseResult<core.input<T>>>;

export const _safeEncodeAsync: (_Err: $ZodErrorClass) => $SafeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? Object.assign(_ctx, { direction: "backward" as const }) : { direction: "backward" as const };
  return _safeParseAsync(_Err)(schema, value, ctx as any) as any;
};

export const safeEncodeAsync: $SafeEncodeAsync = /* @__PURE__*/ _safeEncodeAsync(errors.$ZodRealError);

export type $SafeDecodeAsync = <T extends schemas.$ZodType>(
  schema: T,
  value: core.input<T>,
  _ctx?: schemas.ParseContext<errors.$ZodIssue>
) => Promise<util.SafeParseResult<core.output<T>>>;

export const _safeDecodeAsync: (_Err: $ZodErrorClass) => $SafeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
  return _safeParseAsync(_Err)(schema, value, _ctx);
};

export const safeDecodeAsync: $SafeDecodeAsync = /* @__PURE__*/ _safeDecodeAsync(errors.$ZodRealError);
