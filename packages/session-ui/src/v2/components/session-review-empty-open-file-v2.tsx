import { useI18n } from "@opencode-ai/ui/context/i18n"
import "./session-review-v2.css"

function OpenFilePlaceholderIcon() {
  return (
    <svg
      data-slot="session-review-v2-empty-open-file-icon"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M3.125 1.875V15.3105H8.4375M3.125 5.93548H8.4375"
        stroke="var(--v2-icon-icon-muted)"
        stroke-width="1.25"
      />
      <rect
        x="10.625"
        y="4.02148"
        width="7.5"
        height="3.75"
        stroke="var(--v2-icon-icon-base)"
        stroke-width="1.25"
      />
      <rect
        x="10.625"
        y="13.4375"
        width="7.5"
        height="3.75"
        stroke="var(--v2-icon-icon-base)"
        stroke-width="1.25"
      />
    </svg>
  )
}

export function SessionReviewEmptyOpenFileV2() {
  const i18n = useI18n()

  return (
    <div data-slot="session-review-v2-empty-open-file">
      <OpenFilePlaceholderIcon />
      <div data-slot="session-review-v2-empty-open-file-title">
        {i18n.t("ui.sessionReviewV2.empty.openFile.title")}
      </div>
      <div data-slot="session-review-v2-empty-open-file-description">
        {i18n.t("ui.sessionReviewV2.empty.openFile.description")}
      </div>
    </div>
  )
}
