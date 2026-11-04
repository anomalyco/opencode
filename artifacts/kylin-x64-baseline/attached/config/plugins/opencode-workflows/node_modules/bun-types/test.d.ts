/**
 *
 * To run tests, run `bun test`
 *
 * @example
 *
 * ```bash
 * $ bun test
 * ```
 *
 * @example
 * ```bash
 * $ bun test <filename>
 * ```
 */
declare module "bun:test" {
  export type Mock<T extends (...args: any[]) => any> = JestMock.Mock<T>;

  export const mock: {
    <T extends (...args: any[]) => any>(Function?: T): Mock<T>;

    /**
     * Replace the module `id` with the return value of `factory`.
     *
     * This is useful for mocking modules.
     *
     * If the module is already loaded, exports are overwritten with the return
     * value of `factory`. If the export didn't exist before, it will not be
     * added to existing import statements. This is due to how ESM works.
     *
     * @param id module ID to mock
     * @param factory a function returning an object that will be used as the exports of the mocked module
     *
     * @example
     * ```ts
     * import { mock } from "bun:test";
     *
     * mock.module("fs/promises", () => {
     *  return {
     *    readFile: () => Promise.resolve("hello world"),
     *  };
     * });
     *
     * import { readFile } from "fs/promises";
     *
     * console.log(await readFile("hello.txt", "utf8")); // hello world
     * ```
     */
    module(id: string, factory: () => any): void | Promise<void>;
    /**
     * Restore the previous value of mocks.
     */
    restore(): void;

    /**
     * Reset all mock function state (calls, results, etc.) without restoring their original implementation.
     */
    clearAllMocks(): void;
  };

  /**
   * Control the system time used by:
   * - `Date.now()`
   * - `new Date()`
   * - `Intl.DateTimeFormat().format()`
   *
   * In the future, we may add support for more functions, but we haven't done that yet.
   *
   * @param now The time to set the system time to. If not provided, the system time will be reset.
   * @returns `this`
   * @since v0.6.13
   *
   * ## Set Date to a specific time
   *
   * ```js
   * import { setSystemTime } from 'bun:test';
   *
   * setSystemTime(new Date('2020-01-01T00:00:00.000Z'));
   * console.log(new Date().toISOString()); // 2020-01-01T00:00:00.000Z
   * ```
   * ## Reset Date to the current time
   *
   * ```js
   * import { setSystemTime } from 'bun:test';
   *
   * setSystemTime();
   * ```
   */
  export function setSystemTime(now?: Date | number): ThisType<void>;

  export namespace jest {
    function restoreAllMocks(): void;
    function clearAllMocks(): void;
    function resetAllMocks(): void;
    function fn<T extends (...args: any[]) => any>(func?: T): Mock<T>;
    function setSystemTime(now?: number | Date): void;
    function setTimeout(milliseconds: number): void;
    function useFakeTimers(options?: { now?: number | Date }): typeof vi;
    function useRealTimers(): typeof vi;
    function advanceTimersByTime(milliseconds: number): typeof vi;
    function advanceTimersToNextTimer(): typeof vi;
    function runAllTimers(): typeof vi;
    function runOnlyPendingTimers(): typeof vi;
    function getTimerCount(): number;
    function clearAllTimers(): void;
    function isFakeTimers(): boolean;
    function spyOn<T extends object, K extends keyof T>(
      obj: T,
      methodOrPropertyValue: K,
    ): Mock<Extract<T[K], (...args: any[]) => any>>;

    /**
     * Constructs the type of a mock function, e.g. the return type of `jest.fn()`.
     */
    type Mock<T extends (...args: any[]) => any = (...args: any[]) => any> = JestMock.Mock<T>;
    /**
     * Wraps a class, function or object type with Jest mock type definitions.
     */
    // type Mocked<T extends object> = JestMock.Mocked<T>;
    /**
     * Wraps a class type with Jest mock type definitions.
     */
    // type MockedClass<T extends JestMock.ClassLike> = JestMock.MockedClass<T>;
    /**
     * Wraps a function type with Jest mock type definitions.
     */
    // type MockedFunction<T extends (...args: any[]) => any> = JestMock.MockedFunction<T>;
    /**
     * Wraps an object type with Jest mock type definitions.
     */
    // type MockedObject<T extends object> = JestMock.MockedObject<T>;
    /**
     * Constructs the type of a replaced property.
     */
    type Replaced<T> = JestMock.Replaced<T>;
    /**
     * Constructs the type of a spied class or function.
     */
    type Spied<T extends JestMock.ClassLike | ((...args: any[]) => any)> = JestMock.Spied<T>;
    /**
     * Constructs the type of a spied class.
     */
    type SpiedClass<T extends JestMock.ClassLike> = JestMock.SpiedClass<T>;
    /**
     * Constructs the type of a spied function.
     */
    type SpiedFunction<T extends (...args: any[]) => any> = JestMock.SpiedFunction<T>;
    /**
     * Constructs the type of a spied getter.
     */
    type SpiedGetter<T> = JestMock.SpiedGetter<T>;
    /**
     * Constructs the type of a spied setter.
     */
    type SpiedSetter<T> = JestMock.SpiedSetter<T>;
  }

  /**
   * Create a spy on an object property or method
   */
  export function spyOn<T extends object, K extends keyof T>(
    obj: T,
    methodOrPropertyValue: K,
  ): Mock<Extract<T[K], (...args: any[]) => any>>;

  /**
   * Vitest-compatible mocking utilities
   * Provides Vitest-style mocking API for easier migration from Vitest to Bun
   */
  export const vi: {
    /**
     * Create a mock function
     */
    fn: typeof jest.fn;
    /**
     * Create a spy on an object property or method
     */
    spyOn: typeof spyOn;
    /**
     * Mock a module
     */
    mock: typeof mock.module;
    /**
     * Restore all mocks to their original implementation
     */
    restoreAllMocks: typeof jest.restoreAllMocks;
    /**
     * Clear all mock state (calls, results, etc.) without restoring original implementation
     */
    clearAllMocks: typeof jest.clearAllMocks;
    resetAllMocks: typeof jest.resetAllMocks;
    useFakeTimers: typeof jest.useFakeTimers;
    useRealTimers: typeof jest.useRealTimers;
    advanceTimersByTime: typeof jest.advanceTimersByTime;
    advanceTimersToNextTimer: typeof jest.advanceTimersToNextTimer;
    runAllTimers: typeof jest.runAllTimers;
    runOnlyPendingTimers: typeof jest.runOnlyPendingTimers;
    getTimerCount: typeof jest.getTimerCount;
    clearAllTimers: typeof jest.clearAllTimers;
    isFakeTimers: typeof jest.isFakeTimers;
  };

  interface FunctionLike {
    readonly name: string;
  }

  type DescribeLabel = number | string | Function | FunctionLike;

  /**
   * Describes a group of related tests.
   *
   * @example
   * function sum(a, b) {
   *   return a + b;
   * }
   * describe("sum()", () => {
   *   test("can sum two values", () => {
   *     expect(sum(1, 1)).toBe(2);
   *   });
   * });
   *
   * @param label the label for the tests
   * @param fn the function that defines the tests
   *
   * @category Testing
   */
  export interface Describe<T extends Readonly<any[]>> {
    (fn: () => void): void;

    (label: DescribeLabel, fn: (...args: T) => void): void;
    /**
     * Skips all other tests, except this group of tests.
     */
    only: Describe<T>;
    /**
     * Skips this group of tests.
     */
    skip: Describe<T>;
    /**
     * Marks this group of tests as to be written or to be fixed.
     */
    todo: Describe<T>;
    /**
     * Marks this group of tests to be executed concurrently.
     */
    concurrent: Describe<T>;
    /**
     * Marks this group of tests to be executed serially (one after another),
     * even when the --concurrent flag is used.
     */
    serial: Describe<T>;
    /**
     * Runs this group of tests, only if `condition` is true.
     *
     * This is the opposite of `describe.skipIf()`.
     *
     * @param condition if these tests should run
     */
    if(condition: boolean): Describe<T>;
    /**
     * Skips this group of tests, if `condition` is true.
     *
     * @param condition if these tests should be skipped
     */
    skipIf(condition: boolean): Describe<T>;
    /**
     * Marks this group of tests as to be written or to be fixed, if `condition` is true.
     *
     * @param condition if these tests should be skipped
     */
    todoIf(condition: boolean): Describe<T>;
    /**
     * Returns a function that runs for each item in `table`.
     *
     * @param table Array of Arrays with the arguments that are passed into the test fn for each row.
     */
    each<T extends Readonly<[any, ...any[]]>>(table: readonly T[]): Describe<[...T]>;
    each<T extends any[]>(table: readonly T[]): Describe<[...T]>;
    each<const T>(table: T[]): Describe<[T]>;
  }
  /**
   * Describes a group of related tests.
   *
   * @example
   * function sum(a, b) {
   *   return a + b;
   * }
   * describe("sum()", () => {
   *   test("can sum two values", () => {
   *     expect(sum(1, 1)).toBe(2);
   *   });
   * });
   *
   * @param label the label for the tests
   * @param fn the function that defines the tests
   */
  export const describe: Describe<[]>;
  /**
   * Skips a group of related tests.
   *
   * This is equivalent to calling `describe.skip()`.
   *
   * @param label the label for the tests
   * @param fn the function that defines the tests
   */
  export const xdescribe: Describe<[]>;

