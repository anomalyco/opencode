import { onMount } from "solid-js"
import { useDialog, type DialogContext } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useRoute, type RouteContext } from "@tui/context/route"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "@tui/ui/toast"

type Session = {
  id: string
  title?: string
}

type OpenInput = {
  id: string
  fork?: boolean
  route: RouteContext
  dialog: Pick<DialogContext, "clear">
  sdk: {
    client: {
      session: {
        fork(input: { sessionID: string }): Promise<{ data?: { id?: string } }>
      }
    }
  }
  toast: {
    show(input: { message: string; variant?: "error" | "warning" | "info" | "success" }): void
  }
}

type Input = OpenInput & {
  title?: string
  dialog: Pick<DialogContext, "clear" | "replace">
  sdk: {
    client: {
      session: {
        children?(input: { sessionID: string }): Promise<{ data?: Session[] }>
        fork(input: { sessionID: string }): Promise<{ data?: { id?: string } }>
      }
    }
  }
}

export async function openRemoteSession(input: OpenInput) {
  if (!input.fork) {
    input.route.navigate({
      type: "session",
      sessionID: input.id,
    })
    input.dialog.clear()
    return
  }

  const result = await input.sdk.client.session.fork({
    sessionID: input.id,
  })
  const id = result.data?.id
  if (!id) {
    input.toast.show({
      message: "Failed to fork session",
      variant: "error",
    })
    return
  }

  input.route.navigate({
    type: "session",
    sessionID: id,
  })
  input.dialog.clear()
}

export async function selectRemoteSession(input: Input) {
  const result = await input.sdk.client.session.children?.({
    sessionID: input.id,
  })
  if (result?.data?.length) {
    input.dialog.replace(() => (
      <DialogRemoteSessionBrowse
        root={{ id: input.id, title: input.title }}
        sessions={result.data ?? []}
        fork={input.fork}
      />
    ))
    return
  }

  await openRemoteSession(input)
}

function DialogRemoteSessionBrowse(props: { root: Session; sessions: Session[]; fork?: boolean }) {
  const dialog = useDialog()
  const route = useRoute()
  const sdk = useSDK()
  const toast = useToast()

  return (
    <DialogSelect
      title="Continue remote session"
      options={[props.root, ...props.sessions].map((item) => ({
        title: item.title ?? item.id,
        value: item.id,
        footer: item.id,
      }))}
      skipFilter={true}
      onSelect={(option) => {
        void openRemoteSession({
          id: option.value,
          fork: props.fork,
          route,
          dialog,
          sdk,
          toast,
        })
      }}
    />
  )
}

export function DialogRemoteSessionList(props: { sessions: Session[]; fork?: boolean }) {
  const dialog = useDialog()
  const route = useRoute()
  const sdk = useSDK()
  const toast = useToast()

  onMount(() => {
    dialog.setSize("large")
  })

  return (
    <DialogSelect
      title="Remote sessions"
      options={props.sessions.map((item) => ({
        title: item.title ?? item.id,
        value: item.id,
        footer: item.id,
      }))}
      skipFilter={true}
      onSelect={(option) => {
        void selectRemoteSession({
          id: option.value,
          title: props.sessions.find((item) => item.id === option.value)?.title,
          fork: props.fork,
          route,
          dialog,
          sdk,
          toast,
        })
      }}
    />
  )
}
