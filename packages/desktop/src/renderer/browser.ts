export {}

interface Annotation {
  id: string
  type: "highlight" | "note"
  url: string
  selector?: string
  text?: string
  note?: string
  timestamp: number
  color?: string
}

declare global {
  interface Window {
    browserAPI: {
      navigate: (url: string) => void
      goBack: () => void
      goForward: () => void
      reload: () => void
      getUrl: () => Promise<string>
      canGoBack: () => Promise<boolean>
      canGoForward: () => Promise<boolean>
      screenshot: () => Promise<{ buffer: ArrayBuffer; width: number; height: number } | null>
      saveAnnotations: (data: string) => Promise<boolean>
      loadAnnotations: () => Promise<string | null>
      onNavigate: (cb: (url: string) => void) => () => void
      onDidNavigate: (cb: (data: { url: string; httpResponseCode: number; httpStatusText: string }) => void) => () => void
      onDidFailLoad: (cb: (data: { errorCode: number; errorDescription: string; validatedURL: string }) => void) => () => void
      onPageTitleUpdated: (cb: (title: string) => void) => () => void
    }
  }
}

const webview = document.getElementById("webview") as any
const urlInput = document.getElementById("urlInput") as HTMLInputElement
const backBtn = document.getElementById("backBtn") as HTMLButtonElement
const forwardBtn = document.getElementById("forwardBtn") as HTMLButtonElement
const reloadBtn = document.getElementById("reloadBtn") as HTMLButtonElement
const highlightBtn = document.getElementById("highlightBtn") as HTMLButtonElement
const noteBtn = document.getElementById("noteBtn") as HTMLButtonElement
const screenshotBtn = document.getElementById("screenshotBtn") as HTMLButtonElement
const annotationsBtn = document.getElementById("annotationsBtn") as HTMLButtonElement
const saveBtn = document.getElementById("saveBtn") as HTMLButtonElement
const loadBtn = document.getElementById("loadBtn") as HTMLButtonElement
const statusText = document.getElementById("statusText") as HTMLSpanElement
const pageTitle = document.getElementById("pageTitle") as HTMLSpanElement
const annotationsPanel = document.getElementById("annotationsPanel") as HTMLDivElement
const annotationsList = document.getElementById("annotationsList") as HTMLDivElement

let annotations: Annotation[] = []
let currentMode: "none" | "highlight" | "note" = "none"
let isAnnotationsOpen = false

function updateNavigationButtons() {
  if (window.browserAPI) {
    window.browserAPI.canGoBack().then((can) => {
      backBtn.disabled = !can
    })
    window.browserAPI.canGoForward().then((can) => {
      forwardBtn.disabled = !can
    })
  }
}

function addAnnotation(annotation: Annotation) {
  annotations.push(annotation)
  renderAnnotations()
}

function renderAnnotations() {
  annotationsList.innerHTML = ""
  const currentUrl = webview.src || ""
  const filtered = annotations.filter((a) => currentUrl.includes(a.url) || a.url.includes(currentUrl))

  if (filtered.length === 0) {
    annotationsList.innerHTML = "<p style='color: #888; font-size: 13px;'>No annotations for this page.</p>"
    return
  }

  for (const annotation of filtered) {
    const item = document.createElement("div")
    item.className = "annotation-item"
    item.innerHTML = `
      <div class="timestamp">${new Date(annotation.timestamp).toLocaleString()}</div>
      <div class="text">${annotation.type === "highlight" ? "🖍️ " : "📝 "}${annotation.text || ""}</div>
      ${annotation.note ? `<div class="note">${annotation.note}</div>` : ""}
    `
    annotationsList.appendChild(item)
  }
}

function navigateTo(url: string) {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url
  }
  webview.src = url
  urlInput.value = url
  statusText.textContent = "Loading..."
}

urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    navigateTo(urlInput.value)
  }
})

backBtn.addEventListener("click", () => {
  if (window.browserAPI) {
    window.browserAPI.goBack()
  } else if (webview.canGoBack()) {
    webview.goBack()
  }
})

forwardBtn.addEventListener("click", () => {
  if (window.browserAPI) {
    window.browserAPI.goForward()
  } else if (webview.canGoForward()) {
    webview.goForward()
  }
})

reloadBtn.addEventListener("click", () => {
  if (window.browserAPI) {
    window.browserAPI.reload()
  } else {
    webview.reload()
  }
})

