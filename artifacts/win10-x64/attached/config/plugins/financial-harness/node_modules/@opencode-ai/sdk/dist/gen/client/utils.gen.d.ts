import type { QuerySerializerOptions } from "../core/bodySerializer.gen.js";
import type { Client, ClientOptions, Config, RequestOptions } from "./types.gen.js";
export declare const createQuerySerializer: <T = unknown>({ allowReserved, array, object }?: QuerySerializerOptions) => (queryParams: T) => string;
/**
 * Infers parseAs value from provided Content-Type header.
 */
export declare const getParseAs: (contentType: string | null) => Exclude<Config["parseAs"], "auto">;
export declare const setAuthParams: ({ security, ...options }: Pick<Required<RequestOptions>, "security"> & Pick<RequestOptions, "auth" | "query"> & {
    headers: Headers;
}) => Promise<void>;
export declare const buildUrl: Client["buildUrl"];
export declare const mergeConfigs: (a: Config, b: Config) => Config;
export declare const mergeHeaders: (...headers: Array<Required<Config>["headers"] | undefined>) => Headers;
type ErrInterceptor<Err, Res, Req, Options> = (error: Err, response: Res, request: Req, options: Options) => Err | Promise<Err>;
type ReqInterceptor<Req, Options> = (request: Req, options: Options) => Req | Promise<Req>;
type ResInterceptor<Res, Req, Options> = (response: Res, request: Req, options: Options) => Res | Promise<Res>;
declare class Interceptors<Interceptor> {
    _fns: (Interceptor | null)[];
    constructor();
    clear(): void;
    getInterceptorIndex(id: number | Interceptor): number;
    exists(id: number | Interceptor): boolean;
    eject(id: number | Interceptor): void;
    update(id: number | Interceptor, fn: Interceptor): number | false | Interceptor;
    use(fn: Interceptor): number;
}
export interface Middleware<Req, Res, Err, Options> {
    error: Pick<Interceptors<ErrInterceptor<Err, Res, Req, Options>>, "eject" | "use">;
    request: Pick<Interceptors<ReqInterceptor<Req, Options>>, "eject" | "use">;
    response: Pick<Interceptors<ResInterceptor<Res, Req, Options>>, "eject" | "use">;
}
export declare const createInterceptors: <Req, Res, Err, Options>() => {
    error: Interceptors<ErrInterceptor<Err, Res, Req, Options>>;
    request: Interceptors<ReqInterceptor<Req, Options>>;
    response: Interceptors<ResInterceptor<Res, Req, Options>>;
};
export declare const createConfig: <T extends ClientOptions = ClientOptions>(override?: Config<Omit<ClientOptions, keyof T> & T>) => Config<Omit<ClientOptions, keyof T> & T>;
export {};
