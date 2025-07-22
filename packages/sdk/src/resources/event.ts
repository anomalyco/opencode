// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../core/resource';
import * as SessionAPI from './session';
import * as Shared from './shared';
import { APIPromise } from '../core/api-promise';
import { Stream } from '../core/streaming';
import { RequestOptions } from '../internal/request-options';

export class Event extends APIResource {
  /**
   * Get events
   */
  list(options?: RequestOptions): APIPromise<Stream<EventListResponse>> {
    return this._client.get('/event', { ...options, stream: true }) as APIPromise<Stream<EventListResponse>>;
  }
}

export type EventListResponse =
  | EventListResponse.EventLspClientDiagnostics
  | EventListResponse.EventPermissionUpdated
  | EventListResponse.EventFileEdited
  | EventListResponse.EventInstallationUpdated
  | EventListResponse.EventMessageUpdated
  | EventListResponse.EventMessageRemoved
  | EventListResponse.EventMessagePartUpdated
  | EventListResponse.EventStorageWrite
  | EventListResponse.EventSessionUpdated
  | EventListResponse.EventSessionDeleted
  | EventListResponse.EventSessionIdle
  | EventListResponse.EventSessionError
  | EventListResponse.EventFileWatcherUpdated
  | EventListResponse.EventIdeInstalled;

export namespace EventListResponse {
  export interface EventLspClientDiagnostics {
    properties: EventLspClientDiagnostics.Properties;

    type: 'lsp.client.diagnostics';
  }

  export namespace EventLspClientDiagnostics {
    export interface Properties {
      path: string;

      serverID: string;
    }
  }

  export interface EventPermissionUpdated {
    properties: EventPermissionUpdated.Properties;

    type: 'permission.updated';
  }

  export namespace EventPermissionUpdated {
    export interface Properties {
      id: string;

      metadata: { [key: string]: unknown };

      sessionID: string;

      time: Properties.Time;

      title: string;
    }

    export namespace Properties {
      export interface Time {
        created: number;
      }
    }
  }

  export interface EventFileEdited {
    properties: EventFileEdited.Properties;

    type: 'file.edited';
  }

  export namespace EventFileEdited {
    export interface Properties {
      file: string;
    }
  }

  export interface EventInstallationUpdated {
    properties: EventInstallationUpdated.Properties;

    type: 'installation.updated';
  }

  export namespace EventInstallationUpdated {
    export interface Properties {
      version: string;
    }
  }

  export interface EventMessageUpdated {
    properties: EventMessageUpdated.Properties;

    type: 'message.updated';
  }

  export namespace EventMessageUpdated {
    export interface Properties {
      info: SessionAPI.Message;
    }
  }

  export interface EventMessageRemoved {
    properties: EventMessageRemoved.Properties;

    type: 'message.removed';
  }

  export namespace EventMessageRemoved {
    export interface Properties {
      messageID: string;

      sessionID: string;
    }
  }

  export interface EventMessagePartUpdated {
    properties: EventMessagePartUpdated.Properties;

    type: 'message.part.updated';
  }

  export namespace EventMessagePartUpdated {
    export interface Properties {
      part: SessionAPI.Part;
    }
  }

  export interface EventStorageWrite {
    properties: EventStorageWrite.Properties;

    type: 'storage.write';
  }

  export namespace EventStorageWrite {
    export interface Properties {
      key: string;

      content?: unknown;
    }
  }

  export interface EventSessionUpdated {
    properties: EventSessionUpdated.Properties;

    type: 'session.updated';
  }

  export namespace EventSessionUpdated {
    export interface Properties {
      info: SessionAPI.Session;
    }
  }

  export interface EventSessionDeleted {
    properties: EventSessionDeleted.Properties;

    type: 'session.deleted';
  }

  export namespace EventSessionDeleted {
    export interface Properties {
      info: SessionAPI.Session;
    }
  }

  export interface EventSessionIdle {
    properties: EventSessionIdle.Properties;

    type: 'session.idle';
  }

  export namespace EventSessionIdle {
    export interface Properties {
      sessionID: string;
    }
  }

  export interface EventSessionError {
    properties: EventSessionError.Properties;

    type: 'session.error';
  }

  export namespace EventSessionError {
    export interface Properties {
      error?:
        | Shared.ProviderAuthError
        | Shared.UnknownError
        | Properties.MessageOutputLengthError
        | Shared.MessageAbortedError;

      sessionID?: string;
    }

    export namespace Properties {
      export interface MessageOutputLengthError {
        data: unknown;

        name: 'MessageOutputLengthError';
      }
    }
  }

  export interface EventFileWatcherUpdated {
    properties: EventFileWatcherUpdated.Properties;

    type: 'file.watcher.updated';
  }

  export namespace EventFileWatcherUpdated {
    export interface Properties {
      event: 'rename' | 'change';

      file: string;
    }
  }

  export interface EventIdeInstalled {
    properties: EventIdeInstalled.Properties;

    type: 'ide.installed';
  }

  export namespace EventIdeInstalled {
    export interface Properties {
      ide: string;
    }
  }
}

export declare namespace Event {
  export { type EventListResponse as EventListResponse };
}
