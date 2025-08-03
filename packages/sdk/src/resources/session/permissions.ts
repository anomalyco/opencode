// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../core/resource';
import { APIPromise } from '../../core/api-promise';
import { RequestOptions } from '../../internal/request-options';
import { path } from '../../internal/utils/path';

export class Permissions extends APIResource {
  /**
   * Respond to a permission request
   */
  respond(
    permissionID: string,
    params: PermissionRespondParams,
    options?: RequestOptions,
  ): APIPromise<PermissionRespondResponse> {
    const { id, ...body } = params;
    return this._client.post(path`/session/${id}/permissions/${permissionID}`, { body, ...options });
  }
}

export interface Permission {
  id: string;

  messageID: string;

  metadata: { [key: string]: unknown };

  sessionID: string;

  time: Permission.Time;

  title: string;

  toolCallID?: string;
}

export namespace Permission {
  export interface Time {
    created: number;
  }
}

export type PermissionRespondResponse = boolean;

export interface PermissionRespondParams {
  /**
   * Path param:
   */
  id: string;

  /**
   * Body param:
   */
  response: 'once' | 'always' | 'reject';
}

export declare namespace Permissions {
  export {
    type Permission as Permission,
    type PermissionRespondResponse as PermissionRespondResponse,
    type PermissionRespondParams as PermissionRespondParams,
  };
}
