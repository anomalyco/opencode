import { createSignal, onMount, Show, onCleanup } from "solid-js"
import { IconButton } from "../icon-button"
import { IconV2 } from "../icon-v2"
import "./browser-view.css"

export interface BrowserViewProps {
  url: string
  onClose?: () => void
  onUrlChange?: (url: string) => void
  onTitleChange?: (title: string) => void
  onBookmark?: (title: string, url: string) => void
  onSendToAgent?: (text: string) => void
  onShareWithAgent?: (url: string, content: string) => void
}

export function BrowserView(props: BrowserViewProps) {
  let webview: any
  const [currentUrl, setCurrentUrl] = createSignal(props.url)
  const [canGoBack, setCanGoBack] = createSignal(false)
  const [canGoForward, setCanGoForward] = createSignal(false)
  const [isLoading, setIsLoading] = createSignal(false)
  const [isPicking, setIsPicking] = createSignal(false)

  onMount(() => {
    if (!webview) return

    webview.addEventListener("did-start-loading", () => setIsLoading(true))
    webview.addEventListener("did-stop-loading", () => {
      setIsLoading(false)
      setCurrentUrl(webview.getURL())
      setCanGoBack(webview.canGoBack())
      setCanGoForward(webview.canGoForward())
      props.onUrlChange?.(webview.getURL())
      props.onTitleChange?.(webview.getTitle())
    })

    webview.addEventListener("console-message", (e: any) => {
      if (e.message.startsWith("opencode-element-picked:")) {
        const data = JSON.parse(e.message.substring("opencode-element-picked:".length))
        setIsPicking(false)
        props.onSendToAgent?.(`User picked element:\n${JSON.stringify(data, null, 2)}`)
      }
    })

    webview.addEventListener("dom-ready", () => {
      // Inject some CSS to make it look better if needed
    })

    const onControl = (e: any) => {
      const { command, params } = e.detail
      if (command === "click") {
        webview.executeJavaScript(`
          (function() {
            const el = document.querySelector('${params.selector}');
            if (el) el.click();
          })();
        `)
      } else if (command === "type") {
        webview.executeJavaScript(`
          (function() {
            const el = document.querySelector('${params.selector}');
            if (el) {
              el.value = '${params.text}';
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
          })();
        `)
      } else if (command === "snapshot") {
        handleSharePage()
      }
    }

    window.addEventListener("opencode-browser-control", onControl)
    onCleanup(() => window.removeEventListener("opencode-browser-control", onControl))
  })

  const handleNavigate = (e: Event) => {
    e.preventDefault()
    let url = currentUrl()
    if (!url.startsWith("http")) url = "https://" + url
    webview.loadURL(url)
  }

  const handleSendSelection = async () => {
    const selection = await webview.executeJavaScript("window.getSelection().toString()")
    if (selection) {
      props.onSendToAgent?.(selection)
    }
  }

  const handleSharePage = async () => {
    const content = await webview.executeJavaScript("document.documentElement.innerText")
    props.onShareWithAgent?.(webview.getURL(), content)
  }

  const togglePicker = () => {
    const picking = !isPicking()
    setIsPicking(picking)
    if (picking) {
      webview.executeJavaScript(`
        (function() {
          let lastEl = null;
          const style = document.createElement('style');
          style.id = 'opencode-picker-style';
          style.innerHTML = '.opencode-highlight { outline: 2px solid #007acc !important; outline-offset: -2px !important; cursor: crosshair !important; }';
          document.head.appendChild(style);

          function onMouseOver(e) {
            if (lastEl) lastEl.classList.remove('opencode-highlight');
            lastEl = e.target;
            lastEl.classList.add('opencode-highlight');
          }

          function onClick(e) {
            e.preventDefault();
            e.stopPropagation();
            const el = e.target;
            const info = {
              tag: el.tagName,
              text: el.innerText.substring(0, 500),
              html: el.outerHTML.substring(0, 1000),
              classes: el.className
            };
            cleanup();
            console.log('opencode-element-picked:' + JSON.stringify(info));
          }

          function cleanup() {
            if (lastEl) lastEl.classList.remove('opencode-highlight');
            document.removeEventListener('mouseover', onMouseOver);
            document.removeEventListener('click', onClick, true);
            const s = document.getElementById('opencode-picker-style');
            if (s) s.remove();
          }

          document.addEventListener('mouseover', onMouseOver);
          document.addEventListener('click', onClick, true);
        })();
      `)
    } else {
      webview.executeJavaScript(`
        if (typeof cleanup === 'function') cleanup();
      `)
    }
  }

  return (
    <div class="browser-view">
      <div class="browser-toolbar">
        <div class="browser-nav-buttons">
          <IconButton icon="arrow-left" variant="ghost" size="small" disabled={!canGoBack()} onClick={() => webview.goBack()} />
          <IconButton icon="arrow-right" variant="ghost" size="small" disabled={!canGoForward()} onClick={() => webview.goForward()} />
          <IconButton icon={isLoading() ? "close" : "refresh"} variant="ghost" size="small" onClick={() => (isLoading() ? webview.stop() : webview.reload())} />
        </div>
        <form class="browser-url-bar" onSubmit={handleNavigate}>
          <div class="url-input-container">
            <IconV2 name="lock" size={12} class="url-lock-icon" />
            <input
              type="text"
              value={currentUrl()}
              onInput={(e) => setCurrentUrl(e.currentTarget.value)}
              placeholder="Search or enter address"
              class="url-input"
            />
            <Show when={isLoading()}>
              <div class="url-loading-spinner" />
            </Show>
          </div>
        </form>
        <div class="browser-actions">
          <IconButton
            icon="target"
            variant="ghost"
            size="small"
            onClick={togglePicker}
            state={isPicking() ? "pressed" : undefined}
            tooltip="Pick an element from the page"
          />
          <IconButton icon="star" variant="ghost" size="small" onClick={() => props.onBookmark?.(webview.getTitle(), webview.getURL())} />
          <IconButton icon="chat" variant="ghost" size="small" onClick={handleSendSelection} tooltip="Send selection to Agent" />
          <IconButton icon="share" variant="ghost" size="small" onClick={handleSharePage} tooltip="Share page with Agent" />
          <Show when={props.onClose}>
            <div class="browser-divider" />
            <IconButton icon="close" variant="ghost" size="small" onClick={() => props.onClose?.()} />
          </Show>
        </div>
      </div>
      <div class="browser-content">
        <webview
          ref={webview}
          src={props.url}
          style="width: 100%; height: 100%; border: none;"
          allowpopups
        />
      </div>
    </div>
  )
}
