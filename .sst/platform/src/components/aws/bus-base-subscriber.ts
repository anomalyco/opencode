import { Input, output } from "@pulumi/pulumi";
import { Component, transform } from "../component";
import { cloudwatch } from "@pulumi/aws";
import { BusSubscriberArgs } from "./bus";

export interface BusBaseSubscriberArgs extends BusSubscriberArgs {
  /**
   * The bus to use.
   */
  bus: Input<{
    /**
     * The ARN of the bus.
     */
    arn: Input<string>;
    /**
     * The name of the bus.
     */
    name: Input<string>;
  }>;
}

export function createRule(
  name: string,
  eventBusName: Input<string>,
  args: BusBaseSubscriberArgs,
  parent: Component,
) {
  return new cloudwatch.EventRule(
    ...transform(
      args?.transform?.rule,
      `${name}Rule`,
      {
        eventBusName,
        eventPattern: args.pattern
          ? output(args.pattern).apply((pattern) =>
              JSON.stringify({
                "detail-type": pattern.detailType,
                source: pattern.source,
                detail: pattern.detail,
              }),
            )
          : JSON.stringify({
              source: [{ prefix: "" }],
            }),
      },
      { parent },
    ),
  );
}
