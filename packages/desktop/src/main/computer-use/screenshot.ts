import { desktopCapturer, screen } from "electron"

export interface ScreenshotOptions {
  /** Capture full screen vs just the app window */
  fullScreen?: boolean
  /** Specific window title to capture (if not full screen) */
  windowTitle?: string
}

export interface ScreenshotResult {
  success: boolean
  /** PNG image buffer */
  buffer?: Buffer
  width?: number
  height?: number
  error?: string
}

/**
 * Capture a screenshot of the screen or a specific window
 */
export async function captureScreenshot(options: ScreenshotOptions = {}): Promise<ScreenshotResult> {
  try {
    if (options.fullScreen) {
      // Capture the primary display
      const primaryDisplay = screen.getPrimaryDisplay()
      const { width, height } = primaryDisplay.size

      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width, height },
      })

      const primarySource = sources[0]
      if (!primarySource) {
        return { success: false, error: "No screen source found" }
      }

      const thumbnail = primarySource.thumbnail
      return {
        success: true,
        buffer: thumbnail.toPNG(),
        width: thumbnail.getSize().width,
        height: thumbnail.getSize().height,
      }
    } else {
      // Capture the Cedric app window
      // This will be implemented to capture the current BrowserWindow
      return { success: false, error: "Window capture not implemented yet" }
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

/**
 * Capture a specific webview within the app
 */
export async function captureWebview(webContents: Electron.WebContents): Promise<ScreenshotResult> {
  try {
    const image = await webContents.capturePage()
    if (image.isEmpty()) {
      return { success: false, error: "Screenshot failed - empty image" }
    }

    return {
      success: true,
      buffer: image.toPNG(),
      width: image.getSize().width,
      height: image.getSize().height,
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
