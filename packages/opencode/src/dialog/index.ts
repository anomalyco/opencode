import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import z from "zod"

export class DialogDisposedError extends Error {
  override name = "DialogDisposedError"
  constructor(public dialogID: string) {
    super(`Dialog ${dialogID} was disposed before receiving a response`)
  }
}

export type DialogResult<T> = { value: T; dismissed: false } | { value: undefined; dismissed: true }

export namespace Dialog {
  export const KeybindSchema = z.object({
    key: z.string(),
    ctrl: z.boolean().optional(),
    meta: z.boolean().optional(),
    shift: z.boolean().optional(),
    value: z.any(),
    label: z.string().optional(),
  })

  export const Request = z.object({
    id: Identifier.schema("dialog"),
    type: z.enum(["select", "confirm", "alert", "prompt"]),
    title: z.string(),
    message: z.string().optional(),
    options: z
      .array(
        z.object({
          value: z.any(),
          title: z.string(),
          description: z.string().optional(),
          category: z.string().optional(),
          disabled: z.boolean().optional(),
        }),
      )
      .optional(),
    placeholder: z.string().optional(),
    defaultValue: z.string().optional(),
    mode: z.enum(["modal", "inline"]).optional(),
    keybind: z.array(KeybindSchema).optional(),
  })

  export type Request = z.infer<typeof Request>

  export type Input<T = unknown> = Omit<Request, "id" | "options"> & {
    options?: Array<{
      value: T
      title: string
      description?: string
      category?: string
      disabled?: boolean
    }>
  }

  export type ConfirmInput = Input<boolean> & { type: "confirm" }
  export type PromptInput = Input<string> & { type: "prompt" }
  export type AlertInput = Input<void> & { type: "alert" }
  export type SelectInput<T> = Input<T> & {
    type: "select"
    options: Array<{ value: T; title: string; description?: string; category?: string; disabled?: boolean }>
  }

  export const Event = {
    Request: BusEvent.define("ui.dialog.request", Request),
    Reply: BusEvent.define(
      "ui.dialog.reply",
      z.object({
        dialogID: z.string(),
        response: z.any(),
      }),
    ),
  }

  const state = Instance.state(
    () => {
      const pending: Record<
        string,
        {
          info: Request
          resolve: (value: DialogResult<unknown>) => void
          reject: (error: any) => void
        }
      > = {}
      return { pending }
    },
    async (state) => {
      for (const item of Object.values(state.pending)) {
        item.reject(new DialogDisposedError(item.info.id))
      }
    },
  )

  export function show(input: ConfirmInput): Promise<DialogResult<boolean>>
  export function show(input: PromptInput): Promise<DialogResult<string>>
  export function show(input: AlertInput): Promise<DialogResult<void>>
  export function show<T>(input: SelectInput<T>): Promise<DialogResult<T>>
  export function show<T = unknown>(input: Input<T>): Promise<DialogResult<T>>

  export async function show<T = unknown>(input: Input<T>): Promise<DialogResult<T>> {
    const s = await state()
    const id = Identifier.ascending("dialog")
    const info: Request = { id, mode: "modal", ...input } as Request

    return new Promise((resolve, reject) => {
      s.pending[id] = { info, resolve: resolve as (value: DialogResult<unknown>) => void, reject }
      Bus.publish(Event.Request, info)
    })
  }

  export async function reply(input: { dialogID: string; value?: unknown; dismissed: boolean }): Promise<void> {
    const s = await state()
    const existing = s.pending[input.dialogID]
    if (!existing) return

    delete s.pending[input.dialogID]
    const response = input.dismissed ? { value: undefined, dismissed: true } : { value: input.value, dismissed: false }
    Bus.publish(Event.Reply, { dialogID: input.dialogID, response })
    existing.resolve(response as DialogResult<unknown>)
  }
}
