type DisplayMediaConstraints = MediaStreamConstraints & {
  // Chromium hint to default the picker to the current tab.
  preferCurrentTab?: boolean
}

function waitForFrame(video: HTMLVideoElement) {
  return new Promise<void>((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }

    // Prefer a real painted frame when the browser supports it, but never block
    // on it — registering this after play() resolves can silently never fire.
    const rvfc = (video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number })
      .requestVideoFrameCallback
    if (typeof rvfc === "function") rvfc.call(video, () => finish())

    if (video.readyState >= 2) {
      requestAnimationFrame(() => finish())
    } else {
      video.addEventListener("loadeddata", () => requestAnimationFrame(() => finish()), { once: true })
    }

    // Safety net so the capture can never hang the button indefinitely.
    setTimeout(finish, 1000)
  })
}

async function grabFrame(stream: MediaStream): Promise<File | null> {
  const video = document.createElement("video")
  video.srcObject = stream
  video.muted = true
  video.playsInline = true

  try {
    await video.play().catch(() => {})
    await waitForFrame(video)

    const width = video.videoWidth
    const height = video.videoHeight
    if (!width || !height) return null

    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, width, height)

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))
    if (!blob) return null

    return new File([blob], `tab-capture-${Date.now()}.png`, { type: "image/png" })
  } finally {
    video.pause()
    video.srcObject = null
  }
}

/**
 * Prompts the user to pick a tab/window/screen via getDisplayMedia, grabs a
 * single frame and returns it as a PNG File. Returns null when the API is
 * unavailable or the user cancels the picker.
 */
export async function captureDisplayImage(): Promise<File | null> {
  if (!navigator.mediaDevices?.getDisplayMedia) return null

  let stream: MediaStream | null = null
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
      preferCurrentTab: true,
    } as DisplayMediaConstraints)
  } catch {
    // User dismissed the picker or denied permission.
    return null
  }

  try {
    return await grabFrame(stream)
  } finally {
    stream.getTracks().forEach((track) => track.stop())
  }
}
