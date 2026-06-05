import { Dialog as KobalteDialog } from "@kobalte/core/dialog"
import { Dialog, DialogFooter } from "./dialog-v2"
import { ButtonV2 } from "./button-v2"

const docs = `### Overview
Dialog content wrapper built on Kobalte's dialog primitive with v2 styling.

### API
- Optional: \`title\`, \`description\`, \`action\`.
- \`size\`: normal | large | x-large.
- \`fit\` and \`transition\` control layout and animation.

### Variants and states
- Sizes and optional header/action controls.

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

export const Basic = {
  render: () => (
    <KobalteDialog defaultOpen>
      <KobalteDialog.Trigger as={ButtonV2} variant="neutral">
        Open dialog
      </KobalteDialog.Trigger>
      <KobalteDialog.Portal>
        <KobalteDialog.Overlay />
        <Dialog title="Dialog" description="Description">
          Dialog body content.
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
          <Dialog title="Normal" description="Normal size">
            Normal dialog content.
          </Dialog>
        </KobalteDialog.Portal>
      </KobalteDialog>

      <KobalteDialog>
        <KobalteDialog.Trigger as={ButtonV2} variant="neutral">
          Large
        </KobalteDialog.Trigger>
        <KobalteDialog.Portal>
          <KobalteDialog.Overlay />
          <Dialog size="large" title="Large" description="Large size">
            Large dialog content.
          </Dialog>
        </KobalteDialog.Portal>
      </KobalteDialog>

      <KobalteDialog>
        <KobalteDialog.Trigger as={ButtonV2} variant="neutral">
          X-Large
        </KobalteDialog.Trigger>
        <KobalteDialog.Portal>
          <KobalteDialog.Overlay />
          <Dialog size="x-large" title="Extra large" description="X-large size">
            X-large dialog content.
          </Dialog>
        </KobalteDialog.Portal>
      </KobalteDialog>
    </div>
  ),
}

export const CustomAction = {
  render: () => (
    <KobalteDialog>
      <KobalteDialog.Trigger as={ButtonV2} variant="neutral">
        Open action dialog
      </KobalteDialog.Trigger>
      <KobalteDialog.Portal>
        <KobalteDialog.Overlay />
        <Dialog
          title="Custom action"
          description="Dialog with a custom header action"
          action={
            <ButtonV2 variant="neutral" size="small">
              Help
            </ButtonV2>
          }
        >
          Dialog body content.
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
        <Dialog title="Save changes" description="Your changes will be lost if you don't save them." fit>
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
        <Dialog title="Unsaved changes" description="You have unsaved changes. What would you like to do?" fit>
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
        <Dialog title="Fit content" fit>
          Dialog fits its content.
        </Dialog>
      </KobalteDialog.Portal>
    </KobalteDialog>
  ),
}
