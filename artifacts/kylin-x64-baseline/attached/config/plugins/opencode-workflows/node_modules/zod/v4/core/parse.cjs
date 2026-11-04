"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeDecodeAsync = exports._safeDecodeAsync = exports.safeEncodeAsync = exports._safeEncodeAsync = exports.safeDecode = exports._safeDecode = exports.safeEncode = exports._safeEncode = exports.decodeAsync = exports._decodeAsync = exports.encodeAsync = exports._encodeAsync = exports.decode = exports._decode = exports.encode = exports._encode = exports.safeParseAsync = exports._safeParseAsync = exports.safeParse = exports._safeParse = exports.parseAsync = exports._parseAsync = exports.parse = exports._parse = void 0;
const core = __importStar(require("./core.cjs"));
const errors = __importStar(require("./errors.cjs"));
const util = __importStar(require("./util.cjs"));
const _parse = (_Err) => (schema, value, _ctx, _params) => {
    const ctx = _ctx ? Object.assign(_ctx, { async: false }) : { async: false };
    const result = schema._zod.run({ value, issues: [] }, ctx);
    if (result instanceof Promise) {
        throw new core.$ZodAsyncError();
    }
    if (result.issues.length) {
        const e = new (_params?.Err ?? _Err)(result.issues.map((iss) => util.finalizeIssue(iss, ctx, core.config())));
        util.captureStackTrace(e, _params?.callee);
        throw e;
    }
    return result.value;
};
exports._parse = _parse;
exports.parse = (0, exports._parse)(errors.$ZodRealError);
const _parseAsync = (_Err) => async (schema, value, _ctx, params) => {
    const ctx = _ctx ? Object.assign(_ctx, { async: true }) : { async: true };
    let result = schema._zod.run({ value, issues: [] }, ctx);
    if (result instanceof Promise)
        result = await result;
    if (result.issues.length) {
        const e = new (params?.Err ?? _Err)(result.issues.map((iss) => util.finalizeIssue(iss, ctx, core.config())));
        util.captureStackTrace(e, params?.callee);
        throw e;
    }
    return result.value;
};
exports._parseAsync = _parseAsync;
exports.parseAsync = (0, exports._parseAsync)(errors.$ZodRealError);
const _safeParse = (_Err) => (schema, value, _ctx) => {
    const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
    const result = schema._zod.run({ value, issues: [] }, ctx);
    if (result instanceof Promise) {
        throw new core.$ZodAsyncError();
    }
    return result.issues.length
        ? {
            success: false,
            error: new (_Err ?? errors.$ZodError)(result.issues.map((iss) => util.finalizeIssue(iss, ctx, core.config()))),
        }
        : { success: true, data: result.value };
};
exports._safeParse = _safeParse;
exports.safeParse = (0, exports._safeParse)(errors.$ZodRealError);
const _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
    const ctx = _ctx ? Object.assign(_ctx, { async: true }) : { async: true };
    let result = schema._zod.run({ value, issues: [] }, ctx);
    if (result instanceof Promise)
        result = await result;
    return result.issues.length
        ? {
            success: false,
            error: new _Err(result.issues.map((iss) => util.finalizeIssue(iss, ctx, core.config()))),
        }
        : { success: true, data: result.value };
};
exports._safeParseAsync = _safeParseAsync;
exports.safeParseAsync = (0, exports._safeParseAsync)(errors.$ZodRealError);
const _encode = (_Err) => (schema, value, _ctx) => {
    const ctx = _ctx ? Object.assign(_ctx, { direction: "backward" }) : { direction: "backward" };
    return (0, exports._parse)(_Err)(schema, value, ctx);
};
exports._encode = _encode;
exports.encode = (0, exports._encode)(errors.$ZodRealError);
const _decode = (_Err) => (schema, value, _ctx) => {
    return (0, exports._parse)(_Err)(schema, value, _ctx);
};
exports._decode = _decode;
exports.decode = (0, exports._decode)(errors.$ZodRealError);
const _encodeAsync = (_Err) => async (schema, value, _ctx) => {
    const ctx = _ctx ? Object.assign(_ctx, { direction: "backward" }) : { direction: "backward" };
    return (0, exports._parseAsync)(_Err)(schema, value, ctx);
};
exports._encodeAsync = _encodeAsync;
exports.encodeAsync = (0, exports._encodeAsync)(errors.$ZodRealError);
const _decodeAsync = (_Err) => async (schema, value, _ctx) => {
    return (0, exports._parseAsync)(_Err)(schema, value, _ctx);
};
exports._decodeAsync = _decodeAsync;
exports.decodeAsync = (0, exports._decodeAsync)(errors.$ZodRealError);
const _safeEncode = (_Err) => (schema, value, _ctx) => {
    const ctx = _ctx ? Object.assign(_ctx, { direction: "backward" }) : { direction: "backward" };
    return (0, exports._safeParse)(_Err)(schema, value, ctx);
};
exports._safeEncode = _safeEncode;
exports.safeEncode = (0, exports._safeEncode)(errors.$ZodRealError);
const _safeDecode = (_Err) => (schema, value, _ctx) => {
    return (0, exports._safeParse)(_Err)(schema, value, _ctx);
};
exports._safeDecode = _safeDecode;
exports.safeDecode = (0, exports._safeDecode)(errors.$ZodRealError);
const _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
    const ctx = _ctx ? Object.assign(_ctx, { direction: "backward" }) : { direction: "backward" };
    return (0, exports._safeParseAsync)(_Err)(schema, value, ctx);
};
exports._safeEncodeAsync = _safeEncodeAsync;
exports.safeEncodeAsync = (0, exports._safeEncodeAsync)(errors.$ZodRealError);
const _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
    return (0, exports._safeParseAsync)(_Err)(schema, value, _ctx);
};
exports._safeDecodeAsync = _safeDecodeAsync;
exports.safeDecodeAsync = (0, exports._safeDecodeAsync)(errors.$ZodRealError);
