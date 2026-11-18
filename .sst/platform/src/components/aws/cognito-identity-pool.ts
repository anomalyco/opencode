import { ComponentResourceOptions, interpolate, output } from "@pulumi/pulumi";
import { Component, Transform, transform } from "../component";
import { FunctionArgs } from "./function.js";
import { Input } from "../input";
import { Link } from "../link";
import { cognito, getRegionOutput, iam } from "@pulumi/aws";
import { permission } from "./permission";
import { parseRoleArn } from "./helpers/arn";

export interface CognitoIdentityPoolArgs {
  /**
   * Configure Cognito User Pools as identity providers to your identity pool.
   * @example
   * ```ts
   * {
   *   userPools: [
   *     {
   *       userPool: "us-east-1_QY6Ly46JH",
   *       client: "6va5jg3cgtrd170sgokikjm5m6"
   *     }
   *   ]
   * }
   * ```
   */
  userPools?: Input<
    Input<{
      /**
       * The Cognito user pool ID.
       */
      userPool: Input<string>;
      /**
       * The Cognito User Pool client ID.
       */
      client: Input<string>;
    }>[]
  >;
  /**
   * The permissions to attach to the authenticated and unauthenticated roles.
   * This allows the authenticated and unauthenticated users to access other AWS resources.
   *
   * @example
   * ```js
   * {
   *   permissions: {
   *     authenticated: [
   *       {
   *         actions: ["s3:GetObject", "s3:PutObject"],
   *         resources: ["arn:aws:s3:::my-bucket/*"]
   *       }
   *     ],
   *     unauthenticated: [
   *       {
   *         actions: ["s3:GetObject"],
   *         resources: ["arn:aws:s3:::my-bucket/*"]
   *       }
   *     ]
   *   }
   * }
   * ```
   */
  permissions?: Input<{
    /**
     * Attaches the given list of permissions to the authenticated users.
     */
    authenticated?: FunctionArgs["permissions"];
    /**
     * Attaches the given list of permissions to the unauthenticated users.
     */
    unauthenticated?: FunctionArgs["permissions"];
  }>;
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the Cognito identity pool resource.
     */
    identityPool?: Transform<cognito.IdentityPoolArgs>;
    /**
     * Transform the authenticated IAM role resource.
     */
    authenticatedRole?: Transform<iam.RoleArgs>;
    /**
     * Transform the unauthenticated IAM role resource.
     */
    unauthenticatedRole?: Transform<iam.RoleArgs>;
  };
}

interface CognitoUserPoolRef {
  ref: boolean;
  identityPool: cognito.IdentityPool;
  authRole: iam.Role;
  unauthRole: iam.Role;
}

/**
 * The `CognitoIdentityPool` component lets you add a [Amazon Cognito identity pool](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-identity.html) to your app.
 *
 * #### Create the identity pool
 *
 * ```ts title="sst.config.ts"
 * new sst.aws.CognitoIdentityPool("MyIdentityPool", {
 *   userPools: [
 *     {
 *       userPool: "us-east-1_QY6Ly46JH",
 *       client: "6va5jg3cgtrd170sgokikjm5m6"
 *     }
 *   ]
 * });
 * ```
 *
 * #### Configure permissions for authenticated users
 *
 * ```ts title="sst.config.ts"
 * new sst.aws.CognitoIdentityPool("MyIdentityPool", {
 *   userPools: [
 *     {
 *       userPool: "us-east-1_QY6Ly46JH",
 *       client: "6va5jg3cgtrd170sgokikjm5m6"
 *     }
 *   ],
 *   permissions: {
 *     authenticated: [
 *       {
 *         actions: ["s3:GetObject", "s3:PutObject"],
 *         resources: ["arn:aws:s3:::my-bucket/*"]
 *       }
 *     ]
 *   }
 * });
 * ```
 */