  type HookOptions = number | { timeout?: number };
  /**
   * Runs a function, once, before all the tests.
   *
   * This is useful for running set up tasks, like initializing
   * a global variable or connecting to a database.
   *
   * If this function throws, tests will not run in this file.
   *
   * @example
   * let database;
   * beforeAll(async () => {
   *   database = await connect("localhost");
   * });
   *
   * @param fn the function to run
   */
  export function beforeAll(
    fn: (() => void | Promise<unknown>) | ((done: (err?: unknown) => void) => void),
    options?: HookOptions,
  ): void;
  /**
   * Runs a function before each test.
   *
   * This is useful for running set up tasks, like initializing
   * a global variable or connecting to a database.
   *
   * If this function throws, the test will not run.
   *
   * @param fn the function to run
   */
  export function beforeEach(
    fn: (() => void | Promise<unknown>) | ((done: (err?: unknown) => void) => void),
    options?: HookOptions,
  ): void;
  /**
   * Runs a function, once, after all the tests.
   *
   * This is useful for running clean up tasks, like closing
   * a socket or deleting temporary files.
   *
   * @example
   * let database;
   * afterAll(async () => {
   *   if (database) {
   *     await database.close();
   *   }
   * });
   *
   * @param fn the function to run
   */
  export function afterAll(
    fn: (() => void | Promise<unknown>) | ((done: (err?: unknown) => void) => void),
    options?: HookOptions,
  ): void;
  /**
   * Runs a function after each test.
   *
   * This is useful for running clean up tasks, like closing
   * a socket or deleting temporary files.
   *
   * @param fn the function to run
   */
  export function afterEach(
    fn: (() => void | Promise<unknown>) | ((done: (err?: unknown) => void) => void),
    options?: HookOptions,
  ): void;
  /**
   * Runs a function after a test finishes, including after all afterEach hooks.
   *
   * This is useful for cleanup tasks that need to run at the very end of a test,
   * after all other hooks have completed.
   *
   * Can only be called inside a test, not in describe blocks.
   *
   * @example
   * test("my test", () => {
   *   onTestFinished(() => {
   *     // This runs after all afterEach hooks
   *     console.log("Test finished!");
   *   });
   * });
   *
   * @param fn the function to run
   */
  export function onTestFinished(
    fn: (() => void | Promise<unknown>) | ((done: (err?: unknown) => void) => void),
    options?: HookOptions,
  ): void;
  /**
   * Sets the default timeout for all tests in the current file. If a test specifies a timeout, it will
   * override this value. The default timeout is 5000ms (5 seconds).
   *
   * @param milliseconds the number of milliseconds for the default timeout
   */
  export function setDefaultTimeout(milliseconds: number): void;
  export interface TestOptions {
    /**
     * Sets the timeout for the test in milliseconds.
     *
     * If the test does not complete within this time, the test will fail with:
     * ```ts
     * 'Timeout: test {name} timed out after 5000ms'
     * ```
     *
     * @default 5000 // 5 seconds
     */
    timeout?: number;
    /**
     * Sets the number of times to retry the test if it fails.
     *
     * @default 0
     */
    retry?: number;
    /**
     * Sets the number of times to repeat the test, regardless of whether it passed or failed.
     *
     * @default 0
     */
    repeats?: number;
  }

  namespace __internal {
    type IfNeverThenElse<T, Else> = [T] extends [never] ? Else : T;

    type IsTuple<T> = T extends readonly unknown[]
      ? number extends T["length"]
        ? false // It's an array with unknown length, not a tuple
        : true // It's an array with a fixed length (a tuple)
      : false; // Not an array at all

    /**
     * Accepts `[1, 2, 3] | ["a", "b", "c"]` and returns `[1 | "a", 2 | "b", 3 | "c"]`
     */
    type Flatten<T, Copy extends T = T> = { [Key in keyof T]: Copy[Key] };
  }

  /**
   * Runs a test.
   *
   * @example
   * test("can check if using Bun", () => {
   *   expect(Bun).toBeDefined();
   * });
   *
   * test("can make a fetch() request", async () => {
   *   const response = await fetch("https://example.com/");
   *   expect(response.ok).toBe(true);
   * });
   *
   * test("can set a timeout", async () => {
   *   await Bun.sleep(100);
   * }, 50); // or { timeout: 50 }
   *
   * @param label the label for the test
   * @param fn the test function
   * @param options the test timeout or options
   *
   * @category Testing
   */
  export interface Test<T extends ReadonlyArray<unknown>> {
    (
      label: string,

      fn: (
        ...args: __internal.IsTuple<T> extends true
          ? [...table: __internal.Flatten<T>, done: (err?: unknown) => void]
          : T
      ) => void | Promise<unknown>,

      /**
       * - If a `number`, sets the timeout for the test in milliseconds.
       * - If an `object`, sets the options for the test.
       *   - `timeout` sets the timeout for the test in milliseconds.
       *   - `retry` sets the number of times to retry the test if it fails.
       *   - `repeats` sets the number of times to repeat the test, regardless of whether it passed or failed.
       */
      options?: number | TestOptions,
    ): void;
    /**
     * Skips all other tests, except this test.
     */
    only: Test<T>;
    /**
     * Skips this test.
     */
    skip: Test<T>;
    /**
     * Marks this test as to be written or to be fixed.
     *
     * These tests will not be executed unless the `--todo` flag is passed. With the flag,
     * if the test passes, the test will be marked as `fail` in the results; you will have to
     * remove the `.todo` or check that your test
     * is implemented correctly.
     */
    todo: Test<T>;
    /**
     * Marks this test as failing.
     *
     * Use `test.failing` when you are writing a test and expecting it to fail.
     * These tests will behave the other way normal tests do. If failing test
     * will throw any errors then it will pass. If it does not throw it will
     * fail.
     *
     * `test.failing` is very similar to {@link test.todo} except that it always
     * runs, regardless of the `--todo` flag.
     */
    failing: Test<T>;
    /**
     * Runs the test concurrently with other concurrent tests.
     */
    concurrent: Test<T>;
    /**
     * Forces the test to run serially (not in parallel),
     * even when the --concurrent flag is used.
     */
    serial: Test<T>;
    /**
     * Runs this test, if `condition` is true.
     *
     * This is the opposite of `test.skipIf()`.
     *
     * @param condition if the test should run
     */
    if(condition: boolean): Test<T>;
    /**
     * Skips this test, if `condition` is true.
     *
     * @param condition if the test should be skipped
     */
    skipIf(condition: boolean): Test<T>;
    /**
     * Marks this test as to be written or to be fixed, if `condition` is true.
     *
     * @param condition if the test should be marked TODO
     */
    todoIf(condition: boolean): Test<T>;
    /**
     * Marks this test as failing, if `condition` is true.
     *
     * @param condition if the test should be marked as failing
     */
    failingIf(condition: boolean): Test<T>;
    /**
     * Runs the test concurrently with other concurrent tests, if `condition` is true.
     *
     * @param condition if the test should run concurrently
     */
    concurrentIf(condition: boolean): Test<T>;
    /**
     * Forces the test to run serially (not in parallel), if `condition` is true.
     * This applies even when the --concurrent flag is used.
     *
     * @param condition if the test should run serially
     */
    serialIf(condition: boolean): Test<T>;
    /**
     * Returns a function that runs for each item in `table`.
     *
     * @param table Array of Arrays with the arguments that are passed into the test fn for each row.
     */
    each<T extends Readonly<[unknown, ...unknown[]]>>(table: readonly T[]): Test<T>;
    each<T extends unknown[]>(table: readonly T[]): Test<T>;
    each<const T>(table: T[]): Test<[T]>;
  }
  /**
   * Runs a test.
   *
   * @example
   * test("can check if using Bun", () => {
   *   expect(Bun).toBeDefined();
   * });
   *
   * test("can make a fetch() request", async () => {
   *   const response = await fetch("https://example.com/");
   *   expect(response.ok).toBe(true);
   * });
   *
   * @param label the label for the test
   * @param fn the test function
   */
  export const test: Test<[]>;
  export { test as it, xtest as xit };

  /**
   * Skips a test.
   *
   * This is equivalent to calling `test.skip()`.
   *
   * @param label the label for the test
   * @param fn the test function
   */
  export const xtest: Test<[]>;

  /**
   * Asserts that a value matches some criteria.
   *
   * @link https://jestjs.io/docs/expect#reference
   * @example
   * expect(1 + 1).toBe(2);
   * expect([1,2,3]).toContain(2);
   * expect(null).toBeNull();
   *
   * @param actual The actual (received) value
   */
  export const expect: Expect;

  type ExpectNot = Omit<AsymmetricMatchers, keyof AsymmetricMatchersBuiltin> & AsymmetricMatchersBuiltinNegated;

  export interface Expect extends AsymmetricMatchers {
    // the `expect()` callable signature
    /**
     * @param actual the actual value
     * @param customFailMessage an optional custom message to display if the test fails.
     * */

    (actual?: never, customFailMessage?: string): Matchers<undefined>;
    <T = unknown>(actual: T, customFailMessage?: string): Matchers<T>;
    <T = unknown>(actual?: T, customFailMessage?: string): Matchers<T | undefined>;

    /**
     * Access to negated asymmetric matchers.
     *
     * @example
     * expect("abc").toEqual(expect.stringContaining("abc")); // will pass
     * expect("abc").toEqual(expect.not.stringContaining("abc")); // will fail
     */
    not: ExpectNot;

