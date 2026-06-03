import type { BodySerializer, QuerySerializer } from "./bodySerializer.gen.js";
export interface PathSerializer {
    path: Record<string, unknown>;
    url: string;
}
export declare const PATH_PARAM_RE: RegExp;
export declare const defaultPathSerializer: ({ path, url: _url }: PathSerializer) => string;
export declare const getUrl: ({ baseUrl, path, query, querySerializer, url: _url, }: {
    baseUrl?: string;
    path?: Record<string, unknown>;
    query?: Record<string, unknown>;
    querySerializer: QuerySerializer;
    url: string;
}) => string;
export declare function getValidRequestBody(options: {
    body?: unknown;
    bodySerializer?: BodySerializer | null;
    serializedBody?: unknown;
}): unknown;
