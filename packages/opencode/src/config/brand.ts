import { AgentBrand } from "@yunpat/core/brand"
import { Schema } from "effect"
import { withStatics } from "@/util/schema"

export { AgentBrand }

export const BrandConfig = Schema.Struct({
  name: Schema.String,
  nameEn: Schema.String,
  tagline: Schema.String,
  appId: Schema.Struct({
    mac: Schema.Struct({
      dev: Schema.String,
      beta: Schema.String,
      prod: Schema.String,
    }),
    win: Schema.Struct({
      dev: Schema.String,
      beta: Schema.String,
      prod: Schema.String,
    }),
  }),
  urlScheme: Schema.String,
  projectDir: Schema.String,
  configBasename: Schema.String,
  theme: Schema.Struct({
    primaryColor: Schema.String,
    logoPath: Schema.optional(Schema.String),
    iconPath: Schema.optional(Schema.String),
  }),
  popularProviders: Schema.Array(Schema.String),
  defaultEnabledProviders: Schema.Array(Schema.String),
}).pipe(withStatics(() => ({})))
export type BrandConfig = Schema.Schema.Type<typeof BrandConfig>

export const YUNPAT: BrandConfig = {
  name: AgentBrand.nameZh,
  nameEn: AgentBrand.nameEn,
  tagline: "知识产权全生命周期智能体平台",
  appId: {
    mac: {
      dev: `${AgentBrand.macBundleId}.dev`,
      beta: `${AgentBrand.macBundleId}.beta`,
      prod: AgentBrand.macBundleId,
    },
    win: {
      dev: "YunPat.Agent.Dev",
      beta: "YunPat.Agent.Beta",
      prod: "YunPat.Agent",
    },
  },
  urlScheme: AgentBrand.urlScheme,
  projectDir: AgentBrand.projectDir,
  configBasename: AgentBrand.configBasename,
  theme: {
    primaryColor: "#2563EB",
    logoPath: "packages/ui/src/assets/brand/hero-lg.webp",
    iconPath: "packages/ui/src/assets/brand/mark-96.png",
  },
  popularProviders: [...AgentBrand.popularProviders],
  defaultEnabledProviders: [...AgentBrand.defaultEnabledProviders],
}

export * as ConfigBrand from "./brand"