    /**
     * Create an asymmetric matcher for a promise resolved value.
     *
     * @example
     * expect(Promise.resolve("value")).toEqual(expect.resolvesTo.stringContaining("value")); // will pass
     * expect(Promise.reject("value")).toEqual(expect.resolvesTo.stringContaining("value")); // will fail
     * expect("value").toEqual(expect.resolvesTo.stringContaining("value")); // will fail
     */
    resolvesTo: AsymmetricMatchers;

    /**
     * Create an asymmetric matcher for a promise rejected value.
     *
     * @example
     * expect(Promise.reject("error")).toEqual(expect.rejectsTo.stringContaining("error")); // will pass
     * expect(Promise.resolve("error")).toEqual(expect.rejectsTo.stringContaining("error")); // will fail
     * expect("error").toEqual(expect.rejectsTo.stringContaining("error")); // will fail
     */
    rejectsTo: AsymmetricMatchers;

    /**
     * Register new custom matchers.
     * @param matchers An object containing the matchers to register, where each key is the matcher name, and its value the implementation function.
     * The function must satisfy: `(actualValue, ...matcherInstantiationArguments) => { pass: true|false, message: () => string }`
     *
     * @example
     * expect.extend({
     *     toBeWithinRange(actual, min, max) {
     *         if (typeof actual !== 'number' || typeof min !== 'number' || typeof max !== 'number')
     *             throw new Error('Invalid usage');
     *         const pass = actual >= min && actual <= max;
     *         return {
     *             pass: pass,
     *             message: () => `expected ${this.utils.printReceived(actual)} ` +
     *                 (pass ? `not to be`: `to be`) + ` within range ${this.utils.printExpected(`${min} .. ${max}`)}`,
     *         };
     *     },
     * });
     *
     * test('some test', () => {
     *   expect(50).toBeWithinRange(0, 100); // will pass
     *   expect(50).toBeWithinRange(100, 200); // will fail
     *   expect(50).toBe(expect.toBeWithinRange(0, 100)); // will pass
     *   expect(50).toBe(expect.not.toBeWithinRange(100, 200)); // will pass
     * });
     */
    extend<M>(matchers: ExpectExtendMatchers<M>): void;

    /**
     * Throw an error if this function is called.
     *
     * @param msg Optional message to display if the test fails
     * @returns never
     *
     * @example
     * ```ts
     * import { expect, test } from "bun:test";
     *
     * test("!!abc!! is not a module", () => {
     *  try {
     *     require("!!abc!!");
     *     expect.unreachable();
     *  } catch(e) {
     *     expect(e.name).not.toBe("UnreachableError");
     *  }
     * });
     * ```
     */
    unreachable(msg?: string | Error): never;

    /**
     * Ensures that an assertion is made
     */
    hasAssertions(): void;

    /**
     * Ensures that a specific number of assertions are made
     */
    assertions(neededAssertions: number): void;
  }

  /**
   * You can extend this interface with declaration merging, in order to add type support for custom matchers.
   * @template T Type of the actual value
   *
   * @example
   * // my_modules.d.ts
   * interface MyCustomMatchers {
   *   toBeWithinRange(floor: number, ceiling: number): any;
   * }
   * declare module "bun:test" {
   *   interface Matchers<T> extends MyCustomMatchers {}
   *   interface AsymmetricMatchers extends MyCustomMatchers {}
   * }
   *
   * @example
   * // my_modules.d.ts (alternatively)
   * declare module "bun:test" {
   *   interface Matchers<T> {
   *     toBeWithinRange(floor: number, ceiling: number): any;
   *   }
   *   interface AsymmetricMatchers {
   *     toBeWithinRange(floor: number, ceiling: number): any;
   *   }
   * }
   */
  export interface Matchers<T = unknown> extends MatchersBuiltin<T> {}

  /**
   * You can extend this interface with declaration merging, in order to add type support for custom asymmetric matchers.
   * @example
   * // my_modules.d.ts
   * interface MyCustomMatchers {
   *   toBeWithinRange(floor: number, ceiling: number): any;
   * }
   * declare module "bun:test" {
   *   interface Matchers<T> extends MyCustomMatchers {}
   *   interface AsymmetricMatchers extends MyCustomMatchers {}
   * }
   *
   * @example
   * // my_modules.d.ts (alternatively)
   * declare module "bun:test" {
   *   interface Matchers<T> {
   *     toBeWithinRange(floor: number, ceiling: number): any;
   *   }
   *   interface AsymmetricMatchers {
   *     toBeWithinRange(floor: number, ceiling: number): any;
   *   }
   * }
   */
  export interface AsymmetricMatchers extends AsymmetricMatchersBuiltin {}

  export interface AsymmetricMatchersBuiltin {
    /**
     * Matches anything that was created with the given constructor.
     * You can use it inside `toEqual` or `toBeCalledWith` instead of a literal value.
     *
     * @example
     *
     * function randocall(fn) {
     *   return fn(Math.floor(Math.random() * 6 + 1));
     * }
     *
     * test('randocall calls its callback with a number', () => {
     *   const mock = jest.fn();
     *   randocall(mock);
     *   expect(mock).toBeCalledWith(expect.any(Number));
     * });
     */
    any(constructor: ((...args: any[]) => any) | { new (...args: any[]): any }): AsymmetricMatcher;
    /**
     * Matches anything but null or undefined. You can use it inside `toEqual` or `toBeCalledWith` instead
     * of a literal value. For example, if you want to check that a mock function is called with a
     * non-null argument:
     *
     * @example
     *
     * test('map calls its argument with a non-null argument', () => {
     *   const mock = jest.fn();
     *   [1].map(x => mock(x));
     *   expect(mock).toBeCalledWith(expect.anything());
     * });
     */
    anything(): AsymmetricMatcher;
    /**
     * Matches any array made up entirely of elements in the provided array.
     * You can use it inside `toEqual` or `toBeCalledWith` instead of a literal value.
     *
     * Optionally, you can provide a type for the elements via a generic.
     */
    arrayContaining<E = any>(arr: readonly E[]): AsymmetricMatcher;
    /**
     * Matches any object that recursively matches the provided keys.
     * This is often handy in conjunction with other asymmetric matchers.
     *
     * Optionally, you can provide a type for the object via a generic.
     * This ensures that the object contains the desired structure.
     */
    objectContaining(obj: object): AsymmetricMatcher;
    /**
     * Matches any received string that contains the exact expected string
     */
    stringContaining(str: string | String): AsymmetricMatcher;
    /**
     * Matches any string that contains the exact provided string
     */
    stringMatching(regex: string | String | RegExp): AsymmetricMatcher;
    /**
     * Useful when comparing floating point numbers in object properties or array item.
     * If you need to compare a number, use `.toBeCloseTo` instead.
     *
     * The optional `numDigits` argument limits the number of digits to check after the decimal point.
     * For the default value 2, the test criterion is `Math.abs(expected - received) < 0.005` (that is, `10 ** -2 / 2`).
     */
    closeTo(num: number, numDigits?: number): AsymmetricMatcher;
  }

  interface AsymmetricMatchersBuiltinNegated {
    /**
     * Create an asymmetric matcher that will fail on a promise resolved value that matches the chained matcher.
     *
     * @example
     * expect(Promise.resolve("value")).toEqual(expect.not.resolvesTo.stringContaining("value")); // will fail
     * expect(Promise.reject("value")).toEqual(expect.not.resolvesTo.stringContaining("value")); // will pass
     * expect("value").toEqual(expect.not.resolvesTo.stringContaining("value")); // will pass
     */
    resolvesTo: ExpectNot;

    /**
     * Create an asymmetric matcher that will fail on a promise rejected value that matches the chained matcher.
     *
     * @example
     * expect(Promise.reject("value")).toEqual(expect.not.rejectsTo.stringContaining("value")); // will fail
     * expect(Promise.resolve("value")).toEqual(expect.not.rejectsTo.stringContaining("value")); // will pass
     * expect("value").toEqual(expect.not.rejectsTo.stringContaining("value")); // will pass
     */
    rejectsTo: ExpectNot;

    /**
     * `expect.not.arrayContaining(array)` matches a received array which
     * does not contain all of the elements in the expected array. That is,
     * the expected array is not a subset of the received array. It is the
     * inverse of `expect.arrayContaining`.
     *
     * Optionally, you can provide a type for the elements via a generic.
     */
    arrayContaining<E = any>(arr: readonly E[]): AsymmetricMatcher;

    /**
     * `expect.not.objectContaining(object)` matches any received object
     * that does not recursively match the expected properties. That is, the
     * expected object is not a subset of the received object. Therefore,
     * it matches a received object which contains properties that are not
     * in the expected object. It is the inverse of `expect.objectContaining`.
     *
     * Optionally, you can provide a type for the object via a generic.
     * This ensures that the object contains the desired structure.
     */
    objectContaining(obj: object): AsymmetricMatcher;

    /**
     * `expect.not.stringContaining(string)` matches the received string
     * that does not contain the exact expected string. It is the inverse of
     * `expect.stringContaining`.
     */
    stringContaining(str: string | String): AsymmetricMatcher;

    /**
     * `expect.not.stringMatching(string | regexp)` matches the received
     * string that does not match the expected regexp. It is the inverse of
     * `expect.stringMatching`.
     */
    stringMatching(str: string | String | RegExp): AsymmetricMatcher;

    /**
     * `expect.not.closeTo` matches a number not close to the provided value.
     * Useful when comparing floating point numbers in object properties or array item.
     * It is the inverse of `expect.closeTo`.
     */
    closeTo(num: number, numDigits?: number): AsymmetricMatcher;
  }

