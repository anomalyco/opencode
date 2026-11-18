import {
  ComponentResourceOptions,
  jsonStringify,
  Output,
} from "@pulumi/pulumi";
import { Component } from "../component";
import { Link } from "../link";
import { FunctionArgs, Function, Dynamo, CdnArgs, Router } from ".";
import { functionBuilder } from "./helpers/function-builder";
import { env } from "../linkable";
import { Auth as AuthV1 } from "./auth-v1";
import { Input } from "../input";

export interface AuthArgs {
  /**
   * The issuer function.
   * @deprecated renamed to `issuer`
   * @example
   * ```js
   * {
   *   authorizer: "src/auth.handler"
   * }
   * ```
   *
   * You can also pass in the full `FunctionArgs`.
   *
   * ```js
   * {
   *   authorizer: {
   *     handler: "src/auth.handler",
   *     link: [table]
   *   }
   * }
   * ```
   */
  authorizer?: Input<string | FunctionArgs>;
  /**
   * The function that's running your OpenAuth server.
   *
   * @example
   * ```js
   * {
   *   issuer: "src/auth.handler"
   * }
   * ```
   *
   * You can also pass in the full `FunctionArgs`.
   *
   * ```js
   * {
   *   issuer: {
   *     handler: "src/auth.handler",
   *     link: [table]
   *   }
   * }
   * ```
   *
   * Since the `issuer` function is a Hono app, you want to export it with the Lambda adapter.
   *
   * ```ts title="src/auth.ts"
   * import { handle } from "hono/aws-lambda";
   * import { issuer } from "@openauthjs/openauth";
   *
   * const app = issuer({
   *   // ...
   * });
   *
   * export const handler = handle(app);
   * ```
   *
   * This `Auth` component will always use the
   * [`DynamoStorage`](https://openauth.js.org/docs/storage/dynamo/) storage provider.
   *
   * :::note
   * This will always use the `DynamoStorage` storage provider.
   * :::
   *
   * Learn more on the [OpenAuth docs](https://openauth.js.org/docs/issuer/) on how to configure
   * the `issuer` function.
   */
  issuer?: Input<string | FunctionArgs>;
  /**
   * Set a custom domain for your Auth server.
   *
   * Automatically manages domains hosted on AWS Route 53, Cloudflare, and Vercel. For other
   * providers, you'll need to pass in a `cert` that validates domain ownership and add the
   * DNS records.
   *
   * :::tip
   * Built-in support for AWS Route 53, Cloudflare, and Vercel. And manual setup for other
   * providers.
   * :::
   *
   * @example
   *
   * By default this assumes the domain is hosted on Route 53.
   *
   * ```js
   * {
   *   domain: "auth.example.com"
   * }
   * ```
   *
   * For domains hosted on Cloudflare.
   *
   * ```js
   * {
   *   domain: {
   *     name: "auth.example.com",
   *     dns: sst.cloudflare.dns()
   *   }
   * }
   * ```
   */
  domain?: CdnArgs["domain"];
  /**
   * Force upgrade from `Auth.v1` to the latest `Auth` version. The only valid value
   * is `v2`, which is the version of the new `Auth`.
   *
   * The latest `Auth` is powered by [OpenAuth](https://openauth.js.org). To
   * upgrade, add the prop.
   *
   * ```ts
   * {
   *   forceUpgrade: "v2"
   * }
   * ```
   *
   * Run `sst deploy`.
   *
   * :::tip
   * You can remove this prop after you upgrade.
   * :::
   *
   * This upgrades your component and the resources it created. You can now optionally
   * remove the prop.
   *
   * @internal
   */
  forceUpgrade?: "v2";
}

/**
 * The `Auth` component lets you create centralized auth servers on AWS. It deploys
 * [OpenAuth](https://openauth.js.org) to [AWS Lambda](https://aws.amazon.com/lambda/)
 * and uses [Amazon DynamoDB](https://aws.amazon.com/dynamodb/) for storage.
 *
 * :::note
 * `Auth` and OpenAuth are currently in beta.
 * :::
 *
 * @example
 *
 * #### Create an OpenAuth server
 *
 * ```ts title="sst.config.ts"
 * const auth = new sst.aws.Auth("MyAuth", {
 *   issuer: "src/auth.handler"
 * });
 * ```
 *
 * Where the `issuer` function might look like this.
 *
 * ```ts title="src/auth.ts"
 * import { handle } from "hono/aws-lambda";
 * import { issuer } from "@openauthjs/openauth";
 * import { CodeProvider } from "@openauthjs/openauth/provider/code";
 * import { subjects } from "./subjects";
 *
 * const app = issuer({
 *   subjects,
 *   providers: {
 *     code: CodeProvider()
 *   },
 *   success: async (ctx, value) => {}
 * });
 *
 * export const handler = handle(app);
 * ```
 *
 * This `Auth` component will always use the
 * [`DynamoStorage`](https://openauth.js.org/docs/storage/dynamo/) storage provider.
 *
 * Learn more on the [OpenAuth docs](https://openauth.js.org/docs/issuer/) on how to configure
 * the `issuer` function.
 *
 * #### Add a custom domain
 *
 * Set a custom domain for your auth server.
 *
 * ```js {3} title="sst.config.ts"
 * new sst.aws.Auth("MyAuth", {
 *   issuer: "src/auth.handler",
 *   domain: "auth.example.com"
 * });
 * ```
 *
 * #### Link to a resource
 *
 * You can link the auth server to other resources, like a function or your Next.js app,
 * that needs authentication.
 *
 * ```ts title="sst.config.ts" {2}
 * new sst.aws.Nextjs("MyWeb", {
 *   link: [auth]
 * });
 * ```
 *
 * Once linked, you can now use it to create an [OpenAuth
 * client](https://openauth.js.org/docs/client/).
 *
 * ```ts title="app/page.tsx" {1,6}
 * import { Resource } from "sst"
 * import { createClient } from "@openauthjs/openauth/client"
 *
 * export const client = createClient({
 *   clientID: "nextjs",
 *   issuer: Resource.MyAuth.url
 * });
 * ```
 */
