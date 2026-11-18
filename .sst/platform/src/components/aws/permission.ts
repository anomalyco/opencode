import { Prettify } from "../component.js";
import { FunctionPermissionArgs } from "./function.js";

export interface InputArgs extends Prettify<FunctionPermissionArgs> {}

/**
 * The AWS Permission Linkable helper is used to define the AWS permissions included with the
 * [`sst.Linkable`](/docs/component/linkable/) component.
 *
 * @example
 *
 * ```ts
 * sst.aws.permission({
 *   actions: ["lambda:InvokeFunction"],
 *   resources: ["*"]
 * })
 * ```
 */
export function permission(input: InputArgs) {
  return {
    type: "aws.permission" as const,
    ...input,
  };
}

export type Permission = ReturnType<typeof permission>;
