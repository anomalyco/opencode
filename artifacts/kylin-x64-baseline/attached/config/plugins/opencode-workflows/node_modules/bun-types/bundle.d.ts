/**
 * The `bun:bundle` module provides compile-time utilities for dead-code elimination.
 *
 * @example
 * ```ts
 * import { feature } from "bun:bundle";
 *
 * if (feature("SUPER_SECRET")) {
 *   console.log("Secret feature enabled!");
 * } else {
 *   console.log("Normal mode");
 * }
 * ```
 *
 * Enable feature flags via CLI:
 * ```bash
 * # During build
 * bun build --feature=SUPER_SECRET index.ts
 *
 * # At runtime
 * bun run --feature=SUPER_SECRET index.ts
 *
 * # In tests
 * bun test --feature=SUPER_SECRET
 * ```
 *
 * @module bun:bundle
 */
declare module "bun:bundle" {
  /**
   * Registry for type-safe feature flags.
   *
   * Augment this interface to get autocomplete and type checking for your feature flags:
   *
   * @example
   * ```ts
   * // env.d.ts
   * declare module "bun:bundle" {
   *   interface Registry {
   *     features: "DEBUG" | "PREMIUM" | "BETA";
   *   }
   * }
   * ```
   *
   * Now `feature()` only accepts `"DEBUG"`, `"PREMIUM"`, or `"BETA"`:
   * ```ts
   * feature("DEBUG");    // OK
   * feature("TYPO");     // Type error
   * ```
   */
  interface Registry {}

  /**
   * Check if a feature flag is enabled at compile time.
   *
   * This function is replaced with a boolean literal (`true` or `false`) at bundle time,
   * enabling dead-code elimination. The bundler will remove unreachable branches.
   *
   * @param flag - The name of the feature flag to check
   * @returns `true` if the flag was passed via `--feature=FLAG`, `false` otherwise
   *
   * @example
   * ```ts
   * import { feature } from "bun:bundle";
   *
   * // With --feature=DEBUG, this becomes: if (true) { ... }
   * // Without --feature=DEBUG, this becomes: if (false) { ... }
   * if (feature("DEBUG")) {
   *   console.log("Debug mode enabled");
   * }
   * ```
   */
  function feature(flag: Registry extends { features: infer Features extends string } ? Features : string): boolean;
}
