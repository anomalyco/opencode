import { ComponentResourceOptions, output } from "@pulumi/pulumi";
import { Component } from "../component";
import { Link } from "../link.js";
import { Input } from "../input";

export interface DevCommandArgs {
  dev?: {
    /**
     * The command that `sst dev` runs to start this in dev mode.
     * @default `"npm run dev"`
     */
    command?: Input<string>;
    /**
     * Configure if you want to automatically start this when `sst dev` starts. You can still
     * start it manually later.
     * @default `true`
     */
    autostart?: Input<boolean>;
    /**
     * Change the directory from where the `command` is run.
     * @default The project root.
     */
    directory?: Input<string>;
    /**
     * The title of the tab in the multiplexer.
     *
     * @default The name of the component.
     */
    title?: Input<string>;
  };
  /**
   * [Link resources](/docs/linking/) to your command. This will allow you to access it in your
   * command using the [SDK](/docs/reference/sdk/).
   *
   * @example
   *
   * Takes a list of resources to link.
   *
   * ```js
   * {
   *   link: [bucket, stripeKey]
   * }
   * ```
   */
  link?: Input<any[]>;
  /**
   * Set environment variables for this command.
   *
   * @example
   * ```js
   * {
   *   environment: {
   *     API_URL: api.url,
   *     STRIPE_PUBLISHABLE_KEY: "pk_test_123"
   *   }
   * }
   * ```
   */
  environment?: Input<Record<string, Input<string>>>;
  /**
   * @internal
   */
  aws?: {
    role: Input<string>;
  };
}

/**
 * The `DevCommand` lets you run a command in a separate pane when you run `sst dev`.
 *
 * :::note
 * This is an experimental feature and the API may change in the future.
 * :::
 *
 * The `sst dev` CLI starts a multiplexer with panes for separate processes. This component allows you to add a process to it.
 *
 * :::tip
 * This component does not do anything on deploy.
 * :::
 *
 * This component only works in `sst dev`. It does not do anything in `sst deploy`.
 *
 * #### Example
 *
 * For example, you can use this to run Drizzle Studio locally.
 *
 * ```ts title="sst.config.ts"
 * new sst.x.DevCommand("Studio", {
 *   link: [rds],
 *   dev: {
 *     autostart: true,
 *     command: "npx drizzle-kit studio",
 *   },
 * });
 * ```
 *
 * Here `npx drizzle-kit studio` will be run in `sst dev` and will show up under the **Studio** tab. It'll also have access to the links from `rds`.
 */
export class DevCommand extends Component {
  constructor(
    name: string,
    args: DevCommandArgs,
    opts?: ComponentResourceOptions,
  ) {
    super(__pulumiType, name, args, opts);

    this.registerOutputs({
      _dev: {
        links: output(args.link || [])
          .apply(Link.build)
          .apply((links) => links.map((link) => link.name)),
        environment: args.environment,
        title: args.dev?.title,
        directory: args.dev?.directory,
        autostart: args.dev?.autostart !== false,
        command: args.dev?.command,
        aws: {
          role: args.aws?.role,
        },
      },
    });
  }
}

const __pulumiType = "sst:sst:DevCommand";
// @ts-expect-error
DevCommand.__pulumiType = __pulumiType;
