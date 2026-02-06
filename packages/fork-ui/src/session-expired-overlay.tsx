import { Dialog } from "@kobalte/core/dialog"
interface SessionExpiredOverlayProps {
  isExpired: () => boolean
  getServerUrl: () => string | undefined
}

/**
 * Modal overlay shown when user's session has expired.
 * Covers the page but allows user's work to remain visible behind it.
 * Prompts user to log in again to continue.
 */
export function SessionExpiredOverlay(props: SessionExpiredOverlayProps) {
  return (
    <Dialog open={props.isExpired()}>
      <Dialog.Portal>
        <Dialog.Overlay
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.8)",
            "z-index": 9999,
          }}
        />
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            "z-index": 10000,
            "pointer-events": "none",
          }}
        >
          <Dialog.Content
            style={{
              background: "#171717",
              border: "1px solid #404040",
              "border-radius": "8px",
              padding: "24px",
              "max-width": "400px",
              width: "90%",
              "pointer-events": "auto",
              color: "white",
            }}
          >
            <Dialog.Title
              style={{
                "font-size": "20px",
                "font-weight": "600",
                "margin-bottom": "12px",
              }}
            >
              Session Expired
            </Dialog.Title>
            <Dialog.Description
              style={{
                "font-size": "14px",
                color: "#a3a3a3",
                "margin-bottom": "24px",
              }}
            >
              Your session has expired. Please log in again to continue.
            </Dialog.Description>
            <button
              onClick={() => {
                const url = props.getServerUrl()
                if (!url) return
                window.location.href = `${url}/auth/login`
              }}
              style={{
                background: "#3b82f6",
                color: "white",
                padding: "8px 16px",
                "border-radius": "6px",
                border: "none",
                cursor: "pointer",
                "font-size": "14px",
                "font-weight": "500",
                width: "100%",
              }}
            >
              Log In
            </button>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog>
  )
}
