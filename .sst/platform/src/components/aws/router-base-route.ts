import crypto from "crypto";
import { Input, jsonStringify } from "@pulumi/pulumi";
import { Component } from "../component";
import { KvRoutesUpdate } from "./providers/kv-routes-update";
import { KvKeys } from "./providers/kv-keys";

export interface RouterBaseRouteArgs {
  /**
   * The KV Namespace to use.
   */
  routerNamespace: Input<string>;
  /**
   * The KV Store to use.
   */
  store: Input<string>;
  /**
   * The pattern to match.
   */
  pattern: Input<string>;
}

export function parsePattern(pattern: string) {
  const [host, ...path] = pattern.split("/");
  return {
    host: host
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&") // Escape special regex chars
      .replace(/\*/g, ".*"), // Replace * with .*
    path: "/" + path.join("/"),
  };
}

export function buildKvNamespace(name: string) {
  // In the case multiple sites use the same kv store, we need to namespace the keys
  return crypto
    .createHash("md5")
    .update(`${$app.name}-${$app.stage}-${name}`)
    .digest("hex")
    .substring(0, 4);
}

export function createKvRouteData(
  name: string,
  args: RouterBaseRouteArgs,
  parent: Component,
  routeNs: string,
  data: any,
) {
  new KvKeys(
    `${name}RouteKey`,
    {
      store: args.store,
      namespace: routeNs,
      entries: {
        metadata: jsonStringify(data),
      },
      purge: false,
    },
    { parent },
  );
}

export function updateKvRoutes(
  name: string,
  args: RouterBaseRouteArgs,
  parent: Component,
  routeType: "url" | "bucket" | "site",
  routeNs: string,
  pattern: {
    host: string;
    path: string;
  },
) {
  return new KvRoutesUpdate(
    `${name}RoutesUpdate`,
    {
      store: args.store,
      namespace: args.routerNamespace,
      key: "routes",
      entry: [routeType, routeNs, pattern.host, pattern.path].join(","),
    },
    { parent },
  );
}
