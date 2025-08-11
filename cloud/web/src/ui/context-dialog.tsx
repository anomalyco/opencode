import { createContext, JSX, ParentProps, useContext } from "solid-js"
import { StandardSchemaV1 } from "@standard-schema/spec"
import { createStore } from "solid-js/store"
import { Dialog } from "./dialog"

const Context = createContext<DialogControl>()

type DialogControl = {
  open<Schema extends StandardSchemaV1<object>>(
    component: DialogComponent<Schema>,
    input: StandardSchemaV1.InferInput<Schema>,
  ): void
  close(): void
  isOpen(input: any): boolean
  size: "sm" | "md"
  transition?: boolean
  input?: any
}

type DialogProps<Schema extends StandardSchemaV1<object>> = {
  input: StandardSchemaV1.InferInput<Schema>
  control: DialogControl
}

type DialogComponent<Schema extends StandardSchemaV1<object>> = ReturnType<
  typeof createDialog<Schema>
>

export function createDialog<Schema extends StandardSchemaV1<object>>(props: {
  schema: Schema
  size: "sm" | "md"
  render: (props: DialogProps<Schema>) => JSX.Element
}) {
  const result = () => {
    const dialog = useDialog()
    return (
      <Dialog
        size={dialog.size}
        transition={dialog.transition}
        open={dialog.isOpen(result)}
        onOpenChange={(val) => {
          if (!val) dialog.close()
        }}
      >
        {props.render({
          input: dialog.input,
          control: dialog,
        })}
      </Dialog>
    )
  }
  result.schema = props.schema
  result.size = props.size
  return result
}

export function DialogProvider(props: ParentProps) {
  const [store, setStore] = createStore<{
    dialog?: DialogComponent<any>
    input?: any
    transition?: boolean
    size: "sm" | "md"
  }>({
    size: "sm",
  })

  const control: DialogControl = {
    get input() {
      return store.input
    },
    get size() {
      return store.size
    },
    get transition() {
      return store.transition
    },
    isOpen(input) {
      return store.dialog === input
    },
    open(component, input) {
      setStore({
        dialog: component,
        input: input,
        size: store.dialog !== undefined ? store.size : component.size,
        transition: store.dialog !== undefined,
      })

      setTimeout(() => {
        setStore({
          size: component.size,
        })
      }, 0)

      setTimeout(() => {
        setStore({
          transition: false,
        })
      }, 150)
    },
    close() {
      setStore({
        dialog: undefined,
      })
    },
  }

  return (
    <>
      <Context.Provider value={control}>{props.children}</Context.Provider>
    </>
  )
}

export function useDialog() {
  const ctx = useContext(Context)
  if (!ctx) {
    throw new Error("useDialog must be used within a DialogProvider")
  }
  return ctx
}
