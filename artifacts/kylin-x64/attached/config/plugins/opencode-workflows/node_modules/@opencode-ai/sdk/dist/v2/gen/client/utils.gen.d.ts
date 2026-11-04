import type { QuerySerializerOptions } from "../core/bodySerializer.gen.js";
import type { Client, ClientOptions, Config, RequestOptions } from "./types.gen.js";
export declare const createQuerySerializer: <T = unknown>({ parameters, ...args }?: QuerySerializerOptions) => (queryParams: T) => string;
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
    fns: Array<Interceptor | null>;
    clear(): void;
    eject(id: number | Interceptor): void;
    exists(id: number | Interceptor): boolean;
    getInterceptorIndex(id: number | Interceptor): number;
    update(id: number | Interceptor, fn: Interceptor): number | Interceptor | false;
    use(fn: Interceptor): number;
}
export interface Middleware<Req, Res, Err, Options> {
    error: Interceptors<ErrInterceptor<Err, Res, Req, Options>>;
    request: Interceptors<ReqInterceptor<Req, Options>>;
    response: Interceptors<ResInterceptor<Res, Req, Options>>;
}
export declare const createInterceptors: <Req, Res, Err, Options>() => Middleware<Req, Res, Err, Options>;
export declare const createConfig: <T extends ClientOptions = ClientOptions>(override?: Config<Omit<ClientOptions, keyof T> & T>) => Config<Omit<ClientOptions, keyof T> & T>;
export {};
