import { after, afterEach, before, beforeEach, describe, it, test } from "node:test";
type ThrowMatcher = RegExp | string | Error | ((value: unknown) => boolean) | (new (...args: any[]) => Error);
declare class Expectation<T> {
    private readonly received;
    constructor(received: T);
    toBe(expected: T): void;
    toBeNull(): void;
    toEqual(expected: unknown): void;
    toThrow(expected?: ThrowMatcher): void;
}
export declare function expect<T>(received: T): Expectation<T>;
export { after, afterEach, before, beforeEach, describe, it, test };
