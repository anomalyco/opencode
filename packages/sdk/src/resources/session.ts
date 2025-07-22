// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../core/resource';
import * as SessionAPI from './session';
import * as Shared from './shared';
import { APIPromise } from '../core/api-promise';
import { RequestOptions } from '../internal/request-options';
import { path } from '../internal/utils/path';

export class SessionResource extends APIResource {
  /**
   * Create a new session
   */
  create(options?: RequestOptions): APIPromise<Session> {
    return this._client.post('/session', options);
  }

  /**
   * List all sessions
   */
  list(options?: RequestOptions): APIPromise<SessionListResponse> {
    return this._client.get('/session', options);
  }

  /**
   * Delete a session and all its data
   */
  delete(id: string, options?: RequestOptions): APIPromise<SessionDeleteResponse> {
    return this._client.delete(path`/session/${id}`, options);
  }

  /**
   * Abort a session
   */
  abort(id: string, options?: RequestOptions): APIPromise<SessionAbortResponse> {
    return this._client.post(path`/session/${id}/abort`, options);
  }

  /**
   * Create and send a new message to a session
   */
  chat(id: string, body: SessionChatParams, options?: RequestOptions): APIPromise<AssistantMessage> {
    return this._client.post(path`/session/${id}/message`, { body, ...options });
  }

  /**
   * Analyze the app and create an AGENTS.md file
   */
  init(id: string, body: SessionInitParams, options?: RequestOptions): APIPromise<SessionInitResponse> {
    return this._client.post(path`/session/${id}/init`, { body, ...options });
  }

  /**
   * List messages for a session
   */
  messages(id: string, options?: RequestOptions): APIPromise<SessionMessagesResponse> {
    return this._client.get(path`/session/${id}/message`, options);
  }

  /**
   * Share a session
   */
  share(id: string, options?: RequestOptions): APIPromise<Session> {
    return this._client.post(path`/session/${id}/share`, options);
  }

  /**
   * Summarize the session
   */
  summarize(
    id: string,
    body: SessionSummarizeParams,
    options?: RequestOptions,
  ): APIPromise<SessionSummarizeResponse> {
    return this._client.post(path`/session/${id}/summarize`, { body, ...options });
  }

  /**
   * Unshare the session
   */
  unshare(id: string, options?: RequestOptions): APIPromise<Session> {
    return this._client.delete(path`/session/${id}/share`, options);
  }
}

export interface AssistantMessage {
  id: string;

  cost: number;

  modelID: string;

  path: AssistantMessage.Path;

  providerID: string;

  role: 'assistant';

  sessionID: string;

  system: Array<string>;

  time: AssistantMessage.Time;

  tokens: AssistantMessage.Tokens;

  error?:
    | Shared.ProviderAuthError
    | Shared.UnknownError
    | AssistantMessage.MessageOutputLengthError
    | Shared.MessageAbortedError;

  summary?: boolean;
}

export namespace AssistantMessage {
  export interface Path {
    cwd: string;

    root: string;
  }

  export interface Time {
    created: number;

    completed?: number;
  }

  export interface Tokens {
    cache: Tokens.Cache;

    input: number;

    output: number;

    reasoning: number;
  }

  export namespace Tokens {
    export interface Cache {
      read: number;

      write: number;
    }
  }

  export interface MessageOutputLengthError {
    data: unknown;

    name: 'MessageOutputLengthError';
  }
}

export interface FilePart {
  id: string;

  messageID: string;

  mime: string;

  sessionID: string;

  type: 'file';

  url: string;

  filename?: string;

  source?: FilePartSource;
}

export interface FilePartInput {
  mime: string;

  type: 'file';

  url: string;

  id?: string;

  filename?: string;

  source?: FilePartSource;
}

export type FilePartSource = FileSource | SymbolSource;

export interface FilePartSourceText {
  end: number;

  start: number;

  value: string;
}

export interface FileSource {
  path: string;

  text: FilePartSourceText;

  type: 'file';
}

export type Message = UserMessage | AssistantMessage;

export type Part = TextPart | FilePart | ToolPart | StepStartPart | StepFinishPart | SnapshotPart;

export interface Session {
  id: string;

  time: Session.Time;

  title: string;

  version: string;

  parentID?: string;

  revert?: Session.Revert;

  share?: Session.Share;
}

export namespace Session {
  export interface Time {
    created: number;

    updated: number;
  }

  export interface Revert {
    messageID: string;

    part: number;

    snapshot?: string;
  }

  export interface Share {
    url: string;
  }
}

export interface SnapshotPart {
  id: string;

  messageID: string;

  sessionID: string;

  snapshot: string;

  type: 'snapshot';
}

export interface StepFinishPart {
  id: string;

  cost: number;

  messageID: string;

  sessionID: string;

