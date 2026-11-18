import {
  all,
  ComponentResourceOptions,
  Input,
  Output,
  output,
} from "@pulumi/pulumi";
import { Function, FunctionArn, FunctionArgs } from "../function";
import { transform, Transform } from "../../component";
import { VisibleError } from "../../error";

export type FunctionBuilder = Output<{
  getFunction: () => Function;
  arn: Output<string>;
  invokeArn: Output<string>;
}>;

export function functionBuilder(
  name: string,
  definition: Input<string | FunctionArn | FunctionArgs>,
  defaultArgs: Pick<
    FunctionArgs,
    "description" | "link" | "environment" | "permissions" | "url" | "_skipHint"
  >,
  argsTransform?: Transform<FunctionArgs>,
  opts?: ComponentResourceOptions,
): FunctionBuilder {
  return output(definition).apply((definition) => {
    if (typeof definition === "string") {
      // Case 1: The definition is an ARN
      if (definition.startsWith("arn:")) {
        const parts = definition.split(":");
        return {
          getFunction: () => {
            throw new VisibleError(
              "Cannot access the created function because it is referenced as an ARN.",
            );
          },
          arn: output(definition),
          invokeArn: output(
            `arn:${parts[1]}:apigateway:${parts[3]}:lambda:path/2015-03-31/functions/${definition}/invocations`,
          ),
        };
      }

      // Case 2: The definition is a handler
      const fn = new Function(
        ...transform(
          argsTransform,
          name,
          { handler: definition, ...defaultArgs },
          opts || {},
        ),
      );
      return {
        getFunction: () => fn,
        arn: fn.arn,
        invokeArn: fn.nodes.function.invokeArn,
      };
    }

    // Case 3: The definition is a FunctionArgs
    else if (definition.handler) {
      const fn = new Function(
        ...transform(
          argsTransform,
          name,
          {
            ...defaultArgs,
            ...definition,
            link: all([defaultArgs?.link, definition.link]).apply(
              ([defaultLink, link]) => [
                ...(defaultLink ?? []),
                ...(link ?? []),
              ],
            ),
            environment: all([
              defaultArgs?.environment,
              definition.environment,
            ]).apply(([defaultEnvironment, environment]) => ({
              ...(defaultEnvironment ?? {}),
              ...(environment ?? {}),
            })),
            permissions: all([
              defaultArgs?.permissions,
              definition.permissions,
            ]).apply(([defaultPermissions, permissions]) => [
              ...(defaultPermissions ?? []),
              ...(permissions ?? []),
            ]),
          },
          opts || {},
        ),
      );
      return {
        getFunction: () => fn,
        arn: fn.arn,
        invokeArn: fn.nodes.function.invokeArn,
      };
    }
    throw new Error(`Invalid function definition for the "${name}" Function`);
  });
}
