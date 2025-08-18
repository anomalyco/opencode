import style from "./dialog-select.module.css"
import { z } from "zod"
import { createMemo, createSignal, For, JSX, onMount } from "solid-js"
import { createList } from "solid-list"
import { createDialog } from "./context-dialog"

export const DialogSelect = createDialog({
  size: "md",
  schema: z.object({
    title: z.string(),
    placeholder: z.string(),
    onSelect: z
      .function(z.tuple([z.any()]))
      .returns(z.void())
      .optional(),
    options: z.array(
      z.object({
        display: z.string(),
        value: z.any().optional(),
        onSelect: z.function().returns(z.void()).optional(),
        prefix: z.custom<JSX.Element>().optional(),
      }),
    ),
  }),
  render: (ctx) => {
    let input: HTMLInputElement
    onMount(() => {
      input.focus()
      input.value = ""
    })

    const [filter, setFilter] = createSignal("")
    const filtered = createMemo(() =>
      ctx.input.options?.filter((i) =>
        i.display.toLowerCase().includes(filter().toLowerCase()),
      ),
    )
    const list = createList({
      loop: true,
      initialActive: 0,
      items: () => filtered().map((_, i) => i),
      handleTab: false,
    })

    const handleSelection = (index: number) => {
      const option = ctx.input.options[index]

      // If the option has its own onSelect handler, use it
      if (option.onSelect) {
        option.onSelect()
      }
      // Otherwise, if there's a global onSelect handler, call it with the option's value
      else if (ctx.input.onSelect) {
        ctx.input.onSelect(
          option.value !== undefined ? option.value : option.display,
        )
      }
    }

    return (
      <>
        <div data-slot="header">
          <label
            data-size="md"
            data-slot="title"
            data-component="label"
            for={`dialog-select-${ctx.input.title}`}
          >
            {ctx.input.title}
          </label>
        </div>
        <div data-slot="main">
          <input
            data-size="lg"
            data-component="input"
            value={filter()}
            onInput={(e) => {
              setFilter(e.target.value)
              list.setActive(0)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const selected = list.active()
                if (selected === null) return
                handleSelection(selected)
                return
              }
              if (e.key === "Escape") {
                setFilter("")
                return
              }
              list.onKeyDown(e)
            }}
            id={`dialog-select-${ctx.input.title}`}
            ref={(r) => (input = r)}
            data-slot="input"
            placeholder={ctx.input.placeholder}
          />
        </div>
        <div data-slot="options" class={style.options}>
          <For
            each={filtered()}
            fallback={
              <div data-slot="option" data-empty>
                No results
              </div>
            }
          >
            {(option, index) => (
              <div
                onClick={() => handleSelection(index())}
                data-slot="option"
                data-active={list.active() === index() ? true : undefined}
              >
                {option.prefix && <div data-slot="prefix">{option.prefix}</div>}
                <div data-slot="title">{option.display}</div>
              </div>
            )}
          </For>
        </div>
      </>
    )
  },
})