export class Auth extends Component implements Link.Linkable {
  private readonly _table: Dynamo;
  private readonly _issuer: Output<Function>;
  private readonly _router?: Router;
  public static v1 = AuthV1;

  constructor(name: string, args: AuthArgs, opts?: ComponentResourceOptions) {
    super(__pulumiType, name, args, opts);
    const _version = 2;
    const self = this;

    self.registerVersion({
      new: _version,
      old: $cli.state.version[name],
      message: [
        `There is a new version of "Auth" that has breaking changes.`,
        ``,
        `What changed:`,
        `  - The latest version is now powered by OpenAuth - https://openauth.js.org`,
        ``,
        `To upgrade:`,
        `  - Set \`forceUpgrade: "v${_version}"\` on the "Auth" component. Learn more https://sst.dev/docs/component/aws/auth#forceupgrade`,
        ``,
        `To continue using v${$cli.state.version[name]}:`,
        `  - Rename "Auth" to "Auth.v${$cli.state.version[name]}". Learn more about versioning - https://sst.dev/docs/components/#versioning`,
      ].join("\n"),
      forceUpgrade: args.forceUpgrade,
    });

    const table = createTable();
    const issuer = createIssuer();
    const router = createRouter();

    this._table = table;
    this._issuer = issuer;
    this._router = router;
    registerOutputs();

    function registerOutputs() {
      self.registerOutputs({
        _hint: self.url,
      });
    }

    function createTable() {
      return new Dynamo(
        `${name}Storage`,
        {
          fields: { pk: "string", sk: "string" },
          primaryIndex: { hashKey: "pk", rangeKey: "sk" },
          ttl: "expiry",
        },
        { parent: self },
      );
    }

    function createIssuer() {
      const fn = args.authorizer || args.issuer;
      if (!fn) throw new Error("Auth: issuer field must be set");
      return functionBuilder(
        `${name}Issuer`,
        fn,
        {
          link: [table],
          environment: {
            OPENAUTH_STORAGE: jsonStringify({
              type: "dynamo",
              options: { table: table.name },
            }),
          },
          _skipHint: true,
        },
        (args) => {
          args.url = {
            ...(typeof args.url === "object" ? args.url : {}),
            cors: false,
          };
        },
        { parent: self },
      ).apply((v) => v.getFunction());
    }

    function createRouter() {
      if (!args.domain) return;

      const router = new Router(
        `${name}Router`,
        {
          domain: args.domain,
          _skipHint: true,
        },
        { parent: self },
      );
      router.route("/", issuer.url);

      return router;
    }
  }

  /**
   * The URL of the Auth component.
   *
   * If the `domain` is set, this is the URL of the Router created for the custom domain.
   * If the `issuer` function is linked to a custom domain, this is the URL of the issuer.
   * Otherwise, it's the auto-generated function URL for the issuer.
   */
  public get url() {
    return (
      this._router?.url ??
      this._issuer.url.apply((v) => (v.endsWith("/") ? v.slice(0, -1) : v))
    );
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The DynamoDB component.
       */
      table: this._table,
      /**
       * The Function component for the issuer.
       */
      issuer: this._issuer,
      /**
       * @deprecated Use `issuer` instead.
       * The Function component for the issuer.
       */
      authorizer: this._issuer,
      /**
       * The Router component for the custom domain.
       */
      router: this._router,
    };
  }

  /** @internal */
  public getSSTLink() {
    return {
      properties: {
        url: this.url,
      },
      include: [
        env({
          OPENAUTH_ISSUER: this.url,
        }),
      ],
    };
  }
}

const __pulumiType = "sst:aws:Auth";
// @ts-expect-error
Auth.__pulumiType = __pulumiType;
