import { onMount } from "solid-js"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogReleaseNotes } from "./dialog-release-notes"
import { shouldShowReleaseNotes, markReleaseNotesSeen } from "@/lib/release-notes"

/**
 * Component that handles showing release notes modal on app startup.
 * Shows the modal if:
 * - DEV_ALWAYS_SHOW_RELEASE_NOTES is true in lib/release-notes.ts
 * - OR the user hasn't seen the current version's release notes yet
 *
 * To disable the dev mode behavior, set DEV_ALWAYS_SHOW_RELEASE_NOTES to false
 * in packages/app/src/lib/release-notes.ts
 */
export function ReleaseNotesHandler() {
  const dialog = useDialog()

  onMount(() => {
    // Small delay to ensure app is fully loaded before showing modal
    setTimeout(() => {
      if (shouldShowReleaseNotes()) {
        dialog.show(
          () => <DialogReleaseNotes />,
          () => markReleaseNotesSeen(),
        )
      }
    }, 500)
  })

  return null
}
