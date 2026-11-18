import {
  ComponentResourceOptions,
  Output,
  output,
  secret,
} from "@pulumi/pulumi";
import { Component, Transform } from "../component";
import { Link } from "../link";
import { WorkerArgs, Worker } from "./worker";
import { PrivateKey } from "@pulumi/tls";
import { BucketPolicyArgs } from "@pulumi/aws/s3";

export interface AuthArgs {
  authenticator: WorkerArgs;
  transform?: {
    bucketPolicy?: Transform<BucketPolicyArgs>;
  };
}

export class Auth extends Component implements Link.Linkable {
  private readonly _key: PrivateKey;
  private readonly _authenticator: Output<Worker>;

  constructor(name: string, args: AuthArgs, opts?: ComponentResourceOptions) {
    super(__pulumiType, name, args, opts);

    this._key = new PrivateKey(`${name}Keypair`, {
      algorithm: "RSA",
    });

    this._authenticator = output(args.authenticator).apply((args) => {
      return new Worker(`${name}Authenticator`, {
        ...args,
        url: true,
        environment: {
          ...args.environment,
          AUTH_PRIVATE_KEY: secret(this.key.privateKeyPemPkcs8),
          AUTH_PUBLIC_KEY: secret(this.key.publicKeyPem),
        },
      });
    });
  }

  public get key() {
    return this._key;
  }

  public get authenticator() {
    return this._authenticator;
  }

  public get url() {
    return this._authenticator.url!;
  }

  /** @internal */
  public getSSTLink(): Link.Definition {
    return {
      properties: {
        url: this._authenticator.url,
        publicKey: secret(this.key.publicKeyPem),
      },
    };
  }
}

const __pulumiType = "sst:cloudflare:Auth";
// @ts-expect-error
Auth.__pulumiType = __pulumiType;