  export interface MatchersBuiltin<T = unknown> {
    /**
     * Negates the result of a subsequent assertion.
     * If you know how to test something, `.not` lets you test its opposite.
     *
     * @example
     * expect(1).not.toBe(0);
     * expect(null).not.toBeNull();
     *
     * @example
     * expect(42).toEqual(42); // will pass
     * expect(42).not.toEqual(42); // will fail
     */
    not: Matchers<unknown>;

    /**
     * Expects the value to be a promise that resolves.
     *
     * @example
     * expect(Promise.resolve(1)).resolves.toBe(1);
     */
    resolves: Matchers<Awaited<T>>;

    /**
     * Expects the value to be a promise that rejects.
     *
     * @example
     * expect(Promise.reject("error")).rejects.toBe("error");
     */
    rejects: Matchers<unknown>;

    /**
     * Assertion which passes.
     *
     * @link https://jest-extended.jestcommunity.dev/docs/matchers/pass
     * @example
     * expect().pass();
     * expect().pass("message is optional");
     * expect().not.pass();
     * expect().not.pass("hi");
     *
     * @param message the message to display if the test fails (optional)
     */
    pass: (message?: string) => void;

    /**
     * Assertion which fails.
     *
     * @link https://jest-extended.jestcommunity.dev/docs/matchers/fail
     * @example
     * expect().fail();
     * expect().fail("message is optional");
     * expect().not.fail();
     * expect().not.fail("hi");
     */
    fail: (message?: string) => void;

    /**
     * Asserts that a value equals what is expected.
     *
     * - For non-primitive values, like objects and arrays,
     * use `toEqual()` instead.
     * - For floating-point numbers, use `toBeCloseTo()` instead.
     *
     * @example
     * expect(100 + 23).toBe(123);
     * expect("d" + "og").toBe("dog");
     * expect([123]).toBe([123]); // fail, use toEqual()
     * expect(3 + 0.14).toBe(3.14); // fail, use toBeCloseTo()
     *
     * // TypeScript errors:
     * expect("hello").toBe(3.14); // typescript error + fail
     * expect("hello").toBe<number>(3.14); // no typescript error, but still fails
     *
     * @param expected the expected value
     */
    toBe(expected: T): void;
    toBe<X = T>(expected: NoInfer<X>): void;

    /**
     * Asserts that a number is odd.
     *
     * @link https://jest-extended.jestcommunity.dev/docs/matchers/number/#tobeodd
     * @example
     * expect(1).toBeOdd();
     * expect(2).not.toBeOdd();
     */
    toBeOdd(): void;

    /**
     * Asserts that a number is even.
     *
     * @link https://jest-extended.jestcommunity.dev/docs/matchers/number/#tobeeven
     * @example
     * expect(2).toBeEven();
     * expect(1).not.toBeEven();
     */
    toBeEven(): void;

    /**
     * Asserts that value is close to the expected by floating point precision.
     *
     * For example, the following fails because arithmetic on decimal (base 10)
     * values often have rounding errors in limited precision binary (base 2) representation.
     *
     * @example
     * expect(0.2 + 0.1).toBe(0.3); // fails
     *
     * Use `toBeCloseTo` to compare floating point numbers for approximate equality.
     *
     * @example
     * expect(0.2 + 0.1).toBeCloseTo(0.3, 5); // passes
     *
     * @param expected the expected value
     * @param numDigits the number of digits to check after the decimal point. Default is `2`
     */
    toBeCloseTo(expected: number, numDigits?: number): void;

    /**
     * Asserts that a value is deeply equal to what is expected.
     *
     * @example
     * expect(100 + 23).toBe(123);
     * expect("d" + "og").toBe("dog");
     * expect([456]).toEqual([456]);
     * expect({ value: 1 }).toEqual({ value: 1 });
     *
     * @param expected the expected value
     */
    toEqual(expected: T): void;
    toEqual<X = T>(expected: NoInfer<X>): void;

    /**
     * Asserts that a value is deeply and strictly equal to
     * what is expected.
     *
     * There are two key differences from `toEqual()`:
     * 1. It checks that the class is the same.
     * 2. It checks that `undefined` values match as well.
     *
     * @example
     * class Dog {
     *   type = "dog";
     * }
     * const actual = new Dog();
     * expect(actual).toStrictEqual(new Dog());
     * expect(actual).toStrictEqual({ type: "dog" }); // fail
     *
     * @example
     * const actual = { value: 1, name: undefined };
     * expect(actual).toEqual({ value: 1 });
     * expect(actual).toStrictEqual({ value: 1 }); // fail
     *
     * @param expected the expected value
     */
    toStrictEqual(expected: T): void;
    toStrictEqual<X = T>(expected: NoInfer<X>): void;

    /**
     * Asserts that the value is deep equal to an element in the expected array.
     *
     * The value must be an array or iterable, which includes strings.
     *
     * @example
     * expect(1).toBeOneOf([1,2,3]);
     * expect("foo").toBeOneOf(["foo", "bar"]);
     * expect(true).toBeOneOf(new Set([true]));
     *
     * @param expected the expected value
     */
    toBeOneOf(expected: Iterable<T>): void;
    toBeOneOf<X = T>(expected: NoInfer<Iterable<X>>): void;

    /**
     * Asserts that a value contains what is expected.
     *
     * The value must be an array or iterable, which
     * includes strings.
     *
     * @example
     * expect([1, 2, 3]).toContain(1);
     * expect(new Set([true])).toContain(true);
     * expect("hello").toContain("o");
     *
     * @param expected the expected value
     */
    toContain(expected: T extends Iterable<infer U> ? U : T): void;
    toContain<X = T>(expected: NoInfer<X extends Iterable<infer U> ? U : X>): void;

    /**
     * Asserts that an `object` contains a key.
     *
     * The value must be an object
     *
     * @example
     * expect({ a: 'foo', b: 'bar', c: 'baz' }).toContainKey('a');
     * expect({ a: 'foo', b: 'bar', c: 'baz' }).toContainKey('b');
     * expect({ a: 'foo', b: 'bar', c: 'baz' }).toContainKey('c');
     * expect({ a: 'foo', b: 'bar', c: 'baz' }).not.toContainKey('d');
     *
     * @param expected the expected value
     */
    toContainKey(expected: __internal.IfNeverThenElse<keyof T, PropertyKey>): void;
    toContainKey<X = T>(expected: __internal.IfNeverThenElse<NoInfer<keyof X>, PropertyKey>): void;

    /**
     * Asserts that an `object` contains all the provided keys.
     *
     * The value must be an object
     *
     * @example
     * expect({ a: 'hello', b: 'world' }).toContainAllKeys(['a','b']);
     * expect({ a: 'hello', b: 'world' }).toContainAllKeys(['b','a']);
     * expect({ 1: 'hello', b: 'world' }).toContainAllKeys([1,'b']);
     * expect({ a: 'hello', b: 'world' }).not.toContainAllKeys(['c']);
     * expect({ a: 'hello', b: 'world' }).not.toContainAllKeys(['a']);
     *
     * @param expected the expected value
     */
    toContainAllKeys(expected: Array<__internal.IfNeverThenElse<keyof T, PropertyKey>>): void;
    toContainAllKeys<X = T>(expected: Array<__internal.IfNeverThenElse<NoInfer<keyof X>, PropertyKey>>): void;

    /**
     * Asserts that an `object` contains at least one of the provided keys.
     * Asserts that an `object` contains all the provided keys.
     *
     * The value must be an object
     *
     * @example
     * expect({ a: 'hello', b: 'world' }).toContainAnyKeys(['a']);
     * expect({ a: 'hello', b: 'world' }).toContainAnyKeys(['b']);
     * expect({ a: 'hello', b: 'world' }).toContainAnyKeys(['b', 'c']);
     * expect({ a: 'hello', b: 'world' }).not.toContainAnyKeys(['c']);
     *
     * @param expected the expected value
     */
    toContainAnyKeys(expected: Array<__internal.IfNeverThenElse<keyof T, PropertyKey>>): void;
    toContainAnyKeys<X = T>(expected: Array<__internal.IfNeverThenElse<NoInfer<keyof X>, PropertyKey>>): void;

    /**
     * Asserts that an `object` contain the provided value.
     *
     * This method is deep and will look through child properties to find the
     * expected value.
     *
     * The input value must be an object.
     *
     * @example
     * const shallow = { hello: "world" };
     * const deep = { message: shallow };
     * const deepArray = { message: [shallow] };
     * const o = { a: "foo", b: [1, "hello", true], c: "baz" };

     * expect(shallow).toContainValue("world");
     * expect({ foo: false }).toContainValue(false);
     * expect(deep).toContainValue({ hello: "world" });
     * expect(deepArray).toContainValue([{ hello: "world" }]);

     * expect(o).toContainValue("foo", "barr");
     * expect(o).toContainValue([1, "hello", true]);
     * expect(o).not.toContainValue("qux");

     // NOT
     * expect(shallow).not.toContainValue("foo");
     * expect(deep).not.toContainValue({ foo: "bar" });
     * expect(deepArray).not.toContainValue([{ foo: "bar" }]);
     *
     * @param expected the expected value
     */
    // Contributor note: In theory we could type this better but it would be a
    // slow union to compute...
    toContainValue(expected: unknown): void;

