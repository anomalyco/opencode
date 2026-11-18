/**
 * The AWS DNS Adapter is used to create DNS records to manage domains hosted on
 * [Route 53](https://aws.amazon.com/route53/).
 *
 * This adapter is passed in as `domain.dns` when setting a custom domain.
 *
 * @example
 *
 * ```ts
 * {
 *   domain: {
 *     name: "example.com",
 *     dns: sst.aws.dns()
 *   }
 * }
 * ```
 *
 * You can also specify a hosted zone ID if you have multiple hosted zones with the same domain.
 *
 * ```ts
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
 * @packageDocumentation
 */

import { AliasRecord, Dns, Record } from "../dns";
import { logicalName } from "../naming";
import { HostedZoneLookup } from "./providers/hosted-zone-lookup";
import { ComponentResourceOptions, output } from "@pulumi/pulumi";
import { Transform, transform } from "../component";
import { Input } from "../input";
import { route53 } from "@pulumi/aws";
import { VisibleError } from "../error";

export interface DnsArgs {
  /**
   * Set the hosted zone ID if you have multiple hosted zones that have the same
   * domain in Route 53.
   *
   * The 14 letter ID of the [Route 53 hosted zone](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/hosted-zones-working-with.html) that contains the `domainName`. You can find the hosted zone ID in the Route 53 part of the AWS Console.
   *
   * @example
   * ```js
   * {
   *   zone: "Z2FDTNDATAQYW2"
   * }
   * ```
   */
  zone?: Input<string>;
  /**
   * Set to `true` if you want to let the new DNS records replace the existing ones.
   *
   * :::tip
   * Use this to migrate over your domain without any downtime.
   * :::
   *
   * This is useful if your domain is currently used by another app and you want to switch it
   * to your current app. Without setting this, you'll first have to remove the existing DNS
   * records and then add the new one. This can cause downtime.
   *
   * You can avoid this by setting this to `true` and the existing DNS records will be replaced
   * without any downtime. Just make sure that when you remove your old app, you don't remove
   * the DNS records.
   *
   * @default `false`
   * @example
   * ```js
   * {
   *   override: true
   * }
   * ```
   */
  override?: Input<boolean>;
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the AWS Route 53 record resource.
     */
    record?: Transform<route53.RecordArgs>;
  };
}

export function dns(args: DnsArgs = {}) {
  return {
    provider: "aws",
    createAlias,
    createCaa,
    createRecord,
  } satisfies Dns;

  /**
   * Creates alias records in the hosted zone.
   *
   * @param namePrefix The prefix to use for the resource names.
   * @param record The alias record to create.
   * @param opts The component resource options.
   */
  function createAlias(
    namePrefix: string,
    record: AliasRecord,
    opts: ComponentResourceOptions,
  ) {
    return ["A", "AAAA"].map((type) =>
      _createRecord(
        namePrefix,
        {
          type,
          name: record.name,
          aliases: [
            {
              name: record.aliasName,
              zoneId: record.aliasZone,
              evaluateTargetHealth: true,
            },
          ],
        },
        opts,
      ),
    );
  }

  function createCaa(
    namePrefix: string,
    recordName: string,
    opts: ComponentResourceOptions,
  ) {
    // placeholder
    return undefined;
  }

  /**
   * Creates a DNS record in the hosted zone.
   *
   * @param namePrefix The prefix to use for the resource names.
   * @param record The DNS record to create.
   * @param opts The component resource options.
   */
  function createRecord(
    namePrefix: string,
    record: Record,
    opts: ComponentResourceOptions,
  ) {
    return _createRecord(
      namePrefix,
      {
        type: record.type,
        name: record.name,
        ttl: 60,
        records: [record.value],
      },
      opts,
    );
  }

  function _createRecord(
    namePrefix: string,
    partial: Omit<route53.RecordArgs, "zoneId">,
    opts: ComponentResourceOptions,
  ) {
    return output(partial).apply((partial) => {
      const nameSuffix = logicalName(partial.name);
      const zoneId = lookupZone();
      const dnsRecord = createRecord();
      return dnsRecord;

      function lookupZone() {
        if (args.zone) {
          return output(args.zone).apply(async (zoneId) => {
            const zone = await route53.getZone({ zoneId });
            if (!partial.name.replace(/\.$/, "").endsWith(zone.name)) {
              throw new VisibleError(
                `The DNS record "${partial.name}" cannot be created because the domain name does not match the hosted zone "${zone.name}" (${zoneId}).`,
              );
            }
            return zoneId;
          });
        }

        return new HostedZoneLookup(
          `${namePrefix}${partial.type}ZoneLookup${nameSuffix}`,
          {
            domain: output(partial.name!).apply((name) =>
              name.replace(/\.$/, ""),
            ),
          },
          opts,
        ).zoneId;
      }

      function createRecord() {
        return new route53.Record(
          ...transform(
            args.transform?.record,
            `${namePrefix}${partial.type}Record${nameSuffix}`,
            {
              zoneId,
              allowOverwrite: args.override,
              ...partial,
            },
            opts,
          ),
        );
      }
    });
  }
}