  tokens: StepFinishPart.Tokens;

  type: 'step-finish';
}

export namespace StepFinishPart {
  export interface Tokens {
    cache: Tokens.Cache;

    input: number;

    output: number;

    reasoning: number;
  }

  export namespace Tokens {
    export interface Cache {
      read: number;

      write: number;
    }
  }
}

export interface StepStartPart {
  id: string;

  messageID: string;

  sessionID: string;

  type: 'step-start';
}

export interface SymbolSource {
  kind: number;

  name: string;

  path: string;

  range: SymbolSource.Range;

  text: FilePartSourceText;

  type: 'symbol';
}

export namespace SymbolSource {
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

export interface TextPart {
  id: string;

  messageID: string;

  sessionID: string;

  text: string;

  type: 'text';

  synthetic?: boolean;

  time?: TextPart.Time;
}

export namespace TextPart {
  export interface Time {
    start: number;

    end?: number;
  }
}

export interface TextPartInput {
  text: string;

  type: 'text';

  id?: string;

  synthetic?: boolean;

  time?: TextPartInput.Time;
}

export namespace TextPartInput {
  export interface Time {
    start: number;

    end?: number;
  }
}

export interface ToolPart {
  id: string;

  callID: string;

  messageID: string;

  sessionID: string;

  state: ToolStatePending | ToolStateRunning | ToolStateCompleted | ToolStateError;

  tool: string;

  type: 'tool';
}

export interface ToolStateCompleted {
  input: { [key: string]: unknown };

  metadata: { [key: string]: unknown };

  output: string;

  status: 'completed';

  time: ToolStateCompleted.Time;

  title: string;
}

export namespace ToolStateCompleted {
  export interface Time {
    end: number;

    start: number;
  }
}

export interface ToolStateError {
  error: string;

  input: { [key: string]: unknown };

  status: 'error';

  time: ToolStateError.Time;
}

export namespace ToolStateError {
  export interface Time {
    end: number;

    start: number;
  }
}

export interface ToolStatePending {
  status: 'pending';
}

export interface ToolStateRunning {
  status: 'running';

  time: ToolStateRunning.Time;

  input?: unknown;

  metadata?: { [key: string]: unknown };

  title?: string;
}

export namespace ToolStateRunning {
  export interface Time {
    start: number;
  }
}

export interface UserMessage {
  id: string;

  role: 'user';

  sessionID: string;

  time: UserMessage.Time;
}

export namespace UserMessage {
  export interface Time {
    created: number;
  }
}

export type SessionListResponse = Array<Session>;

export type SessionDeleteResponse = boolean;

export type SessionAbortResponse = boolean;

export type SessionInitResponse = boolean;

export type SessionMessagesResponse = Array<SessionMessagesResponse.SessionMessagesResponseItem>;

export namespace SessionMessagesResponse {
  export interface SessionMessagesResponseItem {
    info: SessionAPI.Message;

    parts: Array<SessionAPI.Part>;
  }
}

export type SessionSummarizeResponse = boolean;

export interface SessionChatParams {
  modelID: string;

  parts: Array<TextPartInput | FilePartInput>;

  providerID: string;

  messageID?: string;

  mode?: string;

  tools?: { [key: string]: boolean };
}

export interface SessionInitParams {
  messageID: string;

  modelID: string;

  providerID: string;
}

export interface SessionSummarizeParams {
  modelID: string;

  providerID: string;
}

export declare namespace SessionResource {
  export {
    type AssistantMessage as AssistantMessage,
    type FilePart as FilePart,
    type FilePartInput as FilePartInput,
    type FilePartSource as FilePartSource,
    type FilePartSourceText as FilePartSourceText,
    type FileSource as FileSource,
    type Message as Message,
    type Part as Part,
    type Session as Session,
    type SnapshotPart as SnapshotPart,
    type StepFinishPart as StepFinishPart,
    type StepStartPart as StepStartPart,
    type SymbolSource as SymbolSource,
    type TextPart as TextPart,
    type TextPartInput as TextPartInput,
    type ToolPart as ToolPart,
    type ToolStateCompleted as ToolStateCompleted,
    type ToolStateError as ToolStateError,
    type ToolStatePending as ToolStatePending,
    type ToolStateRunning as ToolStateRunning,
    type UserMessage as UserMessage,
    type SessionListResponse as SessionListResponse,
    type SessionDeleteResponse as SessionDeleteResponse,
    type SessionAbortResponse as SessionAbortResponse,
    type SessionInitResponse as SessionInitResponse,
    type SessionMessagesResponse as SessionMessagesResponse,
    type SessionSummarizeResponse as SessionSummarizeResponse,
    type SessionChatParams as SessionChatParams,
    type SessionInitParams as SessionInitParams,
    type SessionSummarizeParams as SessionSummarizeParams,
  };
}
