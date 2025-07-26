// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../core/resource';
import { APIPromise } from '../core/api-promise';
import { RequestOptions } from '../internal/request-options';

export class AppResource extends APIResource {
  /**
   * Get app info
   */
  get(options?: RequestOptions): APIPromise<App> {
    return this._client.get('/app', options);
  }

  /**
   * Initialize the app
   */
  init(options?: RequestOptions): APIPromise<AppInitResponse> {
    return this._client.post('/app/init', options);
  }

  /**
   * Write a log entry to the server logs
   */
  log(body: AppLogParams, options?: RequestOptions): APIPromise<AppLogResponse> {
    return this._client.post('/log', { body, ...options });
  }

  /**
   * List all modes
   */
  modes(options?: RequestOptions): APIPromise<AppModesResponse> {
    return this._client.get('/mode', options);
  }

  /**
   * List all providers
   */
  providers(options?: RequestOptions): APIPromise<AppProvidersResponse> {
    return this._client.get('/config/providers', options);
  }
}

export interface App {
  git: boolean;

  hostname: string;

  path: App.Path;

  time: App.Time;
}

export namespace App {
  export interface Path {
    config: string;

    cwd: string;

    data: string;

    root: string;

    state: string;
  }

  export interface Time {
    initialized?: number;
  }
}

export interface Mode {
  name: string;

  tools: { [key: string]: boolean };

  model?: Mode.Model;

  prompt?: string;
}

export namespace Mode {
  export interface Model {
    modelID: string;

    providerID: string;
  }
}

export interface Model {
  id: string;

  attachment: boolean;

  cost: Model.Cost;

  limit: Model.Limit;

  name: string;

  options: { [key: string]: unknown };

  reasoning: boolean;

  release_date: string;

  temperature: boolean;

  tool_call: boolean;
}

export namespace Model {
  export interface Cost {
    input: number;

    output: number;

    cache_read?: number;

    cache_write?: number;
  }

  export interface Limit {
    context: number;

    output: number;
  }
}

export interface Provider {
  id: string;

  env: Array<string>;

  models: { [key: string]: Model };

  name: string;

  api?: string;

  npm?: string;
}

export type AppInitResponse = boolean;

export type AppLogResponse = boolean;

export type AppModesResponse = Array<Mode>;

export interface AppProvidersResponse {
  default: { [key: string]: string };

  providers: Array<Provider>;
}

export interface AppLogParams {
  /**
   * Log level
   */
  level: 'debug' | 'info' | 'error' | 'warn';

  /**
   * Log message
   */
  message: string;

  /**
   * Service name for the log entry
   */
  service: string;

  /**
   * Additional metadata for the log entry
   */
  extra?: { [key: string]: unknown };
}

export declare namespace AppResource {
  export {
    type App as App,
    type Mode as Mode,
    type Model as Model,
    type Provider as Provider,
    type AppInitResponse as AppInitResponse,
    type AppLogResponse as AppLogResponse,
    type AppModesResponse as AppModesResponse,
    type AppProvidersResponse as AppProvidersResponse,
    type AppLogParams as AppLogParams,
  };
}
