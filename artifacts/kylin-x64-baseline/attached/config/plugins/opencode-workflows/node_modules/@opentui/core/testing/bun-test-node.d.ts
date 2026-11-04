import { after, afterEach, before, beforeEach, describe as nodeDescribe, test as nodeTest } from "node:test";
type AnyFunction = (...args: any[]) => any;
type ThrowMatcher = RegExp | string | Error | ((value: unknown) => boolean) | (new (...args: any[]) => Error);
declare const asymmetricMatcher: unique symbol;
interface AsymmetricMatcher {
    readonly [asymmetricMatcher]: true;
    matches(received: unknown): boolean;
}
interface MockedFunction<Fn extends AnyFunction = AnyFunction> {
    (...args: Parameters<Fn>): ReturnType<Fn>;
    mock: {
        calls: unknown[][];
    };
    mockImplementation(implementation: Fn): MockedFunction<Fn>;
    mockRestore(): void;
    mockClear(): void;
}
declare function createEach(base: AnyFunction): (cases: readonly unknown[]) => (name: string, optionsOrFn?: unknown, maybeFn?: unknown) => void;
declare class AsyncExpectation<T> {
    private readonly received;
    private readonly mode;
    private readonly inverted;
    constructor(received: PromiseLike<T> | T, mode: "resolves" | "rejects", inverted?: boolean);
    get not(): AsyncExpectation<T>;
    toBe(expected: unknown): Promise<void>;
    toEqual(expected: unknown): Promise<void>;
    toBeNull(): Promise<void>;
    toBeUndefined(): Promise<void>;
    toContain(expected: unknown): Promise<void>;
    toHaveProperty(property: PropertyKey, expectedValue?: unknown): Promise<void>;
    toMatchSnapshot(snapshotName?: string): Promise<void>;
    toMatchInlineSnapshot(snapshot: string): Promise<void>;
    toThrow(expected?: ThrowMatcher): Promise<void>;
    toHaveBeenCalled(): Promise<void>;
    toHaveBeenCalledTimes(expected: number): Promise<void>;
    toHaveBeenCalledWith(...expectedArgs: unknown[]): Promise<void>;
    private unwrap;
}
declare class Expectation<T> {
    private readonly received;
    private readonly inverted;
    constructor(received: T, inverted?: boolean);
    get not(): Expectation<T>;
    get resolves(): AsyncExpectation<T>;
    get rejects(): AsyncExpectation<T>;
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeNull(): void;
    toBeUndefined(): void;
    toBeDefined(): void;
    toContain(expected: unknown): void;
    toHaveLength(expected: number): void;
    toBeInstanceOf(expected: new (...args: any[]) => unknown): void;
    toMatchObject(expected: object): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toBeGreaterThan(expected: number | bigint): void;
    toBeGreaterThanOrEqual(expected: number | bigint): void;
    toBeLessThan(expected: number | bigint): void;
    toBeLessThanOrEqual(expected: number | bigint): void;
    toBeCloseTo(expected: number, precision?: number): void;
    toMatch(expected: RegExp | string): void;
    toMatchSnapshot(snapshotName?: string): void;
    toMatchInlineSnapshot(snapshot: string): void;
    toThrow(expected?: ThrowMatcher): void;
    toHaveBeenCalled(): void;
    toHaveBeenCalledTimes(expected: number): void;
    toHaveBeenCalledWith(...expectedArgs: unknown[]): void;
    toHaveProperty(property: PropertyKey, expectedValue?: unknown): void;
    private assertMatch;
}
interface ExpectApi {
    <T>(received: T): Expectation<T>;
    any(expectedType: unknown): AsymmetricMatcher;
}
export declare const expect: ExpectApi;
export declare function mock<Fn extends AnyFunction = () => undefined>(implementation?: Fn): MockedFunction<Fn>;
export declare function spyOn(object: object, key: string | symbol): MockedFunction;
export declare const beforeAll: typeof before;
export declare const afterAll: typeof after;
export declare const test: typeof nodeTest & {
    each: ReturnType<typeof createEach>;
};
export declare const it: typeof nodeTest & {
    each: ReturnType<typeof createEach>;
};
export declare const describe: typeof nodeDescribe;
export { afterEach, beforeEach };
