/**
 * The DNS Adapter lets you manage DNS records for domains hosted on different providers.
 *
 * @packageDocumentation
 */

import { ComponentResourceOptions, Output, Resource } from "@pulumi/pulumi";
import { Input } from "./input";

export interface Record {
  /**
   * The name of the record.
   */
  name: Input<string>;
  /**
   * The type of the record.
   */
  type: Input<string>;
  /**
   * The value of the record.
   */
  value: Input<string>;
}

export interface AliasRecord {
  /**
   * The name of the record.
   */
  name: Input<string>;
  /**
   * The domain name for the alias target.
   */
  aliasName: Input<string>;
  /**
   * The Route 53 hosted zone ID for the alias target.
   */
  aliasZone: Input<string>;
}

type CreateRecord = (
  namePrefix: string,
  record: Record,
  opts: ComponentResourceOptions,
) => Output<Resource>;

type CreateAliasRecord = (
  namePrefix: string,
  record: AliasRecord,
  opts: ComponentResourceOptions,
) => Output<Resource> | Output<Resource>[];

type CreateCaaRecord = (
  namePrefix: string,
  recordName: string,
  opts: ComponentResourceOptions,
) => Resource[] | Output<Resource>[] | undefined;

type AwsDns = {
  provider: "aws";
  createRecord: CreateRecord;
  createAlias: CreateAliasRecord;
  createCaa: CreateCaaRecord;
};

type CloudflareDns = {
  provider: "cloudflare";
  createRecord: CreateRecord;
  createAlias: CreateAliasRecord;
  createCaa: CreateCaaRecord;
};
type VercelDns = {
  provider: "vercel";
  createRecord: CreateRecord;
  createAlias: CreateAliasRecord;
  createCaa: CreateCaaRecord;
};

export type Dns = AwsDns | CloudflareDns | VercelDns;
