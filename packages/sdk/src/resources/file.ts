// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../core/resource';
import { APIPromise } from '../core/api-promise';
import { RequestOptions } from '../internal/request-options';

export class FileResource extends APIResource {
  /**
   * Read a file
   */
  read(query: FileReadParams, options?: RequestOptions): APIPromise<FileReadResponse> {
    return this._client.get('/file', { query, ...options });
  }

  /**
   * Get file status
   */
  status(options?: RequestOptions): APIPromise<FileStatusResponse> {
    return this._client.get('/file/status', options);
  }
}

export interface File {
  added: number;

  path: string;

  removed: number;

  status: 'added' | 'deleted' | 'modified';
}

export interface FileReadResponse {
  content: string;

  type: 'raw' | 'patch';
}

export type FileStatusResponse = Array<File>;

export interface FileReadParams {
  path: string;
}

export declare namespace FileResource {
  export {
    type File as File,
    type FileReadResponse as FileReadResponse,
    type FileStatusResponse as FileStatusResponse,
    type FileReadParams as FileReadParams,
  };
}