highlightBtn.addEventListener("click", () => {
  if (currentMode === "highlight") {
    currentMode = "none"
    highlightBtn.classList.remove("active")
  } else {
    currentMode = "highlight"
    highlightBtn.classList.add("active")
    noteBtn.classList.remove("active")
    statusText.textContent = "Click on text to highlight"
  }
})

noteBtn.addEventListener("click", () => {
  if (currentMode === "note") {
    currentMode = "none"
    noteBtn.classList.remove("active")
  } else {
    currentMode = "note"
    noteBtn.classList.add("active")
    highlightBtn.classList.remove("active")
    statusText.textContent = "Click on text to add a note"
  }
})

annotationsBtn.addEventListener("click", () => {
  isAnnotationsOpen = !isAnnotationsOpen
  annotationsPanel.classList.toggle("open", isAnnotationsOpen)
  annotationsBtn.classList.toggle("active", isAnnotationsOpen)
  renderAnnotations()
})

screenshotBtn.addEventListener("click", async () => {
  if (window.browserAPI) {
    statusText.textContent = "Taking screenshot..."
    try {
      const result = await window.browserAPI.screenshot()
      if (result) {
        const blob = new Blob([result.buffer], { type: "image/png" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `screenshot-${Date.now()}.png`
        a.click()
        URL.revokeObjectURL(url)
        statusText.textContent = "Screenshot saved"
      } else {
        statusText.textContent = "Screenshot failed"
      }
    } catch (error) {
      statusText.textContent = "Screenshot error"
      console.error(error)
    }
  }
})

saveBtn.addEventListener("click", async () => {
  if (window.browserAPI) {
    const data = JSON.stringify(annotations, null, 2)
    const success = await window.browserAPI.saveAnnotations(data)
    statusText.textContent = success ? "Annotations saved" : "Save cancelled"
  }
})

loadBtn.addEventListener("click", async () => {
  if (window.browserAPI) {
    const data = await window.browserAPI.loadAnnotations()
    if (data) {
      try {
        annotations = JSON.parse(data)
        renderAnnotations()
        statusText.textContent = `Loaded ${annotations.length} annotations`
      } catch (error) {
        statusText.textContent = "Invalid annotations file"
      }
    } else {
      statusText.textContent = "Load cancelled"
    }
  }
})

webview.addEventListener("did-navigate", (event: any) => {
  urlInput.value = event.url
  statusText.textContent = "Loaded"
  updateNavigationButtons()
  renderAnnotations()
})

webview.addEventListener("did-fail-load", (event: any) => {
  statusText.textContent = `Failed: ${event.errorDescription}`
})

webview.addEventListener("page-title-updated", (event: any) => {
  pageTitle.textContent = event.title
})

webview.addEventListener("dom-ready", () => {
  updateNavigationButtons()
})

if (window.browserAPI) {
  window.browserAPI.onNavigate((url) => {
    navigateTo(url)
  })

  window.browserAPI.onDidNavigate((data) => {
    urlInput.value = data.url
    statusText.textContent = `Loaded (${data.httpResponseCode})`
    updateNavigationButtons()
    renderAnnotations()
  })

  window.browserAPI.onDidFailLoad((data) => {
    statusText.textContent = `Failed: ${data.errorDescription}`
  })

  window.browserAPI.onPageTitleUpdated((title) => {
    pageTitle.textContent = title
  })
}

updateNavigationButtons()

webview.addEventListener("ipc-message", (event: any) => {
  if (event.channel === "text-selected") {
    const text = event.args[0]
    if (currentMode === "highlight") {
      addAnnotation({
        id: Date.now().toString(),
        type: "highlight",
        url: webview.src,
        text,
        timestamp: Date.now(),
        color: "#ffeb3b",
      })
      statusText.textContent = "Text highlighted"
      currentMode = "none"
      highlightBtn.classList.remove("active")
    } else if (currentMode === "note") {
      const note = prompt("Enter your note:")
      if (note) {
        addAnnotation({
          id: Date.now().toString(),
          type: "note",
          url: webview.src,
          text,
          note,
          timestamp: Date.now(),
        })
        statusText.textContent = "Note added"
      }
      currentMode = "none"
      noteBtn.classList.remove("active")
    }
  }
})