export class CognitoIdentityPool extends Component implements Link.Linkable {
  private identityPool: cognito.IdentityPool;
  private authRole: iam.Role;
  private unauthRole: iam.Role;

  constructor(
    name: string,
    args: CognitoIdentityPoolArgs = {},
    opts?: ComponentResourceOptions,
  ) {
    super(__pulumiType, name, args, opts);

    if (args && "ref" in args) {
      const ref = args as unknown as CognitoUserPoolRef;
      this.identityPool = ref.identityPool;
      this.authRole = ref.authRole;
      this.unauthRole = ref.unauthRole;
      return;
    }

    const parent = this;

    const region = getRegion();
    const identityPool = createIdentityPool();
    const authRole = createAuthRole();
    const unauthRole = createUnauthRole();
    createRoleAttachment();

    this.identityPool = identityPool;
    this.authRole = authRole;
    this.unauthRole = unauthRole;

    function getRegion() {
      return getRegionOutput(undefined, { parent }).name;
    }

    function createIdentityPool() {
      return new cognito.IdentityPool(
        ...transform(
          args.transform?.identityPool,
          `${name}IdentityPool`,
          {
            identityPoolName: "",
            allowUnauthenticatedIdentities: true,
            cognitoIdentityProviders:
              args.userPools &&
              output(args.userPools).apply((userPools) =>
                userPools.map((v) => ({
                  clientId: v.client,
                  providerName: interpolate`cognito-idp.${region}.amazonaws.com/${v.userPool}`,
                })),
              ),
            supportedLoginProviders: {},
          },
          { parent },
        ),
      );
    }

    function createAuthRole() {
      const policy = output(args.permissions).apply((permissions) =>
        iam.getPolicyDocumentOutput({
          statements: [
            {
              effect: "Allow",
              actions: [
                "mobileanalytics:PutEvents",
                "cognito-sync:*",
                "cognito-identity:*",
              ],
              resources: ["*"],
            },
            ...(permissions?.authenticated || []),
          ],
        }),
      );

      return new iam.Role(
        ...transform(
          args.transform?.authenticatedRole,
          `${name}AuthRole`,
          {
            assumeRolePolicy: iam.getPolicyDocumentOutput({
              statements: [
                {
                  effect: "Allow",
                  principals: [
                    {
                      type: "Federated",
                      identifiers: ["cognito-identity.amazonaws.com"],
                    },
                  ],
                  actions: ["sts:AssumeRoleWithWebIdentity"],
                  conditions: [
                    {
                      test: "StringEquals",
                      variable: "cognito-identity.amazonaws.com:aud",
                      values: [identityPool.id],
                    },
                    {
                      test: "ForAnyValue:StringLike",
                      variable: "cognito-identity.amazonaws.com:amr",
                      values: ["authenticated"],
                    },
                  ],
                },
              ],
            }).json,
            inlinePolicies: [{ name: "inline", policy: policy.json }],
          },
          { parent },
        ),
      );
    }

    function createUnauthRole() {
      const policy = output(args.permissions).apply((permissions) =>
        iam.getPolicyDocumentOutput({
          statements: [
            {
              effect: "Allow",
              actions: ["mobileanalytics:PutEvents", "cognito-sync:*"],
              resources: ["*"],
            },
            ...(permissions?.unauthenticated || []),
          ],
        }),
      );

      return new iam.Role(
        ...transform(
          args.transform?.unauthenticatedRole,
          `${name}UnauthRole`,
          {
            assumeRolePolicy: iam.getPolicyDocumentOutput({
              statements: [
                {
                  effect: "Allow",
                  principals: [
                    {
                      type: "Federated",
                      identifiers: ["cognito-identity.amazonaws.com"],
                    },
                  ],
                  actions: ["sts:AssumeRoleWithWebIdentity"],
                  conditions: [
                    {
                      test: "StringEquals",
                      variable: "cognito-identity.amazonaws.com:aud",
                      values: [identityPool.id],
                    },
                    {
                      test: "ForAnyValue:StringLike",
                      variable: "cognito-identity.amazonaws.com:amr",
                      values: ["unauthenticated"],
                    },
                  ],
                },
              ],
            }).json,
            inlinePolicies: [{ name: "inline", policy: policy.json }],
          },
          { parent },
        ),
      );
    }

    function createRoleAttachment() {
      return new cognito.IdentityPoolRoleAttachment(
        `${name}RoleAttachment`,
        {
          identityPoolId: identityPool.id,
          roles: {
            authenticated: authRole.arn,
            unauthenticated: unauthRole.arn,
          },
        },
        { parent },
      );
    }
  }

