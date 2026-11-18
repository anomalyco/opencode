import { VisibleError } from "./error";
import { Output, output, secret } from "@pulumi/pulumi";
import { Link } from "./link";
import { Component, Prettify } from "./component";
import { Input } from "./input";

export class SecretMissingError extends VisibleError {
  constructor(public readonly secretName: string) {
    super(
      `Set a value for ${secretName} with \`sst secret set ${secretName} <value>\``,
    );
  }
}

/**
 * The `Secret` component lets you create secrets in your app.
 *
 * <VideoAside title="Watch a video on how secrets work" href="https://youtu.be/7tW2L3P6LKw" />
 *
 * Secrets are encrypted and stored in an S3 Bucket in your AWS account. If used in
 * your app config, they'll be encrypted in your state file as well. If used in
 * your function code, they are encrypted and included in the bundle. They are
 * then decrypted synchronously when your function starts up by the SST SDK.
 *
 * @example
 *
 * #### Create a secret
 *
 * The name of a secret follows the same rules as a component name. It must start with a capital letter and contain only letters and numbers.
 *
 * :::note
 * Secret names must start with a capital letter and contain only letters and numbers.
 * :::
 *
 * ```ts title="sst.config.ts"
 * const secret = new sst.Secret("MySecret");
 * ```
 *
 * #### Set a placeholder
 *
 * You can optionally set a `placeholder`.
 *
 * :::tip
 * Useful for cases where you might use a secret for values that aren't sensitive, so you can just set them in code.
 * :::
 *
 * ```ts title="sst.config.ts"
 * const secret = new sst.Secret("MySecret", "my-secret-placeholder-value");
 * ```
 *
 * #### Set the value of the secret
 *
 * You can then set the value of a secret using the [CLI](/docs/reference/cli/).
 *
 * ```sh title="Terminal"
 * sst secret set MySecret my-secret-value
 * ```
 *
 * :::note
 * If you are not running `sst dev`, you'll need to `sst deploy` to apply the secret.
 * :::
 *
 * #### Set a fallback for the secret
 *
 * You can set a _fallback_ value for the secret with the `--fallback` flag. If the secret is
 * not set for a stage, it'll use the fallback value instead.
 *
 * ```sh title="Terminal"
 * sst secret set MySecret my-fallback-value --fallback
 * ```
 *
 * This is useful for PR environments that are auto-deployed.
 *
 * #### Use the secret in your app config
 *
 * You can now use the secret in your app config.
 *
 * ```ts title="sst.config.ts"
 * console.log(mySecret.value);
 * ```
 *
 * This is an [Output](/docs/components#outputs) that can be used as an Input to other components.
 *
 * #### Link the secret to a resource
 *
 * You can link the secret to other resources, like a function or your Next.js app.
 *
 * ```ts title="sst.config.ts"
 * new sst.aws.Nextjs("MyWeb", {
 *   link: [secret]
 * });
 * ```
 *
 * Once linked, you can use the secret in your function code.
 *
 * ```ts title="app/page.tsx"
 * import { Resource } from "sst";
 *
 * console.log(Resource.MySecret.value);
 * ```
 */
export class Secret extends Component implements Link.Linkable {
  private _value: Output<string>;
  private _name: string;
  private _placeholder?: Output<string>;

  /**
   * @param placeholder A placeholder value of the secret. This can be useful for cases where you might not be storing sensitive values.

   */
  constructor(name: string, placeholder?: Input<string>) {
    super(
      "sst:sst:Secret",
      name,
      {
        placeholder,
      },
      {},
    );
    this._name = name;
    this._placeholder = placeholder ? output(placeholder) : undefined;
    this._value = output(
      process.env["SST_SECRET_" + this._name] ?? this._placeholder,
    ).apply((value) => {
      if (typeof value !== "string") {
        throw new SecretMissingError(this._name);
      }
      return value;
    });
  }

  /**
   * The name of the secret.
   */
  public get name() {
    return output(this._name);
  }

  /**
   * The value of the secret. It'll be `undefined` if the secret has not been set through the CLI or if the `placeholder` hasn't been set.
   */
  public get value() {
    return secret(this._value);
  }

  /**
   * The placeholder value of the secret.
   */
  public get placeholder() {
    return this._placeholder;
  }

  /** @internal */
  public getSSTLink() {
    return {
      properties: {
        value: this.value,
      },
    };
  }
}
