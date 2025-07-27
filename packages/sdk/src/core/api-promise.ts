// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { type Opencode } from '../client';

import { type PromiseOrValue } from '../internal/types';
import { APIResponseProps, defaultParseResponse } from '../internal/parse';

/**
 * A subclass of `Promise` providing additional helper methods
 * for interacting with the SDK.
 */
export class APIPromise<T> extends Promise<T> {
  private parsedPromise: Promise<T> | undefined;
  #client: Opencode;

  constructor(
    client: Opencode,
    private responsePromise: Promise<APIResponseProps>,
    private parseResponse: (
      client: Opencode,
      props: APIResponseProps,
    ) => PromiseOrValue<T> = defaultParseResponse,
  ) {
    super((resolve) => {
      // this is maybe a bit weird but this has to be a no-op to not implicitly
      // parse the response body; instead .then, .catch, .finally are overridden
      // to parse the response
      resolve(null as any);
    });
    this.#client = client;
  }

  _thenUnwrap<U>(transform: (data: T, props: APIResponseProps) => U): APIPromise<U> {
    return new APIPromise(this.#client, this.responsePromise, async (client, props) =>
      transform(await this.parseResponse(client, props), props),
    );
  }

  /**
   * Gets the raw `Response` instance instead of parsing the response
   * data.
   *
   * If you want to parse the response body but still get the `Response`
   * instance, you can use {@link withResponse()}.
   *
   * 👋 Getting the wrong TypeScript type for `Response`?
   * Try setting `"moduleResolution": "NodeNext"` or add `"lib": ["DOM"]`
   * to your `tsconfig.json`.
   */
  asResponse(): Promise<Response> {
    return this.responsePromise.then((p) => p.response);
  }

  /**
   * Gets the parsed response data and the raw `Response` instance.
   *
   * If you just want to get the raw `Response` instance without parsing it,
   * you can use {@link asResponse()}.
   *
   * 👋 Getting the wrong TypeScript type for `Response`?
   * Try setting `"moduleResolution": "NodeNext"` or add `"lib": ["DOM"]`
   * to your `tsconfig.json`.
   */
  async withResponse(): Promise<{ data: T; response: Response }> {
    const [data, response] = await Promise.all([this.parse(), this.asResponse()]);
    return { data, response };
  }

  private parse(): Promise<T> {
    if (!this.parsedPromise) {
      this.parsedPromise = this.responsePromise.then((data) => this.parseResponse(this.#client, data));
    }
    return this.parsedPromise;
  }

  override then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null,
  ): Promise<TResult1 | TResult2> {
    return this.parse().then(onfulfilled, onrejected);
  }

  override catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null,
  ): Promise<T | TResult> {
    return this.parse().catch(onrejected);
  }

  override finally(onfinally?: (() => void) | undefined | null): Promise<T> {
    return this.parse().finally(onfinally);
  }
}
