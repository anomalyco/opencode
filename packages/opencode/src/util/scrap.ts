/**
 * A sample string constant for testing and demonstration purposes.
 */
export const foo: string = "42"

/**
 * A sample numeric constant for testing and demonstration purposes.
 */
export const bar: number = 123

/**
 * A dummy function that logs a message to the console.
 *
 * Used for testing and demonstration purposes.
 *
 * @example
 * ```typescript
 * dummyFunction() // Logs: "This is a dummy function"
 * ```
 */
export function dummyFunction(): void {
  console.log("This is a dummy function")
}

/**
 * Returns a random boolean value.
 *
 * Uses Math.random() to generate a random value and returns true if
 * the value is greater than 0.5, otherwise returns false.
 *
 * @returns A random boolean value
 * @example
 * ```typescript
 * const result = randomHelper()
 * console.log(result) // true or false
 * ```
 */
export function randomHelper(): boolean {
  return Math.random() > 0.5
}