    /**
     * Asserts that an `object` contain the provided value.
     *
     * This is the same as {@link toContainValue}, but accepts an array of
     * values instead.
     *
     * The value must be an object
     *
     * @example
     * const o = { a: 'foo', b: 'bar', c: 'baz' };
     * expect(o).toContainValues(['foo']);
     * expect(o).toContainValues(['baz', 'bar']);
     * expect(o).not.toContainValues(['qux', 'foo']);
     * @param expected the expected value
     */
    toContainValues(expected: Array<unknown>): void;

    /**
     * Asserts that an `object` contain all the provided values.
     *
     * The value must be an object
     *
     * @example
     * const o = { a: 'foo', b: 'bar', c: 'baz' };
     * expect(o).toContainAllValues(['foo', 'bar', 'baz']);
     * expect(o).toContainAllValues(['baz', 'bar', 'foo']);
     * expect(o).not.toContainAllValues(['bar', 'foo']);
     * @param expected the expected value
     */
    toContainAllValues(expected: Array<unknown>): void;

    /**
     * Asserts that an `object` contain any provided value.
     *
     * The value must be an object
     *
     * @example
     * const o = { a: 'foo', b: 'bar', c: 'baz' };
     * expect(o).toContainAnyValues(['qux', 'foo']);
     * expect(o).toContainAnyValues(['qux', 'bar']);
     * expect(o).toContainAnyValues(['qux', 'baz']);
     * expect(o).not.toContainAnyValues(['qux']);
     * @param expected the expected value
     */
    toContainAnyValues(expected: Array<unknown>): void;

    /**
     * Asserts that an `object` contains all the provided keys.
     *
     * @example
     * expect({ a: 'foo', b: 'bar', c: 'baz' }).toContainKeys(['a', 'b']);
     * expect({ a: 'foo', b: 'bar', c: 'baz' }).toContainKeys(['a', 'b', 'c']);
     * expect({ a: 'foo', b: 'bar', c: 'baz' }).not.toContainKeys(['a', 'b', 'e']);
     *
     * @param expected the expected value
     */
    toContainKeys(expected: Array<__internal.IfNeverThenElse<keyof T, PropertyKey>>): void;
    toContainKeys<X = T>(expected: Array<__internal.IfNeverThenElse<NoInfer<keyof X>, PropertyKey>>): void;

    /**
     * Asserts that a value contains and equals what is expected.
     *
     * This matcher will perform a deep equality check for members
     * of arrays, rather than checking for object identity.
     *
     * @example
     * expect([{ a: 1 }]).toContainEqual({ a: 1 });
     * expect([{ a: 1 }]).not.toContainEqual({ a: 2 });
     *
     * @param expected the expected value
     */
    toContainEqual(expected: T extends Iterable<infer U> ? U : T): void;
    toContainEqual<X = T>(expected: NoInfer<X extends Iterable<infer U> ? U : X>): void;

    /**
     * Asserts that a value has a `.length` property
     * that is equal to the expected length.
     *
     * @example
     * expect([]).toHaveLength(0);
     * expect("hello").toHaveLength(4);
     *
     * @param length the expected length
     */
    toHaveLength(length: number): void;

    /**
     * Asserts that a value has a property with the
     * expected name, and value if provided.
     *
     * @example
     * expect(new Set()).toHaveProperty("size");
     * expect(new Uint8Array()).toHaveProperty("byteLength", 0);
     * expect({ kitchen: { area: 20 }}).toHaveProperty("kitchen.area", 20);
     * expect({ kitchen: { area: 20 }}).toHaveProperty(["kitchen", "area"], 20);
     *
     * @param keyPath the expected property name or path, or an index
     * @param value the expected property value, if provided
     */
    toHaveProperty(keyPath: string | number | Array<string | number>, value?: unknown): void;

    /**
     * Asserts that a value is "truthy".
     *
     * To assert that a value equals `true`, use `toBe(true)` instead.
     *
     * @link https://developer.mozilla.org/en-US/docs/Glossary/Truthy
     * @example
     * expect(true).toBeTruthy();
     * expect(1).toBeTruthy();
     * expect({}).toBeTruthy();
     */
    toBeTruthy(): void;

    /**
     * Asserts that a value is "falsy".
     *
     * To assert that a value equals `false`, use `toBe(false)` instead.
     *
     * @link https://developer.mozilla.org/en-US/docs/Glossary/Falsy
     * @example
     * expect(true).toBeTruthy();
     * expect(1).toBeTruthy();
     * expect({}).toBeTruthy();
     */
    toBeFalsy(): void;

    /**
     * Asserts that a value is defined. (e.g. is not `undefined`)
     *
     * @example
     * expect(true).toBeDefined();
     * expect(undefined).toBeDefined(); // fail
     */
    toBeDefined(): void;

    /**
     * Asserts that the expected value is an instance of value
     *
     * @example
     * expect([]).toBeInstanceOf(Array);
     * expect(null).toBeInstanceOf(Array); // fail
     */
    toBeInstanceOf(value: unknown): void;

    /**
     * Asserts that a value is `undefined`.
     *
     * @example
     * expect(undefined).toBeUndefined();
     * expect(null).toBeUndefined(); // fail
     */
    toBeUndefined(): void;

    /**
     * Asserts that a value is `null`.
     *
     * @example
     * expect(null).toBeNull();
     * expect(undefined).toBeNull(); // fail
     */
    toBeNull(): void;

    /**
     * Asserts that a value is `NaN`.
     *
     * Same as using `Number.isNaN()`.
     *
     * @example
     * expect(NaN).toBeNaN();
     * expect(Infinity).toBeNaN(); // fail
     * expect("notanumber").toBeNaN(); // fail
     */
    toBeNaN(): void;

    /**
     * Asserts that a value is a `number` and is greater than the expected value.
     *
     * @example
     * expect(1).toBeGreaterThan(0);
     * expect(3.14).toBeGreaterThan(3);
     * expect(9).toBeGreaterThan(9); // fail
     *
     * @param expected the expected number
     */
    toBeGreaterThan(expected: number | bigint): void;

    /**
     * Asserts that a value is a `number` and is greater than or equal to the expected value.
     *
     * @example
     * expect(1).toBeGreaterThanOrEqual(0);
     * expect(3.14).toBeGreaterThanOrEqual(3);
     * expect(9).toBeGreaterThanOrEqual(9);
     *
     * @param expected the expected number
     */
    toBeGreaterThanOrEqual(expected: number | bigint): void;

    /**
     * Asserts that a value is a `number` and is less than the expected value.
     *
     * @example
     * expect(-1).toBeLessThan(0);
     * expect(3).toBeLessThan(3.14);
     * expect(9).toBeLessThan(9); // fail
     *
     * @param expected the expected number
     */
    toBeLessThan(expected: number | bigint): void;

    /**
     * Asserts that a value is a `number` and is less than or equal to the expected value.
     *
     * @example
     * expect(-1).toBeLessThanOrEqual(0);
     * expect(3).toBeLessThanOrEqual(3.14);
     * expect(9).toBeLessThanOrEqual(9);
     *
     * @param expected the expected number
     */
    toBeLessThanOrEqual(expected: number | bigint): void;

    /**
     * Asserts that a function throws an error.
     *
     * - If expected is a `string` or `RegExp`, it will check the `message` property.
     * - If expected is an `Error` object, it will check the `name` and `message` properties.
     * - If expected is an `Error` constructor, it will check the class of the `Error`.
     * - If expected is not provided, it will check if anything has thrown.
     *
     * @example
     * function fail() {
     *   throw new Error("Oops!");
     * }
     * expect(fail).toThrow("Oops!");
     * expect(fail).toThrow(/oops/i);
     * expect(fail).toThrow(Error);
     * expect(fail).toThrow();
     *
     * @param expected the expected error, error message, or error pattern
     */
    toThrow(expected?: unknown): void;

    /**
     * Asserts that a function throws an error.
     *
     * - If expected is a `string` or `RegExp`, it will check the `message` property.
     * - If expected is an `Error` object, it will check the `name` and `message` properties.
     * - If expected is an `Error` constructor, it will check the class of the `Error`.
     * - If expected is not provided, it will check if anything has thrown.
     *
     * @example
     * function fail() {
     *   throw new Error("Oops!");
     * }
     * expect(fail).toThrowError("Oops!");
     * expect(fail).toThrowError(/oops/i);
     * expect(fail).toThrowError(Error);
     * expect(fail).toThrowError();
     *
     * @param expected the expected error, error message, or error pattern
     * @alias toThrow
     */
    toThrowError(expected?: unknown): void;

    /**
     * Asserts that a value matches a regular expression or includes a substring.
     *
     * @example
     * expect("dog").toMatch(/dog/);
     * expect("dog").toMatch("og");
     *
     * @param expected the expected substring or pattern.
     */
    toMatch(expected: string | RegExp): void;

    /**
     * Asserts that a value matches the most recent snapshot.
     *
     * @example
     * expect([1, 2, 3]).toMatchSnapshot('hint message');
     * @param hint Hint used to identify the snapshot in the snapshot file.
     */
    toMatchSnapshot(hint?: string): void;

    /**
     * Asserts that a value matches the most recent snapshot.
     *
     * @example
     * expect([1, 2, 3]).toMatchSnapshot();
     * expect({ a: 1, b: 2 }).toMatchSnapshot({ a: 1 });
     * expect({ c: new Date() }).toMatchSnapshot({ c: expect.any(Date) });
     *
     * @param propertyMatchers Object containing properties to match against the value.
     * @param hint Hint used to identify the snapshot in the snapshot file.
     */
    toMatchSnapshot(propertyMatchers?: object, hint?: string): void;

