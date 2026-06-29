import { Schema } from "effect"
import { Assets } from "./install"

export class GitHubSource extends Schema.Class<GitHubSource>("Marketplace.GitHubSource")({
  type: Schema.Literal("github"),
  repo: Schema.String,
  ref: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
}) {}

export class GitLabSource extends Schema.Class<GitLabSource>("Marketplace.GitLabSource")({
  type: Schema.Literal("gitlab"),
  repo: Schema.String,
  ref: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
}) {}

export class UrlSource extends Schema.Class<UrlSource>("Marketplace.UrlSource")({
  type: Schema.Literal("url"),
  url: Schema.String,
}) {}

export class LocalSource extends Schema.Class<LocalSource>("Marketplace.LocalSource")({
  type: Schema.Literal("local"),
  path: Schema.String,
}) {}

export type Source = { type: string; repo?: string; url?: string; path?: string; ref?: string }

export class PackageEntry extends Schema.Class<PackageEntry>("Marketplace.PackageEntry")({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  source: Schema.Unknown,
}) {}

export class RegistryIndex extends Schema.Class<RegistryIndex>("Marketplace.RegistryIndex")({
  packages: Schema.Array(PackageEntry),
}) {}

export class InstalledPkg extends Schema.Class<InstalledPkg>("Marketplace.InstalledPkg")({
  name: Schema.String,
  version: Schema.optional(Schema.String),
  source: Schema.Unknown,
  sourceUrl: Schema.String,
  assets: Schema.optional(Assets),
  installedAt: Schema.Number,
}) {}

export type InstalledStore = Record<string, Schema.Schema.Type<typeof InstalledPkg>>

export const MARKETPLACE_META_FILE = "marketplace.json"
export const MARKETPLACE_CACHE_DIR = "marketplace"
