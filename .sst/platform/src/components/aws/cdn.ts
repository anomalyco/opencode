import {
  Output,
  ComponentResourceOptions,
  output,
  interpolate,
  all,
} from "@pulumi/pulumi";
import { DnsValidatedCertificate } from "./dns-validated-certificate.js";
import { HttpsRedirect } from "./https-redirect.js";
import { useProvider } from "./helpers/provider.js";
import { Component, Prettify, Transform, transform } from "../component.js";
import { Input } from "../input.js";
import { DistributionDeploymentWaiter } from "./providers/distribution-deployment-waiter.js";
import { Dns } from "../dns.js";
import { dns as awsDns } from "./dns.js";
import { cloudfront } from "@pulumi/aws";
import { logicalName } from "../naming.js";

export interface CdnDomainArgs {
  /**
   * The custom domain you want to use.
   *
   * @example
   * ```js
   * {
   *   domain: {
   *     name: "example.com"
   *   }
   * }
   * ```
   *
   * Can also include subdomains based on the current stage.
   *
   * ```js
   * {
   *   domain: {
   *     name: `${$app.stage}.example.com`
   *   }
   * }
   * ```
   */
  name: Input<string>;
  /**
   * Alternate domains to be used. Visitors to the alternate domains will be redirected to the
   * main `name`.
   *
   * :::note
   * Unlike the `aliases` option, this will redirect visitors back to the main `name`.
   * :::
   *
   * @example
   * Use this to create a `www.` version of your domain and redirect visitors to the apex domain.
   * ```js {4}
   * {
   *   domain: {
   *     name: "domain.com",
   *     redirects: ["www.domain.com"]
   *   }
   * }
   * ```
   */
  redirects?: Input<string[]>;
  /**
   * Alias domains that should be used. Unlike the `redirect` option, this keeps your visitors
   * on this alias domain.
   *
   * @example
   * So if your users visit `app2.domain.com`, they will stay on `app2.domain.com` in their
   * browser.
   * ```js {4}
   * {
   *   domain: {
   *     name: "app1.domain.com",
   *     aliases: ["app2.domain.com"]
   *   }
   * }
   * ```
   */
  aliases?: Input<string[]>;
  /**
   * The ARN of an ACM (AWS Certificate Manager) certificate that proves ownership of the
   * domain. By default, a certificate is created and validated automatically.
   *
   * The certificate will be created in the `us-east-1` region as required by AWS CloudFront.
   * If you are creating your own certificate, you must also create it in `us-east-1`.
   *
   * :::tip
   * You need to pass in a `cert` for domains that are not hosted on supported `dns` providers.
   * :::
   *
   * To manually set up a domain on an unsupported provider, you'll need to:
   *
   * 1. [Validate that you own the domain](https://docs.aws.amazon.com/acm/latest/userguide/domain-ownership-validation.html) by creating an ACM certificate. You can either validate it by setting a DNS record or by verifying an email sent to the domain owner.
   * 2. Once validated, set the certificate ARN as the `cert` and set `dns` to `false`.
   * 3. Add the DNS records in your provider to point to the CloudFront distribution URL.
   *
   * @example
   * ```js
   * {
   *   domain: {
   *     name: "domain.com",
   *     dns: false,
   *     cert: "arn:aws:acm:us-east-1:112233445566:certificate/3a958790-8878-4cdc-a396-06d95064cf63"
   *   }
   * }
   * ```
   */
  cert?: Input<string>;
  /**
   * The DNS provider to use for the domain. Defaults to the AWS.
   *
   * Takes an adapter that can create the DNS records on the provider. This can automate
   * validating the domain and setting up the DNS routing.
   *
   * Supports Route 53, Cloudflare, and Vercel adapters. For other providers, you'll need
   * to set `dns` to `false` and pass in a certificate validating ownership via `cert`.
   *
   * @default `sst.aws.dns`
   *
   * @example
   *
   * Specify the hosted zone ID for the Route 53 domain.
   *
   * ```js
   * {
   *   domain: {
   *     name: "example.com",
   *     dns: sst.aws.dns({
   *       zone: "Z2FDTNDATAQYW2"
   *     })
   *   }
   * }
   * ```
   *
   * Use a domain hosted on Cloudflare, needs the Cloudflare provider.
   *
   * ```js
   * {
   *   domain: {
   *     name: "example.com",
   *     dns: sst.cloudflare.dns()
   *   }
   * }
   * ```
   *
   * Use a domain hosted on Vercel, needs the Vercel provider.
   *
   * ```js
   * {
   *   domain: {
   *     name: "example.com",
   *     dns: sst.vercel.dns()
   *   }
   * }
   * ```
   */
  dns?: Input<false | (Dns & {})>;
}

