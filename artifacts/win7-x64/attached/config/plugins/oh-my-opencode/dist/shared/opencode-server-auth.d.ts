/**
 * Builds HTTP Basic Auth header from environment variables.
 *
 * @returns Basic Auth header string, or undefined if OPENCODE_SERVER_PASSWORD is not set
 */
export declare function getServerBasicAuthHeader(): string | undefined;
/**
 * Injects HTTP Basic Auth header into the OpenCode SDK client.
 *
 * This function accesses the SDK's internal `_client.setConfig()` method.
 * While `_client` has an underscore prefix (suggesting internal use), this is actually
 * a stable public API from `@hey-api/openapi-ts` generated client:
 * - `setConfig()` MERGES headers (does not replace existing ones)
 * - This is the documented way to update client config at runtime
 *
 * @see https://github.com/sst/opencode/blob/main/packages/sdk/js/src/gen/client/client.gen.ts
 * @throws {Error} If OPENCODE_SERVER_PASSWORD is set but client structure is incompatible
 */
export declare function injectServerAuthIntoClient(client: unknown): void;
