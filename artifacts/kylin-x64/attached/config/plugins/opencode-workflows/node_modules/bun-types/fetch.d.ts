/*
 * This file does not declare any global types.
 *
 * That should only happen in [./globals.d.ts](./globals.d.ts)
 * so that our documentation generator can pick it up, as it
 * expects all globals to be declared in one file.
 *
 * This may change in the future, which would be
 * a nice thing as it would allow us to split up
 * relevant types into their own files.
 */
declare module "bun" {
  type HeadersInit = string[][] | Record<string, string | ReadonlyArray<string>> | Headers;
  type BodyInit =
    | ReadableStream
    | Bun.XMLHttpRequestBodyInit
    // Extras that Bun supports:
    | AsyncIterable<string | ArrayBuffer | ArrayBufferView>
    | AsyncGenerator<string | ArrayBuffer | ArrayBufferView>
    | (() => AsyncGenerator<string | ArrayBuffer | ArrayBufferView>)
    | import("bun").Image;

  namespace __internal {
    type LibOrFallbackHeaders = LibDomIsLoaded extends true ? {} : import("undici-types").Headers;
    type LibOrFallbackRequest = LibDomIsLoaded extends true ? {} : import("undici-types").Request;
    type LibOrFallbackResponse = LibDomIsLoaded extends true ? {} : import("undici-types").Response;
    type LibOrFallbackResponseInit = LibDomIsLoaded extends true ? {} : import("undici-types").ResponseInit;
    type LibOrFallbackRequestInit = LibDomIsLoaded extends true
      ? {}
      : Omit<import("undici-types").RequestInit, "body" | "headers"> & {
          body?: Bun.BodyInit | null | undefined;
          headers?: Bun.HeadersInit | undefined;
        };

    interface BunHeadersOverride extends LibOrFallbackHeaders {
      /**
       * Convert {@link Headers} to a plain JavaScript object.
       *
       * About 10x faster than `Object.fromEntries(headers.entries())`
       *
       * Called when you run `JSON.stringify(headers)`
       *
       * Does not preserve insertion order. Well-known header names are lowercased. Other header names are left as-is.
       */
      toJSON(): Record<string, string> & { "set-cookie"?: string[] };

      /**
       * Get the total number of headers
       */
      readonly count: number;

      /**
       * Get all headers matching the name
       *
       * Only supports `"Set-Cookie"`. All other headers are empty arrays.
       *
       * @param name - The header name to get
       *
       * @returns An array of header values
       *
       * @example
       * ```ts
       * const headers = new Headers();
       * headers.append("Set-Cookie", "foo=bar");
       * headers.append("Set-Cookie", "baz=qux");
       * headers.getAll("Set-Cookie"); // ["foo=bar", "baz=qux"]
       * ```
       */
      getAll(name: "set-cookie" | "Set-Cookie"): string[];
    }

    interface BunRequestOverride extends LibOrFallbackRequest {
      headers: BunHeadersOverride;
    }

    interface BunResponseOverride extends LibOrFallbackResponse {
      headers: BunHeadersOverride;
    }
  }
}
