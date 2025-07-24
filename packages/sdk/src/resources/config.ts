// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../core/resource';
import * as ConfigAPI from './config';
import { APIPromise } from '../core/api-promise';
import { RequestOptions } from '../internal/request-options';

export class ConfigResource extends APIResource {
  /**
   * Get config info
   */
  get(options?: RequestOptions): APIPromise<Config> {
    return this._client.get('/config', options);
  }
}

export interface Config {
  /**
   * JSON schema reference for configuration validation
   */
  $schema?: string;

  /**
   * @deprecated Use 'share' field instead. Share newly created sessions
   * automatically
   */
  autoshare?: boolean;

  /**
   * Automatically update to the latest version
   */
  autoupdate?: boolean;

  /**
   * Disable providers that are loaded automatically
   */
  disabled_providers?: Array<string>;

  experimental?: Config.Experimental;

  /**
   * Additional instruction files or patterns to include
   */
  instructions?: Array<string>;

  /**
   * Custom keybind configurations
   */
  keybinds?: KeybindsConfig;

  /**
   * @deprecated Always uses stretch layout.
   */
  layout?: 'auto' | 'stretch';

  /**
   * MCP (Model Context Protocol) server configurations
   */
  mcp?: { [key: string]: McpLocalConfig | McpRemoteConfig };

  /**
   * Modes configuration, see https://opencode.ai/docs/modes
   */
  mode?: Config.Mode;

  /**
   * Model to use in the format of provider/model, eg anthropic/claude-2
   */
  model?: string;

  /**
   * Custom provider configurations and model overrides
   */
  provider?: { [key: string]: Config.Provider };

  /**
   * Control sharing behavior:'manual' allows manual sharing via commands, 'auto'
   * enables automatic sharing, 'disabled' disables all sharing
   */
  share?: 'manual' | 'auto' | 'disabled';

  /**
   * Small model to use for tasks like summarization and title generation in the
   * format of provider/model
   */
  small_model?: string;

  /**
   * Theme name to use for the interface
   */
  theme?: string;

  /**
   * Custom username to display in conversations instead of system username
   */
  username?: string;
}

export namespace Config {
  export interface Experimental {
    hook?: Experimental.Hook;
  }

  export namespace Experimental {
    export interface Hook {
      file_edited?: { [key: string]: Array<Hook.FileEdited> };

      session_completed?: Array<Hook.SessionCompleted>;
    }

    export namespace Hook {
      export interface FileEdited {
        command: Array<string>;

        environment?: { [key: string]: string };
      }

      export interface SessionCompleted {
        command: Array<string>;

        environment?: { [key: string]: string };
      }
    }
  }

  /**
   * Modes configuration, see https://opencode.ai/docs/modes
   */
  export interface Mode {
    build?: ConfigAPI.ModeConfig;

    plan?: ConfigAPI.ModeConfig;

    [k: string]: ConfigAPI.ModeConfig | undefined;
  }

  export interface Provider {
    models: { [key: string]: Provider.Models };

    id?: string;

    api?: string;

    env?: Array<string>;

    name?: string;

    npm?: string;

    options?: Provider.Options;
  }

  export namespace Provider {
    export interface Models {
      id?: string;

      attachment?: boolean;

      cost?: Models.Cost;

      limit?: Models.Limit;

      name?: string;

      options?: { [key: string]: unknown };

      reasoning?: boolean;

      release_date?: string;

      temperature?: boolean;

      tool_call?: boolean;
    }

    export namespace Models {
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

    export interface Options {
      apiKey?: string;

      baseURL?: string;

      [k: string]: unknown;
    }
  }
}

export interface KeybindsConfig {
  /**
   * Exit the application
   */
  app_exit: string;

  /**
   * Show help dialog
   */
  app_help: string;

  /**
   * Open external editor
   */
  editor_open: string;

  /**
   * Close file
   */
  file_close: string;

  /**
   * Split/unified diff
   */
  file_diff_toggle: string;

  /**
   * List files
   */
  file_list: string;

  /**
   * Search file
   */
  file_search: string;

  /**
   * Clear input field
   */
  input_clear: string;

  /**
   * Insert newline in input
   */
  input_newline: string;

  /**
   * Paste from clipboard
   */
  input_paste: string;

  /**
   * Submit input
   */
  input_submit: string;

  /**
   * Leader key for keybind combinations
   */
  leader: string;

  /**
   * Copy message
   */
  messages_copy: string;

  /**
   * Navigate to first message
   */
  messages_first: string;

  /**
   * Scroll messages down by half page
   */
  messages_half_page_down: string;

  /**
   * Scroll messages up by half page
   */
  messages_half_page_up: string;

  /**
   * Navigate to last message
   */
  messages_last: string;

  /**
   * Toggle layout
   */
  messages_layout_toggle: string;

  /**
   * Navigate to next message
   */
  messages_next: string;

  /**
   * Scroll messages down by one page
   */
  messages_page_down: string;

  /**
   * Scroll messages up by one page
   */
  messages_page_up: string;

  /**
   * Navigate to previous message
   */
  messages_previous: string;

  /**
   * Redo message
   */
  messages_redo: string;

  /**
   * @deprecated use messages_undo. Revert message
   */
  messages_revert: string;

  /**
   * Undo message
   */
  messages_undo: string;

  /**
   * List available models
   */
  model_list: string;

  /**
   * Create/update AGENTS.md
   */
  project_init: string;

  /**
   * Compact the session
   */
  session_compact: string;

  /**
   * Export session to editor
   */
  session_export: string;

  /**
   * Interrupt current session
   */
  session_interrupt: string;

  /**
   * List all sessions
   */
  session_list: string;

  /**
   * Create a new session
   */
  session_new: string;

  /**
   * Share current session
   */
  session_share: string;

  /**
   * Unshare current session
   */
  session_unshare: string;

  /**
   * Next mode
   */
  switch_mode: string;

  /**
   * Previous Mode
   */
  switch_mode_reverse: string;

  /**
   * List available themes
   */
  theme_list: string;

  /**
   * Toggle tool details
   */
  tool_details: string;
}

export interface McpLocalConfig {
  /**
   * Command and arguments to run the MCP server
   */
  command: Array<string>;

  /**
   * Type of MCP server connection
   */
  type: 'local';

  /**
   * Enable or disable the MCP server on startup
   */
  enabled?: boolean;

  /**
   * Environment variables to set when running the MCP server
   */
  environment?: { [key: string]: string };
}

export interface McpRemoteConfig {
  /**
   * Type of MCP server connection
   */
  type: 'remote';

  /**
   * URL of the remote MCP server
   */
  url: string;

  /**
   * Enable or disable the MCP server on startup
   */
  enabled?: boolean;

  /**
   * Headers to send with the request
   */
  headers?: { [key: string]: string };
}

export interface ModeConfig {
  model?: string;

  prompt?: string;

  tools?: { [key: string]: boolean };
}

export declare namespace ConfigResource {
  export {
    type Config as Config,
    type KeybindsConfig as KeybindsConfig,
    type McpLocalConfig as McpLocalConfig,
    type McpRemoteConfig as McpRemoteConfig,
    type ModeConfig as ModeConfig,
  };
}
