import { type Context } from "hono";
import type { User } from "@workos-inc/node";
export declare function getCookieOptions(): {
    path: string;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "lax";
    domain: string | undefined;
    maxAge: number;
};
export type SessionUser = User;
export declare const AuthRoutes: import("hono/hono-base").HonoBase<import("hono/types").BlankEnv, {
    "/login": {
        $get: {
            input: {};
            output: undefined;
            outputFormat: "redirect";
            status: 302;
        } | {
            input: {};
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 500;
        };
    };
} & {
    "/callback": {
        $get: {
            input: {};
            output: undefined;
            outputFormat: "redirect";
            status: 302;
        } | {
            input: {};
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
        };
    };
} & {
    "/logout": {
        $get: {
            input: {};
            output: undefined;
            outputFormat: "redirect";
            status: 302;
        } | {
            input: {};
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 500;
        };
    };
} & {
    "/session": {
        $get: {
            input: {};
            output: {
                user: {
                    id: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        } | {
            input: {};
            output: {
                user: null;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/">;
export declare function getSessionUser(): Promise<User | null>;
export declare function getRequestUser(c: Pick<Context, "req">): Promise<User | null>;
