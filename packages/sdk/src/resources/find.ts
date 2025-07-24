// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../core/resource';
import { APIPromise } from '../core/api-promise';
import { RequestOptions } from '../internal/request-options';

export class Find extends APIResource {
  /**
   * Find files
   */
  files(query: FindFilesParams, options?: RequestOptions): APIPromise<FindFilesResponse> {
    return this._client.get('/find/file', { query, ...options });
  }

  /**
   * Find workspace symbols
   */
  symbols(query: FindSymbolsParams, options?: RequestOptions): APIPromise<FindSymbolsResponse> {
    return this._client.get('/find/symbol', { query, ...options });
  }

  /**
   * Find text in files
   */
  text(query: FindTextParams, options?: RequestOptions): APIPromise<FindTextResponse> {
    return this._client.get('/find', { query, ...options });
  }
}

export interface Match {
  absolute_offset: number;

  line_number: number;

  lines: Match.Lines;

  path: Match.Path;

  submatches: Array<Match.Submatch>;
}

export namespace Match {
  export interface Lines {
    text: string;
  }

  export interface Path {
    text: string;
  }

  export interface Submatch {
    end: number;

    match: Submatch.Match;

    start: number;
  }

  export namespace Submatch {
    export interface Match {
      text: string;
    }
  }
}

export interface Symbol {
  kind: number;

  location: Symbol.Location;

  name: string;
}

export namespace Symbol {
  export interface Location {
    range: Location.Range;

    uri: string;
  }

  export namespace Location {
    export interface Range {
      end: Range.End;

      start: Range.Start;
    }

    export namespace Range {
      export interface End {
        character: number;

        line: number;
      }

      export interface Start {
        character: number;

        line: number;
      }
    }
  }
}

export type FindFilesResponse = Array<string>;

export type FindSymbolsResponse = Array<Symbol>;

export type FindTextResponse = Array<Match>;

export interface FindFilesParams {
  query: string;
}

export interface FindSymbolsParams {
  query: string;
}

export interface FindTextParams {
  pattern: string;
}

export declare namespace Find {
  export {
    type Match as Match,
    type Symbol as Symbol,
    type FindFilesResponse as FindFilesResponse,
    type FindSymbolsResponse as FindSymbolsResponse,
    type FindTextResponse as FindTextResponse,
    type FindFilesParams as FindFilesParams,
    type FindSymbolsParams as FindSymbolsParams,
    type FindTextParams as FindTextParams,
  };
}
