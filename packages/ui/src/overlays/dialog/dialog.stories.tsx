import { Overlay, Portal, Root, Trigger } from "@kobalte/core/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle, DialogTitleGroup } from "./dialog"
import { Button } from "@opencode/ui/button"
import { useDialog, useDialogLayer } from "@opencode/ui/context/dialog"
import { Menu } from "@opencode/ui/menu"
import { Select } from "@opencode/ui/select"
import { Toast, showToast } from "@opencode/ui/toast"
import { Tooltip } from "@opencode/ui/tooltip"
import { createSignal, onMount, type JSX, type ParentProps } from "solid-js"

const docs = `### Overview
Dialog content wrapper built on Kobalte's dialog primitive with v2 styling.

Compose with \`DialogHeader\`, \`DialogTitle\`, \`DialogTitleGroup\`, \`DialogBody\`, and \`DialogFooter\`.

### API
- \`Dialog\`: \`size\` (normal | large | x-large), \`variant\`, \`fit\`.
- \`DialogHeader\`: row container with optional \`closeLabel\` and \`hideClose\`.
- \`DialogTitle\`: accessible single-line header title.
- \`DialogTitleGroup\`: column with \`title\` and required \`description\`.

### Accessibility
- Focus trapping and aria attributes provided by Kobalte Dialog.

### Theming/tokens
- Uses \`data-component="dialog-v2"\` and slot attributes.
`

