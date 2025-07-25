// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import type { Opencode } from '../client';

export abstract class APIResource {
  protected _client: Opencode;

  constructor(client: Opencode) {
    this._client = client;
  }
}
