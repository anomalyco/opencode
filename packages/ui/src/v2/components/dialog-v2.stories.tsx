import { Dialog as KobalteDialog } from "@kobalte/core/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle, DialogTitleGroup } from "./dialog-v2"
import { ButtonV2 } from "./button-v2"

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
  title: "UI V2/Dialog",
  id: "components-dialog-v2",
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

export const Basic = {
  render: () => (
    <KobalteDialog defaultOpen>
      <KobalteDialog.Trigger as={ButtonV2} variant="neutral">
        Open dialog
      </KobalteDialog.Trigger>
      <KobalteDialog.Portal>
        <KobalteDialog.Overlay />
        <Dialog>
          {dialogHeader("Dialog", "Description")}
          <DialogBody>Dialog body content.</DialogBody>
        </Dialog>
      </KobalteDialog.Portal>
    </KobalteDialog>
  ),
}

export const Sizes = {
  render: () => (
    <div style={{ display: "flex", gap: "12px" }}>
      <KobalteDialog>
        <KobalteDialog.Trigger as={ButtonV2} variant="neutral">
          Normal
        </KobalteDialog.Trigger>
        <KobalteDialog.Portal>
          <KobalteDialog.Overlay />
          <Dialog>
            {dialogHeader("Normal", "Normal size")}
            <DialogBody>Normal dialog content.</DialogBody>
          </Dialog>
        </KobalteDialog.Portal>
      </KobalteDialog>

      <KobalteDialog>
        <KobalteDialog.Trigger as={ButtonV2} variant="neutral">
          Large
        </KobalteDialog.Trigger>
        <KobalteDialog.Portal>
          <KobalteDialog.Overlay />
          <Dialog size="large">
            {dialogHeader("Large", "Large size")}
            <DialogBody>Large dialog content.</DialogBody>
          </Dialog>
        </KobalteDialog.Portal>
      </KobalteDialog>

      <KobalteDialog>
        <KobalteDialog.Trigger as={ButtonV2} variant="neutral">
          X-Large
        </KobalteDialog.Trigger>
        <KobalteDialog.Portal>
          <KobalteDialog.Overlay />
          <Dialog size="x-large">
            {dialogHeader("Extra large", "X-large size")}
            <DialogBody>X-large dialog content.</DialogBody>
          </Dialog>
        </KobalteDialog.Portal>
      </KobalteDialog>
    </div>
  ),
}

export const TitleOnly = {
  render: () => (
    <KobalteDialog defaultOpen>
      <KobalteDialog.Trigger as={ButtonV2} variant="neutral">
        Open dialog
      </KobalteDialog.Trigger>
      <KobalteDialog.Portal>
        <KobalteDialog.Overlay />
        <Dialog>
          <DialogHeader>
            <DialogTitle>Open project</DialogTitle>
          </DialogHeader>
          <DialogBody>Dialog body content.</DialogBody>
        </Dialog>
      </KobalteDialog.Portal>
    </KobalteDialog>
  ),
}

export const HeaderControls = {
  render: () => (
    <KobalteDialog>
      <KobalteDialog.Trigger as={ButtonV2} variant="neutral">
        Open dialog
      </KobalteDialog.Trigger>
      <KobalteDialog.Portal>
        <KobalteDialog.Overlay />
        <Dialog>
          <DialogHeader>
            <DialogTitleGroup title="Custom header" description="Dialog with an extra header control" />
            <ButtonV2 variant="neutral" size="small">
              Help
            </ButtonV2>
          </DialogHeader>
          <DialogBody>Dialog body content.</DialogBody>
        </Dialog>
      </KobalteDialog.Portal>
    </KobalteDialog>
  ),
}

export const WithFooter = {
  render: () => (
    <KobalteDialog defaultOpen>
      <KobalteDialog.Trigger as={ButtonV2} variant="neutral">
        Open dialog
      </KobalteDialog.Trigger>
      <KobalteDialog.Portal>
        <KobalteDialog.Overlay />
        <Dialog fit>
          {dialogHeader("Save changes", "Your changes will be lost if you don't save them.")}
          <DialogFooter>
            <ButtonV2 variant="neutral">Cancel</ButtonV2>
            <ButtonV2 variant="contrast">Save</ButtonV2>
          </DialogFooter>
        </Dialog>
      </KobalteDialog.Portal>
    </KobalteDialog>
  ),
}

export const WithFooterThreeButtons = {
  render: () => (
    <KobalteDialog defaultOpen>
      <KobalteDialog.Trigger as={ButtonV2} variant="neutral">
        Open dialog
      </KobalteDialog.Trigger>
      <KobalteDialog.Portal>
        <KobalteDialog.Overlay />
        <Dialog fit>
          {dialogHeader("Unsaved changes", "You have unsaved changes. What would you like to do?")}
          <DialogFooter>
            <span style={{ "margin-right": "auto" }}>
              <ButtonV2 variant="ghost">Remind me later</ButtonV2>
            </span>
            <ButtonV2 variant="neutral">Cancel</ButtonV2>
            <ButtonV2 variant="contrast">Save</ButtonV2>
          </DialogFooter>
        </Dialog>
      </KobalteDialog.Portal>
    </KobalteDialog>
  ),
}

export const Fit = {
  render: () => (
    <KobalteDialog>
      <KobalteDialog.Trigger as={ButtonV2} variant="neutral">
        Open fit dialog
      </KobalteDialog.Trigger>
      <KobalteDialog.Portal>
        <KobalteDialog.Overlay />
        <Dialog fit>
          {dialogHeader("Fit content", "Dialog fits its content.")}
          <DialogBody>Dialog fits its content.</DialogBody>
        </Dialog>
      </KobalteDialog.Portal>
    </KobalteDialog>
  ),
}
