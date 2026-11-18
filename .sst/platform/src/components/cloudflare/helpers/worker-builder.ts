import {
  ComponentResourceOptions,
  Input,
  Output,
  output,
} from "@pulumi/pulumi";
import { transform, Transform } from "../../component";
import { Worker, WorkerArgs } from "../worker";
import * as cloudflare from "@pulumi/cloudflare";

export type WorkerBuilder = Output<{
  getWorker: () => Worker;
  script: cloudflare.WorkerScript;
}>;

export function workerBuilder(
  name: string,
  definition: Input<string | WorkerArgs>,
  argsTransform?: Transform<WorkerArgs>,
  opts?: ComponentResourceOptions,
): WorkerBuilder {
  return output(definition).apply((definition) => {
    if (typeof definition === "string") {
      // Case 1: The definition is a handler
      const worker = new Worker(
        ...transform(argsTransform, name, { handler: definition }, opts || {}),
      );
      return {
        getWorker: () => worker,
        script: worker.nodes.worker,
      };
    }

    // Case 2: The definition is a WorkerArgs
    else if (definition.handler) {
      const worker = new Worker(
        ...transform(
          argsTransform,
          name,
          {
            ...definition,
          },
          opts || {},
        ),
      );

      return {
        getWorker: () => worker,
        script: worker.nodes.worker,
      };
    }

    throw new Error(`Invalid worker definition for the "${name}" Worker`);
  });
}