    /**
     * Asserts that a value matches the most recent inline snapshot.
     *
     * @example
     * expect("Hello").toMatchInlineSnapshot();
     * expect("Hello").toMatchInlineSnapshot(`"Hello"`);
     *
     * @param value The latest automatically-updated snapshot value.
     */
    toMatchInlineSnapshot(value?: string): void;

    /**
     * Asserts that a value matches the most recent inline snapshot.
     *
     * @example
     * expect({ c: new Date() }).toMatchInlineSnapshot({ c: expect.any(Date) });
     * expect({ c: new Date() }).toMatchInlineSnapshot({ c: expect.any(Date) }, `
     * {
     *   "v": Any<Date>,
     * }
     * `);
     *
     * @param propertyMatchers Object containing properties to match against the value.
     * @param value The latest automatically-updated snapshot value.
     */
    toMatchInlineSnapshot(propertyMatchers?: object, value?: string): void;

    /**
     * Asserts that a function throws an error matching the most recent snapshot.
     *
     * @example
     * function fail() {
     *   throw new Error("Oops!");
     * }
     * expect(fail).toThrowErrorMatchingSnapshot();
     * expect(fail).toThrowErrorMatchingSnapshot("This one should say Oops!");
     *
     * @param value The latest automatically-updated snapshot value.
     */
    toThrowErrorMatchingSnapshot(hint?: string): void;

    /**
     * Asserts that a function throws an error matching the most recent snapshot.
     *
     * @example
     * function fail() {
     *   throw new Error("Oops!");
     * }
     * expect(fail).toThrowErrorMatchingInlineSnapshot();
     * expect(fail).toThrowErrorMatchingInlineSnapshot(`"Oops!"`);
     *
     * @param value The latest automatically-updated snapshot value.
     */
    toThrowErrorMatchingInlineSnapshot(value?: string): void;

    /**
     * Asserts that an object matches a subset of properties.
     *
     * @example
     * expect({ a: 1, b: 2 }).toMatchObject({ b: 2 });
     * expect({ c: new Date(), d: 2 }).toMatchObject({ d: 2 });
     *
     * @param subset Subset of properties to match with.
     */
    toMatchObject(subset: object): void;

    /**
     * Asserts that a value is empty.
     *
     * @example
     * expect("").toBeEmpty();
     * expect([]).toBeEmpty();
     * expect({}).toBeEmpty();
     * expect(new Set()).toBeEmpty();
     */
    toBeEmpty(): void;

    /**
     * Asserts that a value is an empty `object`.
     *
     * @example
     * expect({}).toBeEmptyObject();
     * expect({ a: 'hello' }).not.toBeEmptyObject();
     */
    toBeEmptyObject(): void;

    /**
     * Asserts that a value is `null` or `undefined`.
     *
     * @example
     * expect(null).toBeNil();
     * expect(undefined).toBeNil();
     */
    toBeNil(): void;

    /**
     * Asserts that a value is a `array`.
     *
     * @link https://jest-extended.jestcommunity.dev/docs/matchers/array/#tobearray
     * @example
     * expect([1]).toBeArray();
     * expect(new Array(1)).toBeArray();
     * expect({}).not.toBeArray();
     */
    toBeArray(): void;

    /**
     * Asserts that a value is a `array` of a certain length.
     *
     * @link https://jest-extended.jestcommunity.dev/docs/matchers/array/#tobearrayofsize
     * @example
     * expect([]).toBeArrayOfSize(0);
     * expect([1]).toBeArrayOfSize(1);
     * expect(new Array(1)).toBeArrayOfSize(1);
     * expect({}).not.toBeArrayOfSize(0);
     */
    toBeArrayOfSize(size: number): void;

    /**
     * Asserts that a value is a `boolean`.
     *
     * @example
     * expect(true).toBeBoolean();
     * expect(false).toBeBoolean();
     * expect(null).not.toBeBoolean();
     * expect(0).not.toBeBoolean();
     */
    toBeBoolean(): void;

    /**
     * Asserts that a value is `true`.
     *
     * @example
     * expect(true).toBeTrue();
     * expect(false).not.toBeTrue();
     * expect(1).not.toBeTrue();
     */
    toBeTrue(): void;

    /**
     * Asserts that a value matches a specific type.
     *
     * @link https://vitest.dev/api/expect.html#tobetypeof
     * @example
     * expect(1).toBeTypeOf("number");
     * expect("hello").toBeTypeOf("string");
     * expect([]).not.toBeTypeOf("boolean");
     */
    toBeTypeOf(type: "bigint" | "boolean" | "function" | "number" | "object" | "string" | "symbol" | "undefined"): void;

    /**
     * Asserts that a value is `false`.
     *
     * @example
     * expect(false).toBeFalse();
     * expect(true).not.toBeFalse();
     * expect(0).not.toBeFalse();
     */
    toBeFalse(): void;

    /**
     * Asserts that a value is a `number`.
     *
     * @example
     * expect(1).toBeNumber();
     * expect(3.14).toBeNumber();
     * expect(NaN).toBeNumber();
     * expect(BigInt(1)).not.toBeNumber();
     */
    toBeNumber(): void;

    /**
     * Asserts that a value is a `number`, and is an integer.
     *
     * @example
     * expect(1).toBeInteger();
     * expect(3.14).not.toBeInteger();
     * expect(NaN).not.toBeInteger();
     */
    toBeInteger(): void;

    /**
     * Asserts that a value is an `object`.
     *
     * @example
     * expect({}).toBeObject();
     * expect("notAnObject").not.toBeObject();
     * expect(NaN).not.toBeObject();
     */
    toBeObject(): void;

    /**
     * Asserts that a value is a `number`, and is not `NaN` or `Infinity`.
     *
     * @example
     * expect(1).toBeFinite();
     * expect(3.14).toBeFinite();
     * expect(NaN).not.toBeFinite();
     * expect(Infinity).not.toBeFinite();
     */
    toBeFinite(): void;

    /**
     * Asserts that a value is a positive `number`.
     *
     * @example
     * expect(1).toBePositive();
     * expect(-3.14).not.toBePositive();
     * expect(NaN).not.toBePositive();
     */
    toBePositive(): void;

    /**
     * Asserts that a value is a negative `number`.
     *
     * @example
     * expect(-3.14).toBeNegative();
     * expect(1).not.toBeNegative();
     * expect(NaN).not.toBeNegative();
     */
    toBeNegative(): void;

    /**
     * Asserts that a value is a number between a start and end value.
     *
     * @param start the start number (inclusive)
     * @param end the end number (exclusive)
     */
    toBeWithin(start: number, end: number): void;

    /**
     * Asserts that a value is equal to the expected string, ignoring any whitespace.
     *
     * @example
     * expect(" foo ").toEqualIgnoringWhitespace("foo");
     * expect("bar").toEqualIgnoringWhitespace(" bar ");
     *
     * @param expected the expected string
     */
    toEqualIgnoringWhitespace(expected: string): void;

    /**
     * Asserts that a value is a `symbol`.
     *
     * @example
     * expect(Symbol("foo")).toBeSymbol();
     * expect("foo").not.toBeSymbol();
     */
    toBeSymbol(): void;

    /**
     * Asserts that a value is a `function`.
     *
     * @example
     * expect(() => {}).toBeFunction();
     */
    toBeFunction(): void;

    /**
     * Asserts that a value is a `Date` object.
     *
     * To check if a date is valid, use `toBeValidDate()` instead.
     *
     * @example
     * expect(new Date()).toBeDate();
     * expect(new Date(null)).toBeDate();
     * expect("2020-03-01").not.toBeDate();
     */
    toBeDate(): void;

    /**
     * Asserts that a value is a valid `Date` object.
     *
     * @example
     * expect(new Date()).toBeValidDate();
     * expect(new Date(null)).not.toBeValidDate();
     * expect("2020-03-01").not.toBeValidDate();
     */
    toBeValidDate(): void;

    /**
     * Asserts that a value is a `string`.
     *
     * @example
     * expect("foo").toBeString();
     * expect(new String("bar")).toBeString();
     * expect(123).not.toBeString();
     */
    toBeString(): void;

    /**
     * Asserts that a value includes a `string`.
     *
     * For non-string values, use `toContain()` instead.
     *
     * @param expected the expected substring
     */
    toInclude(expected: string): void;

    /**
     * Asserts that a value includes a `string` {times} times.
     * @param expected the expected substring
     * @param times the number of times the substring should occur
     */
    toIncludeRepeated(expected: string, times: number): void;

    /**
     * Checks whether a value satisfies a custom condition.
     * @param {Function} predicate - The custom condition to be satisfied. It should be a function that takes a value as an argument (in this case the value from expect) and returns a boolean.
     * @example
     * expect(1).toSatisfy((val) => val > 0);
     * expect("foo").toSatisfy((val) => val === "foo");
     * expect("bar").not.toSatisfy((val) => val === "bun");
     * @link https://vitest.dev/api/expect.html#tosatisfy
     * @link https://jest-extended.jestcommunity.dev/docs/matchers/toSatisfy
     */
    toSatisfy(predicate: (value: T) => boolean): void;

    /**
     * Asserts that a value starts with a `string`.
     *
     * @param expected the string to start with
     */
    toStartWith(expected: string): void;

    /**
     * Asserts that a value ends with a `string`.
     *
     * @param expected the string to end with
     */
    toEndWith(expected: string): void;

    /**
     * Ensures that a mock function has returned successfully at least once.
     *
     * A promise that is unfulfilled will be considered a failure. If the
     * function threw an error, it will be considered a failure.
     */
    toHaveReturned(): void;

