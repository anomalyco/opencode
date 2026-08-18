export type Profile = "default" | "bare"

export type Policy = {
  readonly profile: Profile
  readonly config: {
    readonly wellKnown: boolean
    readonly global: boolean
    readonly project: boolean
    readonly configDirectory: boolean
  }
  readonly discovery: {
    readonly externalPlugins: boolean
    readonly externalSkills: boolean
    readonly automaticInstructions: boolean
  }
  readonly startup: {
    readonly installConfigDependencies: boolean
    readonly lsp: boolean
  }
}

const policies: Record<Profile, Policy> = {
  default: {
    profile: "default",
    config: {
      wellKnown: true,
      global: true,
      project: true,
      configDirectory: true,
    },
    discovery: {
      externalPlugins: true,
      externalSkills: true,
      automaticInstructions: true,
    },
    startup: {
      installConfigDependencies: true,
      lsp: true,
    },
  },
  bare: {
    profile: "bare",
    config: {
      wellKnown: false,
      global: false,
      project: false,
      configDirectory: false,
    },
    discovery: {
      externalPlugins: false,
      externalSkills: false,
      automaticInstructions: false,
    },
    startup: {
      installConfigDependencies: false,
      lsp: false,
    },
  },
}

export function resolve(profile: Profile = "default") {
  return policies[profile]
}

export * as InstanceOptions from "./instance-options"
