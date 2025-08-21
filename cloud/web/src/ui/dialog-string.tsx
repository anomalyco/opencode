import { z } from "zod"
import { onMount } from "solid-js"
import { createDialog } from "./context-dialog"
import { Button } from "./button"

export const DialogString = createDialog({
  size: "sm",
  schema: z.object({
    title: z.string(),
    placeholder: z.string(),
    action: z.string(),
    onSubmit: z.function().args(z.string()).returns(z.void()),
  }),
  render: (ctx) => {
    let input: HTMLInputElement
    onMount(() => {
      setTimeout(() => {
        input.focus()
        input.value = ""
      }, 50)
    })

    function submit() {
      const value = input.value.trim()
      if (value) {
        ctx.input.onSubmit(value)
        ctx.control.close()
      }
    }

    return (
      <>
        <div data-slot="header">
          <label
            data-size="md"
            data-slot="title"
            data-component="label"
            for={`dialog-string-${ctx.input.title}`}
          >
            {ctx.input.title}
          </label>
        </div>
        <div data-slot="main">
          <input
            data-slot="input"
            data-size="lg"
            data-component="input"
            ref={(r) => (input = r)}
            placeholder={ctx.input.placeholder}
            id={`dialog-string-${ctx.input.title}`}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                submit()
              }
            }}
          />
        </div>
        <div data-slot="footer">
          <Button size="md" color="ghost" onClick={() => ctx.control.close()}>
            Cancel
          </Button>
          <Button size="md" color="secondary" onClick={submit}>
            {ctx.input.action}
          </Button>
        </div>
      </>
    )
  },
})