    /**
     * Ensures that a mock function has returned successfully at `times` times.
     *
     * A promise that is unfulfilled will be considered a failure. If the
     * function threw an error, it will be considered a failure.
     */
    toHaveReturnedTimes(times: number): void;

    /**
     * Ensures that a mock function has returned a specific value.
     * This matcher uses deep equality, like toEqual(), and supports asymmetric matchers.
     */
    toHaveReturnedWith(expected: unknown): void;

    /**
     * Ensures that a mock function has returned a specific value on its last invocation.
     * This matcher uses deep equality, like toEqual(), and supports asymmetric matchers.
     */
    toHaveLastReturnedWith(expected: unknown): void;

    /**
     * Ensures that a mock function has returned a specific value on the nth invocation.
     * This matcher uses deep equality, like toEqual(), and supports asymmetric matchers.
     * @param n The 1-based index of the function call
     * @param expected The expected return value
     */
    toHaveNthReturnedWith(n: number, expected: unknown): void;

    /**
     * Ensures that a mock function is called.
     */
    toHaveBeenCalled(): void;

    /**
     * Ensures that a mock function is called an exact number of times.
     * @alias toHaveBeenCalled
     */
    toBeCalled(): void;

    /**
     * Ensures that a mock function is called an exact number of times.
     */
    toHaveBeenCalledTimes(expected: number): void;

    /**
     * Ensure that a mock function is called with specific arguments.
     * @alias toHaveBeenCalledTimes
     */
    toBeCalledTimes(expected: number): void;

    /**
     * Ensure that a mock function is called with specific arguments.
     */
    toHaveBeenCalledWith(...expected: unknown[]): void;

    /**
     * Ensure that a mock function is called with specific arguments.
     * @alias toHaveBeenCalledWith
     */
    toBeCalledWith(...expected: unknown[]): void;

    /**
     * Ensure that a mock function is called with specific arguments for the last call.
     */
    toHaveBeenLastCalledWith(...expected: unknown[]): void;

    /**
     * Ensure that a mock function is called with specific arguments for the nth call.
     * @alias toHaveBeenCalledWith
     */
    lastCalledWith(...expected: unknown[]): void;

    /**
     * Ensure that a mock function is called with specific arguments for the nth call.
     */
    toHaveBeenNthCalledWith(n: number, ...expected: unknown[]): void;

    /**
     * Ensure that a mock function is called with specific arguments for the nth call.
     * @alias toHaveBeenCalledWith
     */
    nthCalledWith(n: number, ...expected: unknown[]): void;
  }

  /**
   * Object representing an asymmetric matcher obtained by an static call to expect like `expect.anything()`, `expect.stringContaining("...")`, etc.
   */
  // Defined as an alias of `any` so that it does not trigger any type mismatch
  export type AsymmetricMatcher = any;

  export interface MatcherResult {
    pass: boolean;
    message?: string | (() => string);
  }

  export type CustomMatcher<E, P extends any[]> = (
    this: MatcherContext,
    expected: E,
    ...matcherArguments: P
  ) => MatcherResult | Promise<MatcherResult>;

  /** All non-builtin matchers and asymmetric matchers that have been type-registered through declaration merging */
  export type CustomMatchersDetected = Omit<Matchers<unknown>, keyof MatchersBuiltin<unknown>> &
    Omit<AsymmetricMatchers, keyof AsymmetricMatchersBuiltin>;

  /**
   * If the types has been defined through declaration merging, enforce it.
   * Otherwise enforce the generic custom matcher signature.
   */
  export type ExpectExtendMatchers<M> = {
    [k in keyof M]: k extends keyof CustomMatchersDetected
      ? CustomMatcher<unknown, Parameters<CustomMatchersDetected[k]>>
      : CustomMatcher<unknown, any[]>;
  };

  /** Custom equality tester */
  export type Tester = (this: TesterContext, a: any, b: any, customTesters: Tester[]) => boolean | undefined;

  export type EqualsFunction = (
    a: unknown,
    b: unknown,
    //customTesters?: Array<Tester>,
    //strictCheck?: boolean,
  ) => boolean;

  export interface TesterContext {
    equals: EqualsFunction;
  }

  interface MatcherState {
    //assertionCalls: number;
    //currentConcurrentTestName?: () => string | undefined;
    //currentTestName?: string;
    //error?: Error;
    //expand: boolean;
    //expectedAssertionsNumber: number | null;
    //expectedAssertionsNumberError?: Error;
    //isExpectingAssertions: boolean;
    //isExpectingAssertionsError?: Error;
    isNot: boolean;
    //numPassingAsserts: number;
    promise: string;
    //suppressedErrors: Array<Error>;
    //testPath?: string;
  }

  type MatcherHintColor = (arg: string) => string; // subset of Chalk type

  interface MatcherUtils {
    //customTesters: Array<Tester>;
    //dontThrow(): void; // (internally used by jest snapshot)
    equals: EqualsFunction;
    utils: Readonly<{
      stringify(value: unknown): string;
      printReceived(value: unknown): string;
      printExpected(value: unknown): string;
      matcherHint(
        matcherName: string,
        received?: unknown,
        expected?: unknown,
        options?: {
          isNot?: boolean;
          promise?: string;
          isDirectExpectCall?: boolean; // (internal)
          comment?: string;
          expectedColor?: MatcherHintColor;
          receivedColor?: MatcherHintColor;
          secondArgument?: string;
          secondArgumentColor?: MatcherHintColor;
        },
      ): string;
      //iterableEquality: Tester;
      //subsetEquality: Tester;
      // ...
    }>;
  }

  type MatcherContext = MatcherUtils & MatcherState;

  namespace JestMock {
    /**
     * Copyright (c) Meta Platforms, Inc. and affiliates.
     *
     * This source code is licensed under the MIT license found in the
     * LICENSE file in the root directory of this source tree.
     */
    export interface ClassLike {
      new (...args: any): any;
    }

    export type ConstructorLikeKeys<T> = keyof {
      [K in keyof T as Required<T>[K] extends ClassLike ? K : never]: T[K];
    };

    // export const fn: <T extends FunctionLike = UnknownFunction>(
    //   implementation?: T | undefined,
    // ) => Mock<T>;

    export type FunctionLike = (...args: any) => any;

    export type MethodLikeKeys<T> = keyof {
      [K in keyof T as Required<T>[K] extends FunctionLike ? K : never]: T[K];
    };

    export interface Mock<T extends (...args: any[]) => any> extends MockInstance<T> {
      (...args: Parameters<T>): ReturnType<T>;
    }

    /**
     * All what the internal typings need is to be sure that we have any-function.
     * `FunctionLike` type ensures that and helps to constrain the type as well.
     * The default of `UnknownFunction` makes sure that `any`s do not leak to the
     * user side. For instance, calling `fn()` without implementation will return
     * a mock of `(...args: Array<unknown>) => unknown` type. If implementation
     * is provided, its typings are inferred correctly.
     */
    // export interface Mock<T extends FunctionLike = UnknownFunction>
    //   extends Function,
    //     MockInstance<T> {
    //   new (...args: Parameters<T>): ReturnType<T>;
    //   (...args: Parameters<T>): ReturnType<T>;
    // }

    // export type Mocked<T> = T extends ClassLike
    //   ? MockedClass<T>
    //   : T extends FunctionLike
    //   ? MockedFunction<T>
    //   : T extends object
    //   ? MockedObject<T>
    //   : T;

    // export const mocked: {
    //   <T extends object>(
    //     source: T,
    //     options?: {
    //       shallow: false;
    //     },
    //   ): Mocked<T>;
    //   <T_1 extends object>(
    //     source: T_1,
    //     options: {
    //       shallow: true;
    //     },
    //   ): MockedShallow<T_1>;
    // };

    // export type MockedClass<T extends ClassLike> = MockInstance<
    //   (...args: ConstructorParameters<T>) => Mocked<InstanceType<T>>
    // > &
    //   MockedObject<T>;

    // export type MockedFunction<T extends FunctionLike> = MockInstance<T> &
    //   MockedObject<T>;

    // type MockedFunctionShallow<T extends FunctionLike> = MockInstance<T> & T;

    // export type MockedObject<T extends object> = {
    //   [K in keyof T]: T[K] extends ClassLike
    //     ? MockedClass<T[K]>
    //     : T[K] extends FunctionLike
    //     ? MockedFunction<T[K]>
    //     : T[K] extends object
    //     ? MockedObject<T[K]>
    //     : T[K];
    // } & T;

    // type MockedObjectShallow<T extends object> = {
    //   [K in keyof T]: T[K] extends ClassLike
    //     ? MockedClass<T[K]>
    //     : T[K] extends FunctionLike
    //     ? MockedFunctionShallow<T[K]>
    //     : T[K];
    // } & T;

    // export type MockedShallow<T> = T extends ClassLike
    //   ? MockedClass<T>
    //   : T extends FunctionLike
    //   ? MockedFunctionShallow<T>
    //   : T extends object
    //   ? MockedObjectShallow<T>
    //   : T;

    // export type MockFunctionMetadata<
    //   T = unknown,
    //   MetadataType = MockMetadataType,
    // > = MockMetadata<T, MetadataType>;

    // export type MockFunctionMetadataType = MockMetadataType;

    type MockFunctionResult<T extends FunctionLike = UnknownFunction> =
      | MockFunctionResultIncomplete
      | MockFunctionResultReturn<T>
      | MockFunctionResultThrow;