  /**
   * The Cognito identity pool ID.
   */
  public get id() {
    return this.identityPool.id;
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The Amazon Cognito identity pool.
       */
      identityPool: this.identityPool,
      /**
       * The authenticated IAM role.
       */
      authenticatedRole: this.authRole,
      /**
       * The unauthenticated IAM role.
       */
      unauthenticatedRole: this.unauthRole,
    };
  }

  /** @internal */
  public getSSTLink() {
    return {
      properties: {
        id: this.id,
      },
      include: [
        permission({
          actions: ["cognito-identity:*"],
          resources: [this.identityPool.arn],
        }),
      ],
    };
  }

  /**
   * Reference an existing Identity Pool with the given ID. This is useful when you
   * create a Identity Pool in one stage and want to share it in another. It avoids having to
   * create a new Identity Pool in the other stage.
   *
   * :::tip
   * You can use the `static get` method to share Identity Pools across stages.
   * :::
   *
   * @param name The name of the component.
   * @param identityPoolID The ID of the existing Identity Pool.
   * @param opts? Resource options.
   *
   * @example
   * Imagine you create a Identity Pool in the `dev` stage. And in your personal stage `frank`,
   * instead of creating a new pool, you want to share the same pool from `dev`.
   *
   * ```ts title="sst.config.ts"
   * const identityPool = $app.stage === "frank"
   *   ? sst.aws.CognitoIdentityPool.get("MyIdentityPool", "us-east-1:02facf30-e2f3-49ec-9e79-c55187415cf8")
   *   : new sst.aws.CognitoIdentityPool("MyIdentityPool");
   * ```
   *
   * Here `us-east-1:02facf30-e2f3-49ec-9e79-c55187415cf8` is the ID of the Identity Pool created in the `dev` stage.
   * You can find this by outputting the Identity Pool ID in the `dev` stage.
   *
   * ```ts title="sst.config.ts"
   * return {
   *   identityPool: identityPool.id
   * };
   * ```
   */
  public static get(
    name: string,
    identityPoolID: Input<string>,
    opts?: ComponentResourceOptions,
  ) {
    const identityPool = cognito.IdentityPool.get(
      `${name}IdentityPool`,
      identityPoolID,
      undefined,
      opts,
    );
    const attachment = cognito.IdentityPoolRoleAttachment.get(
      `${name}RoleAttachment`,
      identityPoolID,
      undefined,
      opts,
    );
    const authRole = iam.Role.get(
      `${name}AuthRole`,
      attachment.roles.authenticated.apply((arn) => parseRoleArn(arn).roleName),
      undefined,
      opts,
    );
    const unauthRole = iam.Role.get(
      `${name}UnauthRole`,
      attachment.roles.unauthenticated.apply(
        (arn) => parseRoleArn(arn).roleName,
      ),
      undefined,
      opts,
    );
    return new CognitoIdentityPool(name, {
      ref: true,
      identityPool,
      authRole,
      unauthRole,
    } as unknown as CognitoIdentityPoolArgs);
  }
}

const __pulumiType = "sst:aws:CognitoIdentityPool";
// @ts-expect-error
CognitoIdentityPool.__pulumiType = __pulumiType;
