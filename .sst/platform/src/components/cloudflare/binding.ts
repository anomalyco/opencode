/**
 * The Cloudflare Binding Linkable helper is used to define the Cloudflare bindings included
 * with the [`sst.Linkable`](/docs/component/linkable/) component.
 *
 * @example
 *
 * ```ts
 * sst.cloudflare.binding({
 *   type: "r2BucketBindings",
 *   properties: {
 *     bucketName: "my-bucket"
 *   }
 * })
 * ```
 *
 * @packageDocumentation
 */

import { Input } from "../input";

export interface KvBinding {
  type: "kvNamespaceBindings";
  properties: {
    namespaceId: Input<string>;
  };
}
export interface SecretTextBinding {
  type: "secretTextBindings";
  properties: {
    text: Input<string>;
  };
}
export interface ServiceBinding {
  type: "serviceBindings";
  properties: {
    service: Input<string>;
  };
}
export interface PlainTextBinding {
  type: "plainTextBindings";
  properties: {
    text: Input<string>;
  };
}
export interface QueueBinding {
  type: "queueBindings";
  properties: {
    queue: Input<string>;
  };
}
export interface R2BucketBinding {
  type: "r2BucketBindings";
  properties: {
    bucketName: Input<string>;
  };
}

export interface D1DatabaseBinding {
  type: "d1DatabaseBindings";
  properties: {
    id: Input<string>;
  };
}

export type Binding =
  | KvBinding
  | SecretTextBinding
  | ServiceBinding
  | PlainTextBinding
  | QueueBinding
  | R2BucketBinding
  | D1DatabaseBinding;

export function binding<T extends Binding["type"]>(input: Binding & {}) {
  return {
    type: "cloudflare.binding" as const,
    binding: input.type as T,
    properties: input.properties as Extract<Binding, { type: T }>["properties"],
  };
}
