import { all, ComponentResourceOptions, Output } from "@pulumi/pulumi";
import { RandomPassword } from "@pulumi/random";
import { Component } from "../component";
import { FunctionArgs, Function } from ".";
import { functionBuilder } from "./helpers/function-builder";
import { Input } from "../input";

export interface OpenControlArgs {
  /**
   * The function that's running your OpenControl server.
   *
   * @example
   * ```js
   * {
   *   server: "src/server.handler"
   * }
   * ```
   *
   * You can also pass in the full `FunctionArgs`.
   *
   * ```js
   * {
   *   server: {
   *     handler: "src/server.handler",
   *     link: [table]
   *   }
   * }
   * ```
   *
   * Since the `server` function is a Hono app, you want to export it with the Lambda adapter.
   *
   * ```ts title="src/server.ts"
   * import { handle } from "hono/aws-lambda";
   * import { create } from "opencontrol";
   *
   * const app = create({
   *   // ...
   * });
   *
   * export const handler = handle(app);
   * ```
   *
   * Learn more in the [OpenControl docs](https://opencontrol.ai) on how to
   * configure the `server` function.
   */
  server: Input<string | FunctionArgs>;
}

/**
 * The `OpenControl` component lets you deploy your
 * [OpenControl](https://opencontrol.ai) server to
 * [AWS Lambda](https://aws.amazon.com/lambda/).
 *
 * :::note
 * OpenControl is currently in beta.
 * :::
 *
 * @example
 *
 * #### Create an OpenControl server
 *
 * ```ts title="sst.config.ts"
 * const server = new sst.aws.OpenControl("MyServer", {
 *   server: "src/server.handler"
 * });
 * ```
 *
 * #### Link your AI API keys
 *
 * ```ts title="sst.config.ts" {6}
 * const anthropicKey = new sst.Secret("AnthropicKey");
 *
 * const server = new sst.aws.OpenControl("MyServer", {
 *   server: {
 *     handler: "src/server.handler",
 *     link: [anthropicKey]
 *   }
 * });
 * ```
 *
 * #### Link your resources
 *
 * If your tools are need access to specific resources, you can link them to the
 * OpenControl server.
 *
 * ```ts title="sst.config.ts" {6}
 * const bucket = new sst.aws.Bucket("MyBucket");
 *
 * new sst.aws.OpenControl("MyServer", {
 *   server: {
 *     handler: "src/server.handler",
 *     link: [bucket]
 *   }
 * });
 * ```
 *
 * #### Give AWS permissions
 *
 * If you are using the AWS tool within OpenControl, you will need to give
 * your OpenControl server permissions to access your AWS account.
 *
 * ```ts title="sst.config.ts" {4-6}
 * new sst.aws.OpenControl("OpenControl", {
 *   server: {
 *     handler: "src/server.handler",
 *     policies: $dev
 *       ? ["arn:aws:iam::aws:policy/AdministratorAccess"]
 *       : ["arn:aws:iam::aws:policy/ReadOnlyAccess"]
 *   }
 * });
 * ```
 *
 * Here we are giving it admin access in dev but read-only access in prod.
 *
 * #### Define your server
 *
 * Your `server` function might look like this.
 *
 * ```ts title="src/server.ts"
 * import { Resource } from "sst";
 * import { create } from "opencontrol";
 * import { tool } from "opencontrol/tool";
 * import { handle } from "hono/aws-lambda";
 * import { createAnthropic } from "@ai-sdk/anthropic";
 *
 * const myTool = tool({
 *   name: "my_tool",
 *   description: "Get the most popular greeting",
 *   async run() {
 *     return "Hello, world!";
 *   }
 * });
 *
 * const app = create({
 *   model: createAnthropic({
 *     apiKey: Resource.AnthropicKey.value,
 *   })("claude-3-7-sonnet-20250219"),
 *   tools: [myTool],
 * });
 *
 * export const handler = handle(app);
 * ```
 *
 * Learn more in the [OpenControl docs](https://opencontrol.ai) on how to configure
 * the `server` function.
 */
export class OpenControl extends Component {
  private readonly _server: Output<Function>;
  private readonly _key: Output<string>;

  constructor(
    name: string,
    args: OpenControlArgs,
    opts?: ComponentResourceOptions,
  ) {
    super(__pulumiType, name, args, opts);
    const self = this;

    const key = createKey();
    const server = createServer();

    this._server = server;
    this._key = key;
    registerOutputs();

    function registerOutputs() {
      self.registerOutputs({
        _hint: self.url,
      });
    }

    function createKey() {
      return new RandomPassword(
        `${name}Key`,
        {
          length: 16,
          special: false,
        },
        { parent: self },
      ).result;
    }

    function createServer() {
      return functionBuilder(
        `${name}Server`,
        args.server,
        {
          link: [],
          environment: {
            OPENCONTROL_KEY: key,
          },
          url: {
            cors: false,
          },
          _skipHint: true,
        },
        undefined,
        { parent: self },
      ).apply((v) => v.getFunction());
    }
  }

  /**
   * The URL of the OpenControl server.
   */
  public get url() {
    return this._server.url;
  }

  /**
   * The password for the OpenControl server.
   */
  public get password() {
    return this._key;
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The Function component for the server.
       */
      server: this._server,
    };
  }
}

const __pulumiType = "sst:aws:OpenControl";
// @ts-expect-error
OpenControl.__pulumiType = __pulumiType;