export default {
  title: "UI/Dialog",
  id: "ui-dialog",
  component: Dialog,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

function dialogHeader(title: string, description: string) {
  return (
    <DialogHeader>
      <DialogTitleGroup title={title} description={description} />
    </DialogHeader>
  )
}

// Opens through the dialog stack, so a preview that holds its dialogs holds this one too.
function OpenStoryDialog(props: { render: () => JSX.Element }) {
  const dialog = useDialog()

  const open = () => void dialog.show(props.render)

  onMount(open)

  return (
    <Button variant="neutral" onClick={open}>
      Open dialog
    </Button>
  )
}

export const Basic = {
  render: () => (
    <OpenStoryDialog
      render={() => (
        <Dialog>
          {dialogHeader("Dialog", "Description")}
          <DialogBody>Dialog body content.</DialogBody>
        </Dialog>
      )}
    />
  ),
}

export const Sizes = {
  render: () => (
    <div style={{ display: "flex", gap: "12px" }}>
      <Root>
        <Trigger as={Button} variant="neutral">
          Normal
        </Trigger>
        <Portal>
          <Overlay />
          <Dialog>
            {dialogHeader("Normal", "Normal size")}
            <DialogBody>Normal dialog content.</DialogBody>
          </Dialog>
        </Portal>
      </Root>

      <Root>
        <Trigger as={Button} variant="neutral">
          Large
        </Trigger>
        <Portal>
          <Overlay />
          <Dialog size="large">
            {dialogHeader("Large", "Large size")}
            <DialogBody>Large dialog content.</DialogBody>
          </Dialog>
        </Portal>
      </Root>

      <Root>
        <Trigger as={Button} variant="neutral">
          X-Large
        </Trigger>
        <Portal>
          <Overlay />
          <Dialog size="x-large">
            {dialogHeader("Extra large", "X-large size")}
            <DialogBody>X-large dialog content.</DialogBody>
          </Dialog>
        </Portal>
      </Root>
    </div>
  ),
}

export const TitleOnly = {
  render: () => (
    <OpenStoryDialog
      render={() => (
        <Dialog>
          <DialogHeader>
            <DialogTitle>Open project</DialogTitle>
          </DialogHeader>
          <DialogBody>Dialog body content.</DialogBody>
        </Dialog>
      )}
    />
  ),
}

export const HeaderControls = {
  render: () => (
    <Root>
      <Trigger as={Button} variant="neutral">
        Open dialog
      </Trigger>
      <Portal>
        <Overlay />
        <Dialog>
          <DialogHeader>
            <DialogTitleGroup title="Custom header" description="Dialog with an extra header control" />
            <Button variant="neutral" size="small">
              Help
            </Button>
          </DialogHeader>
          <DialogBody>Dialog body content.</DialogBody>
        </Dialog>
      </Portal>
    </Root>
  ),
}

export const WithFooter = {
  render: () => (
    <OpenStoryDialog
      render={() => (
        <Dialog fit>
          {dialogHeader("Save changes", "Your changes will be lost if you don't save them.")}
          <DialogFooter>
            <Button variant="neutral">Cancel</Button>
            <Button variant="contrast">Save</Button>
          </DialogFooter>
        </Dialog>
      )}
    />
  ),
}

export const WithFooterThreeButtons = {
  render: () => (
    <OpenStoryDialog
      render={() => (
        <Dialog fit>
          {dialogHeader("Unsaved changes", "You have unsaved changes. What would you like to do?")}
          <DialogFooter>
            <span style={{ "margin-right": "auto" }}>
              <Button variant="ghost">Remind me later</Button>
            </span>
            <Button variant="neutral">Cancel</Button>
            <Button variant="contrast">Save</Button>
          </DialogFooter>
        </Dialog>
      )}
    />
  ),
}

export const Fit = {
  render: () => (
    <Root>
      <Trigger as={Button} variant="neutral">
        Open fit dialog
      </Trigger>
      <Portal>
        <Overlay />
        <Dialog fit>
          {dialogHeader("Fit content", "Dialog fits its content.")}
          <DialogBody>Dialog fits its content.</DialogBody>
        </Dialog>
      </Portal>
    </Root>
  ),
}

function OpenFromButton() {
  const dialog = useDialog()

  return (
    <Button
      variant="neutral"
      onClick={() =>
        dialog.show(() => (
          <Dialog>
            {dialogHeader("Choose model", "Pick Alpha or Beta")}
            <DialogBody>Alpha and Beta are available.</DialogBody>
          </Dialog>
        ))
      }
    >
      Choose model
    </Button>
  )
}

export const OpenedFromButton = {
  render: () => <OpenFromButton />,
}

// Stays mounted as long as an image preview's flight out, so its exit outlasts the dialogs above it.
function SlowExit(props: ParentProps) {
  useDialogLayer()?.setExitDuration(960)

  return props.children
}

function StackedDialogs() {
  const dialog = useDialog()

  const open = () => {
    void dialog.show(() => (
      <Dialog size="x-large">
        {dialogHeader("Below", "The first dialog in the stack")}
        <DialogBody>Stays open throughout.</DialogBody>
      </Dialog>
    ))
    void dialog.push(
      () => (
        <SlowExit>
          <Dialog size="large">
            {dialogHeader("Middle", "Takes 960 ms to leave, as an image preview does")}
            <DialogBody>Closed by its id while it is not on top.</DialogBody>
          </Dialog>
        </SlowExit>
      ),
      undefined,
      "middle",
    )
    void dialog.push(() => (
      <Dialog fit>
        {dialogHeader("Top", "Close the middle dialog, then press Escape")}
        <DialogFooter>
          <Button variant="neutral" onClick={() => dialog.close("middle")}>
            Close middle
          </Button>
        </DialogFooter>
      </Dialog>
    ))
  }

  onMount(open)

  return (
    <Button variant="neutral" onClick={open}>
      Open stacked dialogs
    </Button>
  )
}

export const Stacked = {
  render: () => <StackedDialogs />,
}

// Each of these portals its content outside the dialog, which a modal dialog hides from assistive tech.
function PopupsDialog() {
  const [fruit, setFruit] = createSignal<string>()

  return (
    <Dialog>
      {dialogHeader("Popups", "A select, a menu, a tooltip and a toast opened from a dialog")}
      <DialogBody>
        <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
          <Select
            appearance="base"
            placeholder="Pick a fruit"
            options={["Apple", "Banana", "Cherry"]}
            current={fruit()}
            onSelect={(value) => setFruit(value ?? undefined)}
          />
          <Menu gutter={6} modal={false}>
            <Menu.Trigger as={Button} variant="neutral">
              Actions
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content>
                <Menu.Item>Rename</Menu.Item>
                <Menu.Sub>
                  <Menu.SubTrigger>Move to</Menu.SubTrigger>
                  <Menu.Portal>
                    <Menu.SubContent>
                      <Menu.Item>Archive</Menu.Item>
                    </Menu.SubContent>
                  </Menu.Portal>
                </Menu.Sub>
              </Menu.Content>
            </Menu.Portal>
          </Menu>
          <Tooltip value="Copy the link">
            <Button variant="neutral">Copy</Button>
          </Tooltip>
          <Button variant="neutral" onClick={() => showToast({ title: "Saved", persistent: true })}>
            Save
          </Button>
        </div>
      </DialogBody>
    </Dialog>
  )
}

export const WithPopups = {
  render: () => (
    <>
      <Toast.Region />
      <OpenStoryDialog render={() => <PopupsDialog />} />
    </>
  ),
}