export interface CdnArgs {
  /**
   * A comment to describe the distribution. It cannot be longer than 128 characters.
   */
  comment?: Input<string>;
  /**
   * One or more origins for this distribution.
   */
  origins: cloudfront.DistributionArgs["origins"];
  /**
   * One or more origin groups for this distribution.
   */
  originGroups?: cloudfront.DistributionArgs["originGroups"];
  /**
   * The default cache behavior for this distribution.
   */
  defaultCacheBehavior: cloudfront.DistributionArgs["defaultCacheBehavior"];
  /**
   * An ordered list of cache behaviors for this distribution. Listed in order of precedence. The first cache behavior will have precedence 0.
   */
  orderedCacheBehaviors?: cloudfront.DistributionArgs["orderedCacheBehaviors"];
  /**
   * An object you want CloudFront to return when a user requests the root URL. For example, the `index.html`.
   */
  defaultRootObject?: cloudfront.DistributionArgs["defaultRootObject"];
  /**
   * One or more custom error responses.
   */
  customErrorResponses?: cloudfront.DistributionArgs["customErrorResponses"];
  /**
   * Set a custom domain for your distribution.
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
   *   domain: "example.com"
   * }
   * ```
   *
   * For domains hosted on Cloudflare.
   *
   * ```js
   * {
   *   domain: {
   *     name: "example.com",
   *     dns: sst.cloudflare.dns()
   *   }
   * }
   * ```
   *
   * Specify a `www.` version of the custom domain.
   *
   * ```js
   * {
   *   domain: {
   *     name: "domain.com",
   *     redirects: ["www.domain.com"]
   *   }
   * }
   * ```
   */
  domain?: Input<string | Prettify<CdnDomainArgs>>;
  /**
   * Whether to wait for the CloudFront distribution to be deployed before
   * completing the deployment of the app. This is necessary if you need to use the
   * distribution URL in other resources.
   * @default `true`
   */
  wait?: Input<boolean>;
  /**
   * Tags to apply to the distribution.
   */
  tags?: Input<Record<string, Input<string>>>;
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying resources.
   */
  transform?: {
    /**
     * Transform the CloudFront distribution resource.
     */
    distribution: Transform<cloudfront.DistributionArgs>;
  };
}

interface CdnRef {
  ref: boolean;
  distributionID: Input<string>;
}

/**
 * The `Cdn` component is internally used by other components to deploy a CDN to AWS. It uses [Amazon CloudFront](https://aws.amazon.com/cloudfront/) and [Amazon Route 53](https://aws.amazon.com/route53/) to manage custom domains.
 *
 * :::note
 * This component is not intended to be created directly.
 * :::
 *
 * @example
 *
 * You'll find this component exposed in the `transform` of other components. And you can customize the args listed here. For example:
 *
 * ```ts title="sst.config.ts"
 * new sst.aws.Nextjs("MyWeb", {
 *   transform: {
 *     cdn: (args) => {
 *       args.wait = false;
 *     }
 *   }
 * });
 * ```
 */
export class Cdn extends Component {
  private distribution: Output<cloudfront.Distribution>;
  private _domainUrl: Output<string | undefined>;

