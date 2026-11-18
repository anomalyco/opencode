import { ComponentResourceOptions } from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";
import { Component, Transform, transform } from "../component";
import { Link } from "../link";
import { binding } from "./binding";
import { DEFAULT_ACCOUNT_ID } from "./account-id";

export interface QueueArgs {
  /**
   * [Transform](/docs/components/#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the Queue resource.
     */
    queue?: Transform<cloudflare.QueueArgs>;
  };
}

/**
 * The `Queue` component lets you add a [Cloudflare Queue](https://developers.cloudflare.com/queues/) to
 * your app.
 */
export class Queue extends Component implements Link.Linkable {
  private queue: cloudflare.Queue;

  constructor(name: string, args?: QueueArgs, opts?: ComponentResourceOptions) {
    super(__pulumiType, name, args, opts);

    const parent = this;

    const queue = create();

    this.queue = queue;

    function create() {
      return new cloudflare.Queue(
        ...transform(
          args?.transform?.queue,
          `${name}Queue`,
          {
            queueName: "",
            accountId: DEFAULT_ACCOUNT_ID,
          },
          { parent },
        ),
      );
    }
  }

  getSSTLink() {
    return {
      properties: {},
      include: [
        binding({
          type: "queueBindings",
          properties: {
            queue: this.queue.queueName,
          },
        }),
      ],
    };
  }

  /**
   * The generated id of the queue
   */
  public get id() {
    return this.queue.id;
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The Cloudflare queue.
       */
      queue: this.queue,
    };
  }
}

const __pulumiType = "sst:cloudflare:Queue";
// @ts-expect-error
Queue.__pulumiType = __pulumiType;
