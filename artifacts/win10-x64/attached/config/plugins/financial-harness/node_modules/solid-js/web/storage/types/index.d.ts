import type { RequestEvent } from "solid-js/web";
export declare function provideRequestEvent<T extends RequestEvent, U>(init: T, cb: () => U): U;
