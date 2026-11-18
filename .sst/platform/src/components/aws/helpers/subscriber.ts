import { Input, output } from "@pulumi/pulumi";
import { FunctionArgs, FunctionArn } from "../function";
import { Queue } from "../queue";

export function isFunctionSubscriber(
  subscriber?: Input<string | FunctionArgs | FunctionArn>,
) {
  if (!subscriber) return output(false);

  return output(subscriber).apply(
    (subscriber) =>
      typeof subscriber === "string" || typeof subscriber.handler === "string",
  );
}

export function isQueueSubscriber(subscriber?: Input<string | Queue>) {
  if (!subscriber) return output(false);

  return output(subscriber).apply(
    (subscriber) =>
      typeof subscriber === "string" || subscriber instanceof Queue,
  );
}
