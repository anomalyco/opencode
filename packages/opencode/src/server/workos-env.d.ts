/** Evaluated on each use so `process.env` (and tests) can be set after modules load. */
/**
 * When true, the API uses WorkOS sealed-session cookies (normal Veritly web / hosted mode).
 * When false, the API does not enforce WorkOS (e.g. local `serve` with password or open dev).
 */
export declare function isOpencodeWorkosEnabled(): boolean;