  constructor(name: string, args: CdnArgs, opts?: ComponentResourceOptions) {
    super(pulumiType, name, args, opts);
    const parent = this;

    if (args && "ref" in args) {
      const ref = reference();
      this.distribution = output(ref.distribution);
      this._domainUrl = ref.distribution.aliases.apply((aliases) =>
        aliases?.length ? `https://${aliases[0]}` : undefined,
      );
      return;
    }

    const domain = normalizeDomain();

    const certificateArn = createSsl();
    const distribution = createDistribution();
    const waiter = createDistributionDeploymentWaiter();
    createDnsRecords();
    createRedirects();

    this.distribution = waiter.isDone.apply(() => distribution);
    this._domainUrl = domain?.name
      ? interpolate`https://${domain.name}`
      : output(undefined);

    function reference() {
      const ref = args as unknown as CdnRef;
      const distribution = cloudfront.Distribution.get(
        `${name}Distribution`,
        ref.distributionID,
        undefined,
        { parent },
      );

      return { distribution };
    }

    function normalizeDomain() {
      if (!args.domain) return;

      return output(args.domain).apply((domain) => {
        const norm = typeof domain === "string" ? { name: domain } : domain;

        // validate
        if (!norm.name) throw new Error(`Missing "name" for domain.`);
        if (norm.dns === false && !norm.cert)
          throw new Error(
            `Need to provide a validated certificate via "cert" when DNS is disabled`,
          );

        return {
          name: norm.name,
          aliases: norm.aliases ?? [],
          redirects: norm.redirects ?? [],
          dns: norm.dns === false ? undefined : norm.dns ?? awsDns(),
          cert: norm.cert,
        };
      });
    }

    function createSsl() {
      if (!domain) return output(undefined);

      return domain.cert.apply((cert) => {
        if (cert) return domain.cert;

        // Certificates used for CloudFront distributions are required to be
        // created in the us-east-1 region
        return new DnsValidatedCertificate(
          `${name}Ssl`,
          {
            domainName: domain.name,
            alternativeNames: domain.aliases,
            dns: domain.dns.apply((dns) => dns!),
          },
          { parent, provider: useProvider("us-east-1") },
        ).arn;
      });
    }

    function createDistribution() {
      return new cloudfront.Distribution(
        ...transform(
          args.transform?.distribution,
          `${name}Distribution`,
          {
            comment: args.comment,
            enabled: true,
            origins: args.origins,
            originGroups: args.originGroups,
            defaultCacheBehavior: args.defaultCacheBehavior,
            orderedCacheBehaviors: args.orderedCacheBehaviors,
            defaultRootObject: args.defaultRootObject,
            customErrorResponses: args.customErrorResponses,
            restrictions: {
              geoRestriction: {
                restrictionType: "none",
              },
            },
            aliases: domain
              ? output(domain).apply((domain) => [
                  domain.name,
                  ...domain.aliases,
                ])
              : [],
            viewerCertificate: certificateArn.apply((arn) =>
              arn
                ? {
                    acmCertificateArn: arn,
                    sslSupportMethod: "sni-only",
                    minimumProtocolVersion: "TLSv1.2_2021",
                  }
                : {
                    cloudfrontDefaultCertificate: true,
                  },
            ),
            waitForDeployment: false,
            tags: args.tags,
          },
          { parent },
        ),
      );
    }

    function createDistributionDeploymentWaiter() {
      return output(args.wait).apply((wait) => {
        return new DistributionDeploymentWaiter(
          `${name}Waiter`,
          {
            distributionId: distribution.id,
            etag: distribution.etag,
            wait: wait ?? true,
          },
          { parent, ignoreChanges: wait ? undefined : ["*"] },
        );
      });
    }

    function createDnsRecords() {
      if (!domain) return;

      domain.apply((domain) => {
        if (!domain.dns) return;

        const existing: string[] = [];
        for (const [i, recordName] of [
          domain.name,
          ...domain.aliases,
        ].entries()) {
          // Note: The way `dns` is implemented, the logical name for the DNS record is
          // based on the sanitized version of the record name (ie. logicalName()). This
          // means the logical name for `*.sst.sh` and `sst.sh` will trash b/c `*.` is
          // stripped out.
          // ```
          // domain: {
          //   name: "*.sst.sh",
          //   aliases: ['sst.sh'],
          // },
          // ```
          //
          // Ideally, we don't sanitize the logical name. But that's a breaking change.
          //
          // As a workaround, starting v3.0.79, we prefix the logical name with a unique
          // index for records with logical names that will trash.
          const key = logicalName(recordName);
          const namePrefix = existing.includes(key) ? `${name}${i}` : name;
          existing.push(key);

          domain.dns.createAlias(
            namePrefix,
            {
              name: recordName,
              aliasName: distribution.domainName,
              aliasZone: distribution.hostedZoneId,
            },
            { parent },
          );
        }
      });
    }

    function createRedirects(): void {
      if (!domain) return;

      all([domain.cert, domain.redirects, domain.dns]).apply(
        ([cert, redirects, dns]) => {
          if (!redirects.length) return;

          new HttpsRedirect(
            `${name}Redirect`,
            {
              sourceDomains: redirects,
              targetDomain: domain.name,
              cert: cert ? domain.cert.apply((cert) => cert!) : undefined,
              dns: dns ? domain.dns.apply((dns) => dns!) : undefined,
            },
            { parent },
          );
        },
      );
    }
  }

  /**
   * The CloudFront URL of the distribution.
   */
  public get url() {
    return interpolate`https://${this.distribution.domainName}`;
  }

  /**
   * If the custom domain is enabled, this is the URL of the distribution with the
   * custom domain.
   */
  public get domainUrl() {
    return this._domainUrl;
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The Amazon CloudFront distribution.
       */
      distribution: this.distribution,
    };
  }

  /**
   * Reference an existing CDN with the given distribution ID. This is useful when
   * you create a Router in one stage and want to share it in another. It avoids having to
   * create a new Router in the other stage.
   *
   * :::tip
   * You can use the `static get` method to share Routers across stages.
   * :::
   *
   * @param name The name of the component.
   * @param distributionID The id of the existing CDN distribution.
   * @param opts? Resource options.
   */
  public static get(
    name: string,
    distributionID: Input<string>,
    opts?: ComponentResourceOptions,
  ) {
    return new Cdn(
      name,
      {
        ref: true,
        distributionID,
      } satisfies CdnRef as unknown as CdnArgs,
      opts,
    );
  }
}

const pulumiType = "sst:aws:CDN";
// @ts-expect-error
Cdn.__pulumiType = pulumiType;