    interface MockFunctionResultIncomplete {
      type: "incomplete";
      /**
       * Result of a single call to a mock function that has not yet completed.
       * This occurs if you test the result from within the mock function itself,
       * or from within a function that was called by the mock.
       */
      value: undefined;
    }

    interface MockFunctionResultReturn<T extends FunctionLike = UnknownFunction> {
      type: "return";
      /**
       * Result of a single call to a mock function that returned.
       */
      value: ReturnType<T>;
    }

    interface MockFunctionResultThrow {
      type: "throw";
      /**
       * Result of a single call to a mock function that threw.
       */
      value: unknown;
    }

    interface MockFunctionState<T extends FunctionLike = FunctionLike> {
      /**
       * List of the call arguments of all calls that have been made to the mock.
       */
      calls: Array<Parameters<T>>;
      /**
       * List of all the object instances that have been instantiated from the mock.
       */
      instances: Array<ReturnType<T>>;
      /**
       * List of all the function contexts that have been applied to calls to the mock.
       */
      contexts: Array<ThisParameterType<T>>;
      /**
       * List of the call order indexes of the mock. Jest is indexing the order of
       * invocations of all mocks in a test file. The index is starting with `1`.
       */
      invocationCallOrder: number[];
      /**
       * List of the call arguments of the last call that was made to the mock.
       * If the function was not called, it will return `undefined`.
       */
      lastCall?: Parameters<T>;
      /**
       * List of the results of all calls that have been made to the mock.
       */
      results: Array<MockFunctionResult<T>>;
    }

    export interface MockInstance<T extends FunctionLike = UnknownFunction> {
      _isMockFunction: true;
      _protoImpl: Function;
      getMockImplementation(): T | undefined;
      getMockName(): string;
      mock: MockFunctionState<T>;
      mockClear(): this;
      mockReset(): this;
      mockRestore(): void;
      mockImplementation(fn: T): this;
      mockImplementationOnce(fn: T): this;
      withImplementation(fn: T, callback: () => Promise<unknown>): Promise<void>;
      withImplementation(fn: T, callback: () => void): void;
      mockName(name: string): this;
      mockReturnThis(): this;
      mockReturnValue(value: ReturnType<T>): this;
      mockReturnValueOnce(value: ReturnType<T>): this;
      mockResolvedValue(value: ResolveType<T>): this;
      mockResolvedValueOnce(value: ResolveType<T>): this;
      mockRejectedValue(value: RejectType<T>): this;
      mockRejectedValueOnce(value: RejectType<T>): this;
      [Symbol.dispose](): void;
    }

    // export type MockMetadata<T, MetadataType = MockMetadataType> = {
    //   ref?: number;
    //   members?: Record<string, MockMetadata<T>>;
    //   mockImpl?: T;
    //   name?: string;
    //   refID?: number;
    //   type?: MetadataType;
    //   value?: T;
    //   length?: number;
    // };

    // export type MockMetadataType =
    //   | "object"
    //   | "array"
    //   | "regexp"
    //   | "function"
    //   | "constant"
    //   | "collection"
    //   | "null"
    //   | "undefined";

    // export class ModuleMocker {
    //   private readonly _environmentGlobal;
    //   private _mockState;
    //   private _mockConfigRegistry;
    //   private _spyState;
    //   private _invocationCallCounter;
    //   /**
    //    * @see README.md
    //    * @param global Global object of the test environment, used to create
    //    * mocks
    //    */
    //   constructor(global: typeof globalThis);
    //   private _getSlots;
    //   private _ensureMockConfig;
    //   private _ensureMockState;
    //   private _defaultMockConfig;
    //   private _defaultMockState;
    //   private _makeComponent;
    //   private _createMockFunction;
    //   private _generateMock;
    //   /**
    //    * Check whether the given property of an object has been already replaced.
    //    */
    //   private _findReplacedProperty;
    //   /**
    //    * @see README.md
    //    * @param metadata Metadata for the mock in the schema returned by the
    //    * getMetadata method of this module.
    //    */
    //   generateFromMetadata<T>(metadata: MockMetadata<T>): Mocked<T>;
    //   /**
    //    * @see README.md
    //    * @param component The component for which to retrieve metadata.
    //    */
    //   getMetadata<T = unknown>(
    //     component: T,
    //     _refs?: Map<T, number>,
    //   ): MockMetadata<T> | null;
    //   isMockFunction<T extends FunctionLike = UnknownFunction>(
    //     fn: MockInstance<T>,
    //   ): fn is MockInstance<T>;
    //   isMockFunction<P extends Array<unknown>, R>(
    //     fn: (...args: P) => R,
    //   ): fn is Mock<(...args: P) => R>;
    //   isMockFunction(fn: unknown): fn is Mock<UnknownFunction>;
    //   fn<T extends FunctionLike = UnknownFunction>(implementation?: T): Mock<T>;
    //   private _attachMockImplementation;
    //   spyOn<
    //     T extends object,
    //     K extends PropertyLikeKeys<T>,
    //     A extends "get" | "set",
    //   >(
    //     object: T,
    //     methodKey: K,
    //     accessType: A,
    //   ): A extends "get"
    //     ? SpiedGetter<T[K]>
    //     : A extends "set"
    //     ? SpiedSetter<T[K]>
    //     : never;
    //   spyOn<
    //     T extends object,
    //     K extends ConstructorLikeKeys<T> | MethodLikeKeys<T>,
    //     V extends Required<T>[K],
    //   >(
    //     object: T,
    //     methodKey: K,
    //   ): V extends ClassLike | FunctionLike ? Spied<V> : never;
    //   private _spyOnProperty;
    //   replaceProperty<
    //     T extends object,
    //     K extends PropertyLikeKeys<T>,
    //     V extends T[K],
    //   >(object: T, propertyKey: K, value: V): Replaced<T[K]>;
    //   clearAllMocks(): void;
    //   resetAllMocks(): void;
    //   restoreAllMocks(): void;
    //   private _typeOf;
    //   mocked<T extends object>(
    //     source: T,
    //     options?: {
    //       shallow: false;
    //     },
    //   ): Mocked<T>;
    //   mocked<T extends object>(
    //     source: T,
    //     options: {
    //       shallow: true;
    //     },
    //   ): MockedShallow<T>;
    // }

    export type PropertyLikeKeys<T> = Exclude<keyof T, ConstructorLikeKeys<T> | MethodLikeKeys<T>>;

    export type RejectType<T extends FunctionLike> = ReturnType<T> extends PromiseLike<any> ? unknown : never;

    export interface Replaced<T = unknown> {
      /**
       * Restore property to its original value known at the time of mocking.
       */
      restore(): void;
      /**
       * Change the value of the property.
       */
      replaceValue(value: T): this;
    }

    export function replaceProperty<
      T extends object,
      K_2 extends Exclude<
        keyof T,
        | keyof {
            [K in keyof T as Required<T>[K] extends ClassLike ? K : never]: T[K];
          }
        | keyof {
            [K_1 in keyof T as Required<T>[K_1] extends FunctionLike ? K_1 : never]: T[K_1];
          }
      >,
      V extends T[K_2],
    >(object: T, propertyKey: K_2, value: V): Replaced<T[K_2]>;

    export type ResolveType<T extends FunctionLike> = ReturnType<T> extends PromiseLike<infer U> ? U : never;

    export type Spied<T extends ClassLike | FunctionLike> = T extends ClassLike
      ? SpiedClass<T>
      : T extends FunctionLike
        ? SpiedFunction<T>
        : never;

    export type SpiedClass<T extends ClassLike = UnknownClass> = MockInstance<
      (...args: ConstructorParameters<T>) => InstanceType<T>
    >;

    export type SpiedFunction<T extends FunctionLike = UnknownFunction> = MockInstance<
      (...args: Parameters<T>) => ReturnType<T>
    >;

    export type SpiedGetter<T> = MockInstance<() => T>;

    export type SpiedSetter<T> = MockInstance<(arg: T) => void>;

    export interface SpyInstance<T extends FunctionLike = UnknownFunction> extends MockInstance<T> {}

    export const spyOn: {
      <
        T extends object,
        K_2 extends Exclude<
          keyof T,
          | keyof {
              [K in keyof T as Required<T>[K] extends ClassLike ? K : never]: T[K];
            }
          | keyof {
              [K_1 in keyof T as Required<T>[K_1] extends FunctionLike ? K_1 : never]: T[K_1];
            }
        >,
        V extends Required<T>[K_2],
        A extends "set" | "get",
      >(
        object: T,
        methodKey: K_2,
        accessType: A,
      ): A extends "get" ? SpiedGetter<V> : A extends "set" ? SpiedSetter<V> : never;
      <
        T_1 extends object,
        K_5 extends
          | keyof {
              [K_3 in keyof T_1 as Required<T_1>[K_3] extends ClassLike ? K_3 : never]: T_1[K_3];
            }
          | keyof {
              [K_4 in keyof T_1 as Required<T_1>[K_4] extends FunctionLike ? K_4 : never]: T_1[K_4];
            },
        V_1 extends Required<T_1>[K_5],
      >(
        object: T_1,
        methodKey: K_5,
      ): V_1 extends ClassLike | FunctionLike ? Spied<V_1> : never;
    };

    export interface UnknownClass {
      new (...args: unknown[]): unknown;
    }

    export type UnknownFunction = (...args: unknown[]) => unknown;
  }

  export const expectTypeOf: typeof import("./vendor/expect-type").expectTypeOf;
}
