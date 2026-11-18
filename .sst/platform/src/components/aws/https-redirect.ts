import { ComponentResourceOptions, all, output } from "@pulumi/pulumi";
import { DnsValidatedCertificate } from "./dns-validated-certificate.js";
import { Bucket } from "./bucket.js";
import { Component } from "../component.js";
import { useProvider } from "./helpers/provider.js";
import { Input } from "../input.js";
import { Dns } from "../dns.js";
import { cloudfront, s3 } from "@pulumi/aws";
import { CF_BLOCK_CLOUDFRONT_URL_INJECTION } from "./router.js";

/**
 * Properties to configure an HTTPS Redirect
 */
export interface HttpsRedirectArgs {
  /**
   * The redirect target fully qualified domain name (FQDN). An alias record
   * will be created that points to your CloudFront distribution. Root domain
   * or sub-domain can be supplied.
   */
  targetDomain: Input<string>;
  /**
   * The domain names that will redirect to `targetDomain`
   *
   * @default Domain name of the hosted zone
   */
  sourceDomains: Input<string[]>;
  /**
   * The ARN of an ACM (AWS Certificate Manager) certificate that proves ownership of the
   * domain. By default, a certificate is created and validated automatically.
   */
  cert?: Input<string>;
  /**
   * The DNS adapter you want to use for managing DNS records.
   */
  dns?: Input<Dns & {}>;
}

/**
 * Allows creating a domainA -> domainB redirect using CloudFront and S3.
 * You can specify multiple domains to be redirected.
 */
export class HttpsRedirect extends Component {
  constructor(
    name: string,
    args: HttpsRedirectArgs,
    opts?: ComponentResourceOptions,
  ) {
    super(__pulumiType, name, args, opts);

    const parent = this;

    validateArgs();
    const certificateArn = createSsl();
    const bucket = createBucket();
    const bucketWebsite = createBucketWebsite();
    const distribution = createDistribution();
    createDnsRecords();

    function validateArgs() {
      if (!args.dns && !args.cert)
        throw new Error(
          `Need to provide a validated certificate via "cert" when DNS is disabled`,
        );
    }

    function createSsl() {
      if (args.cert) return args.cert;

      return new DnsValidatedCertificate(
        `${name}Ssl`,
        {
          domainName: output(args.sourceDomains).apply((domains) => domains[0]),
          alternativeNames: output(args.sourceDomains).apply((domains) =>
            domains.slice(1),
          ),
          dns: args.dns!,
        },
        { parent, provider: useProvider("us-east-1") },
      ).arn;
    }

    function createBucket() {
      return new Bucket(`${name}Bucket`, {}, { parent });
    }

    function createBucketWebsite() {
      return new s3.BucketWebsiteConfigurationV2(
        `${name}BucketWebsite`,
        {
          bucket: bucket.name,
          redirectAllRequestsTo: {
            hostName: args.targetDomain,
            protocol: "https",
          },
        },
        { parent },
      );
    }

    function createDistribution() {
      return new cloudfront.Distribution(
        `${name}Distribution`,
        {
          enabled: true,
          waitForDeployment: false,
          aliases: args.sourceDomains,
          restrictions: {
            geoRestriction: {
              restrictionType: "none",
            },
          },
          comment: all([args.targetDomain, args.sourceDomains]).apply(
            ([targetDomain, sourceDomains]) => {
              const comment = `Redirect to ${targetDomain} from ${sourceDomains.join(
                ", ",
              )}`;
              return comment.length > 128
                ? comment.slice(0, 125) + "..."
                : comment;
            },
          ),
          priceClass: "PriceClass_All",
          viewerCertificate: {
            acmCertificateArn: certificateArn,
            sslSupportMethod: "sni-only",
          },
          defaultCacheBehavior: {
            allowedMethods: ["GET", "HEAD", "OPTIONS"],
            targetOriginId: "s3Origin",
            viewerProtocolPolicy: "redirect-to-https",
            cachedMethods: ["GET", "HEAD"],
            forwardedValues: {
              cookies: { forward: "none" },
              queryString: false,
            },
            functionAssociations: [
              {
                eventType: "viewer-request",
                functionArn: new cloudfront.Function(
                  `${name}CloudfrontFunctionRequest`,
                  {
                    runtime: "cloudfront-js-2.0",
                    code: `
import cf from "cloudfront";
async function handler(event) {
  ${CF_BLOCK_CLOUDFRONT_URL_INJECTION}
  return event.request;
}`,
                  },
                ).arn,
              },
            ],
          },
          origins: [
            {
              originId: "s3Origin",
              domainName: bucketWebsite.websiteEndpoint,
              customOriginConfig: {
                httpPort: 80,
                httpsPort: 443,
                originProtocolPolicy: "http-only",
                originSslProtocols: ["TLSv1.2"],
              },
            },
          ],
        },
        { parent },
      );
    }

    function createDnsRecords() {
      if (!args.dns) return;

      all([args.dns, args.sourceDomains]).apply(([dns, sourceDomains]) => {
        for (const recordName of sourceDomains) {
          dns.createAlias(
            name,
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
  }
}

const __pulumiType = "sst:aws:HttpsRedirect";
// @ts-expect-error
HttpsRedirect.__pulumiType = __pulumiType;
