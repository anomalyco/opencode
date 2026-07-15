import type { Config } from "@opencode-ai/sdk/v2"
import { DialogModel } from "../component/dialog-model"
import { parseModel } from "../context/local"
import type { useSDK } from "../context/sdk"
import type { useSync } from "../context/sync"
import type { DialogContext } from "../ui/dialog"
import type { ToastContext } from "../ui/toast"

/** Runtime config fields for permission modules (SDK Config may lag Schema). */
type ConfigWithPermissionModules = Config & {
  permission_modules?: Record<string, { model?: string }>
}

export type PermissionModuleCommand = {
  name: string
  title: string
  category: string
  slashName?: string
  slashAliases?: string[]
  hidden?: boolean
  suggested?: boolean
  enabled?: () => boolean
  run: () => void | Promise<void>
}

export type PermissionModuleCommandContext = {
  dialog: DialogContext
  toast: ToastContext
  sdk: ReturnType<typeof useSDK>
  sync: ReturnType<typeof useSync>
}

type Builder = (ctx: PermissionModuleCommandContext) => PermissionModuleCommand | readonly PermissionModuleCommand[]

const builders: Builder[] = []

/** Register TUI commands contributed by a permission module. Call at module load time. */
export function registerPermissionModuleCommands(builder: Builder) {
  builders.push(builder)
}

export function createPermissionModuleCommands(ctx: PermissionModuleCommandContext): PermissionModuleCommand[] {
  return builders.flatMap((builder) => {
    const result = builder(ctx)
    return Array.isArray(result) ? [...result] : [result]
  })
}

function cruiseControlModelRef(config: Config) {
  const modules = (config as ConfigWithPermissionModules).permission_modules
  const model = modules?.cruise_control?.model?.trim()
  return model || undefined
}

registerPermissionModuleCommands((ctx) => ({
  name: "permission.cruise_control.model",
  title: "Cruise Control model",
  category: "Permission",
  slashName: "cruise-control-model",
  run: () => {
    const modelRef = cruiseControlModelRef(ctx.sync.data.config)
    const current = modelRef ? parseModel(modelRef) : undefined
    ctx.toast.show({
      message: `Current Cruise Control model: ${modelRef ?? "unset"}`,
      variant: "info",
      duration: 2500,
    })
    ctx.dialog.replace(() => (
      <DialogModel
        title="Cruise Control model"
        current={current}
        onSelect={async (providerID, modelID) => {
          const model = `${providerID}/${modelID}`
          const patch = {
            permission_modules: {
              cruise_control: { model },
            },
          } as Config
          await ctx.sdk.client.global.config
            .update({ config: patch })
            .then(() => {
              ctx.toast.show({
                message: `Cruise Control model set to ${model}`,
                variant: "success",
                duration: 3000,
              })
              ctx.dialog.clear()
            })
            .catch((error) => {
              ctx.toast.show({
                message: error instanceof Error ? error.message : "Failed to save Cruise Control model",
                variant: "error",
                duration: 4000,
              })
            })
        }}
      />
    ))
  },
}))
