// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

export interface MessageAbortedError {
  data: unknown;

  name: 'MessageAbortedError';
}

export interface ProviderAuthError {
  data: ProviderAuthError.Data;

  name: 'ProviderAuthError';
}

export namespace ProviderAuthError {
  export interface Data {
    message: string;

    providerID: string;
  }
}

export interface UnknownError {
  data: UnknownError.Data;

  name: 'UnknownError';
}

export namespace UnknownError {
  export interface Data {
    message: string;
  }
}
