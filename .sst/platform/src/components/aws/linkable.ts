import { VisibleError } from "../error";
import { FunctionPermissionArgs } from "./function";

export const URL_UNAVAILABLE = "http://url-unavailable-in-dev.mode";

/** @deprecated
 * instead try
 * ```
 * sst.Linkable.wrap(MyResource, (resource) => ({
 *   properties: { ... },
 *   with: [
 *     sst.aws.permission({ actions: ["foo:*"], resources: [resource.arn] })
 *   ]
 * }))
 * ```
 */
export function linkable<T>(
  obj: { new (...args: any[]): T },
  cb: (resource: T) => FunctionPermissionArgs[],
) {
  throw new VisibleError(
    [
      "sst.aws.linkable is deprecated. Use sst.Linkable.wrap instead.",
      "sst.Linkable.wrap(MyResource, (resource) => ({",
      "  properties: { ... },",
      "  with: [",
      '    sst.aws.permission({ actions: ["foo:*"], resources: [resource.arn] })',
      "  ]",
      "}))",
    ].join("\n"),
  );
}
