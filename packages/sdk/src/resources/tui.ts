// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../core/resource';
import { APIPromise } from '../core/api-promise';
import { RequestOptions } from '../internal/request-options';

export class Tui extends APIResource {
  /**
   * Append prompt to the TUI
   */
  appendPrompt(body: TuiAppendPromptParams, options?: RequestOptions): APIPromise<TuiAppendPromptResponse> {
    return this._client.post('/tui/append-prompt', { body, ...options });
  }

  /**
   * Open the help dialog
   */
  openHelp(options?: RequestOptions): APIPromise<TuiOpenHelpResponse> {
    return this._client.post('/tui/open-help', options);
  }
}

export type TuiAppendPromptResponse = boolean;

export type TuiOpenHelpResponse = boolean;

export interface TuiAppendPromptParams {
  text: string;
}

export declare namespace Tui {
  export {
    type TuiAppendPromptResponse as TuiAppendPromptResponse,
    type TuiOpenHelpResponse as TuiOpenHelpResponse,
    type TuiAppendPromptParams as TuiAppendPromptParams,
  };
}
