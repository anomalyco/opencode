import { HttpServerResponse } from "effect/unstable/http"

const html = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="color-scheme" content="dark light" />
  <title>OpenCode Remote</title>
  <style>
    :root { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color-scheme: dark light; }
    * { box-sizing: border-box; }
    body { margin: 0; background: Canvas; color: CanvasText; }
    button, textarea, input { font: inherit; }
    button { cursor: pointer; }
    .shell { min-height: 100dvh; display: grid; grid-template-rows: auto 1fr auto; }
    header { position: sticky; top: 0; z-index: 5; padding: max(12px, env(safe-area-inset-top)) 16px 12px; border-bottom: 1px solid color-mix(in srgb, CanvasText 14%, transparent); background: color-mix(in srgb, Canvas 94%, transparent); backdrop-filter: blur(12px); }
    header strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .status { margin-top: 4px; font-size: 12px; opacity: .65; }
    main { width: min(820px, 100%); margin: 0 auto; padding: 18px 14px 180px; }
    .empty { opacity: .6; text-align: center; padding: 56px 16px; }
    .message { margin: 0 0 14px; padding: 12px 14px; border: 1px solid color-mix(in srgb, CanvasText 12%, transparent); border-radius: 14px; background: color-mix(in srgb, CanvasText 3%, transparent); }
    .message.user { margin-left: max(0px, 12%); }
    .role { margin-bottom: 7px; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; opacity: .55; }
    .text { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.45; }
    .tool { margin-top: 8px; padding: 8px 10px; border-radius: 9px; background: color-mix(in srgb, CanvasText 5%, transparent); font-size: 12px; opacity: .8; }
    .requests { display: grid; gap: 12px; margin: 0 0 18px; }
    .request { padding: 12px; border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 12px; }
    .request h3 { margin: 0 0 8px; font-size: 14px; }
    .request p { margin: 6px 0 10px; font-size: 13px; opacity: .75; white-space: pre-wrap; overflow-wrap: anywhere; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .actions button, .composer button { border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 9px; padding: 8px 11px; background: color-mix(in srgb, CanvasText 7%, transparent); color: inherit; }
    .actions button.primary, .composer button.primary { background: CanvasText; color: Canvas; }
    fieldset { border: 0; padding: 0; margin: 10px 0; }
    legend { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
    label.option { display: flex; gap: 8px; padding: 5px 0; font-size: 13px; align-items: flex-start; }
    label.option span small { display: block; opacity: .6; margin-top: 2px; }
    .custom { width: 100%; border: 1px solid color-mix(in srgb, CanvasText 16%, transparent); border-radius: 8px; padding: 8px; background: Canvas; color: CanvasText; }
    .composer { position: fixed; left: 0; right: 0; bottom: 0; z-index: 6; padding: 10px 12px max(10px, env(safe-area-inset-bottom)); background: color-mix(in srgb, Canvas 95%, transparent); border-top: 1px solid color-mix(in srgb, CanvasText 14%, transparent); backdrop-filter: blur(12px); }
    .composer-inner { width: min(820px, 100%); margin: 0 auto; display: grid; grid-template-columns: 1fr auto; gap: 8px; }
    textarea { min-height: 52px; max-height: 180px; resize: vertical; width: 100%; border: 1px solid color-mix(in srgb, CanvasText 16%, transparent); border-radius: 12px; padding: 10px 12px; background: Canvas; color: CanvasText; }
    .composer-actions { display: flex; flex-direction: column; gap: 7px; }
    .error { color: #d94c4c; }
    [hidden] { display: none !important; }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <strong id="title">OpenCode Remote</strong>
      <div class="status" id="status">Connecting…</div>
    </header>
    <main>
      <section class="requests" id="requests"></section>
      <section id="messages"><div class="empty">Pairing with desktop…</div></section>
    </main>
    <div class="composer" id="composer" hidden>
      <div class="composer-inner">
        <textarea id="prompt" rows="2" placeholder="Send an instruction to OpenCode…"></textarea>
        <div class="composer-actions">
          <button class="primary" id="send" type="button">Send</button>
          <button id="stop" type="button">Stop</button>
        </div>
      </div>
    </div>
  </div>
  <script>
    (function () {
      "use strict"

      var STORAGE_KEY = "opencode.remote.grant.v1"
      var EXPIRED_MESSAGE = "Remote access expired or was replaced by another phone."
      var state = { token: "", sessionID: "", refreshTimer: 0, streamAbort: null, connected: false }
      var title = document.getElementById("title")
      var status = document.getElementById("status")
      var messages = document.getElementById("messages")
      var requests = document.getElementById("requests")
      var composer = document.getElementById("composer")
      var prompt = document.getElementById("prompt")
      var send = document.getElementById("send")
      var stop = document.getElementById("stop")

      function setStatus(text, error) {
        status.textContent = text
        status.className = error ? "status error" : "status"
      }

      function expireRemoteAccess() {
        sessionStorage.removeItem(STORAGE_KEY)
        state.token = ""
        state.sessionID = ""
        state.connected = false
        clearTimeout(state.refreshTimer)
        state.refreshTimer = 0
        if (state.streamAbort && !state.streamAbort.signal.aborted) state.streamAbort.abort()
        state.streamAbort = null
        composer.hidden = true
        setStatus(EXPIRED_MESSAGE, true)
        return new Error(EXPIRED_MESSAGE)
      }

      function api(path, init) {
        var options = init || {}
        var headers = new Headers(options.headers || {})
        headers.set("Authorization", "Bearer " + state.token)
        if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json")
        return fetch(path, Object.assign({}, options, { headers: headers })).then(function (response) {
          if (response.status === 401 || response.status === 403) throw expireRemoteAccess()
          if (!response.ok) throw new Error("Request failed (" + response.status + ")")
          if (response.status === 204) return null
          var type = response.headers.get("content-type") || ""
          return type.indexOf("application/json") >= 0 ? response.json() : response.text()
        })
      }

      function saveGrant(grant) {
        state.token = grant.token
        state.sessionID = grant.sessionID
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ token: grant.token, sessionID: grant.sessionID }))
      }

      function restoreGrant() {
        try {
          var raw = sessionStorage.getItem(STORAGE_KEY)
          if (!raw) return false
          var grant = JSON.parse(raw)
          if (!grant || typeof grant.token !== "string" || typeof grant.sessionID !== "string") {
            sessionStorage.removeItem(STORAGE_KEY)
            return false
          }
          state.token = grant.token
          state.sessionID = grant.sessionID
          return true
        } catch (_) {
          sessionStorage.removeItem(STORAGE_KEY)
          return false
        }
      }

      async function redeemTicket() {
        var fragment = new URLSearchParams(location.hash.slice(1))
        var ticket = fragment.get("ticket")
        if (location.hash) history.replaceState(null, "", location.pathname + location.search)
        if (!ticket) return restoreGrant()

        var response = await fetch("/remote/pair", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticket: ticket }),
        })
        if (!response.ok) throw new Error("Pairing link is invalid or has expired.")
        saveGrant(await response.json())
        return true
      }

      function clear(node) {
        while (node.firstChild) node.removeChild(node.firstChild)
      }

      function node(tag, className, text) {
        var element = document.createElement(tag)
        if (className) element.className = className
        if (text !== undefined) element.textContent = text
        return element
      }

      function textForMessage(message) {
        var parts = Array.isArray(message.parts) ? message.parts : []
        return parts.filter(function (part) { return part && part.type === "text" && typeof part.text === "string" })
          .map(function (part) { return part.text })
          .join("\n")
      }

      function renderMessages(data) {
        clear(messages)
        if (!Array.isArray(data.messages) || data.messages.length === 0) {
          messages.appendChild(node("div", "empty", "No messages yet."))
          return
        }

        data.messages.forEach(function (message) {
          var role = message.info && message.info.role === "user" ? "user" : "assistant"
          var card = node("article", "message " + role)
          card.appendChild(node("div", "role", role))
          var text = textForMessage(message)
          if (text) card.appendChild(node("div", "text", text))

          var parts = Array.isArray(message.parts) ? message.parts : []
          parts.filter(function (part) { return part && part.type === "tool" }).forEach(function (part) {
            var toolName = typeof part.tool === "string" ? part.tool : "tool"
            var toolStatus = part.state && typeof part.state.status === "string" ? part.state.status : ""
            card.appendChild(node("div", "tool", toolName + (toolStatus ? " · " + toolStatus : "")))
          })
          messages.appendChild(card)
        })
      }

      async function replyPermission(requestID, reply) {
        await api("/remote/session/" + encodeURIComponent(state.sessionID) + "/permission/" + encodeURIComponent(requestID), {
          method: "POST",
          body: JSON.stringify({ reply: reply }),
        })
        await refresh()
      }

      function renderPermissions(items) {
        items.forEach(function (item) {
          var card = node("section", "request")
          card.appendChild(node("h3", "", "Permission: " + item.permission))
          if (Array.isArray(item.patterns) && item.patterns.length) card.appendChild(node("p", "", item.patterns.join("\n")))
          var actions = node("div", "actions")
          ;[["Allow once", "once"], ["Always allow", "always"], ["Reject", "reject"]].forEach(function (entry) {
            var button = node("button", entry[1] === "once" ? "primary" : "", entry[0])
            button.type = "button"
            button.addEventListener("click", function () { replyPermission(item.id, entry[1]).catch(fail) })
            actions.appendChild(button)
          })
          card.appendChild(actions)
          requests.appendChild(card)
        })
      }

      async function replyQuestion(requestID, answers) {
        await api("/remote/session/" + encodeURIComponent(state.sessionID) + "/question/" + encodeURIComponent(requestID), {
          method: "POST",
          body: JSON.stringify({ answers: answers }),
        })
        await refresh()
      }

      async function rejectQuestion(requestID) {
        await api("/remote/session/" + encodeURIComponent(state.sessionID) + "/question/" + encodeURIComponent(requestID) + "/reject", { method: "POST" })
        await refresh()
      }

      function renderQuestions(items) {
        items.forEach(function (item) {
          var form = node("form", "request")
          form.appendChild(node("h3", "", "OpenCode needs your answer"))
          var fields = []

          ;(item.questions || []).forEach(function (question, questionIndex) {
            var fieldset = node("fieldset", "")
            fieldset.appendChild(node("legend", "", question.question || question.header || "Question"))
            var group = "q-" + item.id + "-" + questionIndex
            var controls = []
            ;(question.options || []).forEach(function (option) {
              var label = node("label", "option")
              var input = document.createElement("input")
              input.type = question.multiple ? "checkbox" : "radio"
              input.name = group
              input.value = option.label
              var words = node("span", "", option.label)
              if (option.description) words.appendChild(node("small", "", option.description))
              label.appendChild(input)
              label.appendChild(words)
              fieldset.appendChild(label)
              controls.push(input)
            })
            var custom = null
            if (question.custom !== false) {
              custom = document.createElement("input")
              custom.type = "text"
              custom.className = "custom"
              custom.placeholder = "Custom answer"
              fieldset.appendChild(custom)
            }
            fields.push({ controls: controls, custom: custom })
            form.appendChild(fieldset)
          })

          var actions = node("div", "actions")
          var submit = node("button", "primary", "Submit")
          submit.type = "submit"
          var reject = node("button", "", "Dismiss")
          reject.type = "button"
          reject.addEventListener("click", function () { rejectQuestion(item.id).catch(fail) })
          actions.appendChild(submit)
          actions.appendChild(reject)
          form.appendChild(actions)
          form.addEventListener("submit", function (event) {
            event.preventDefault()
            var answers = fields.map(function (field) {
              var selected = field.controls.filter(function (control) { return control.checked }).map(function (control) { return control.value })
              var custom = field.custom && field.custom.value.trim()
              if (custom) selected.push(custom)
              return selected
            })
            replyQuestion(item.id, answers).catch(fail)
          })
          requests.appendChild(form)
        })
      }

      function renderRequests(data) {
        clear(requests)
        renderPermissions(Array.isArray(data.permissions) ? data.permissions : [])
        renderQuestions(Array.isArray(data.questions) ? data.questions : [])
      }

      async function refresh() {
        var data = await api("/remote/session/" + encodeURIComponent(state.sessionID))
        title.textContent = data.session && data.session.title ? data.session.title : "OpenCode Remote"
        var kind = data.status && data.status.type ? data.status.type : "idle"
        setStatus(state.connected ? kind + " · live" : kind + " · connecting")
        renderRequests(data)
        renderMessages(data)
        composer.hidden = false
      }

      function scheduleRefresh() {
        if (!state.token || !state.sessionID) return
        clearTimeout(state.refreshTimer)
        state.refreshTimer = setTimeout(function () { refresh().catch(fail) }, 180)
      }

      async function streamEvents() {
        if (state.streamAbort) state.streamAbort.abort()
        var controller = new AbortController()
        state.streamAbort = controller
        var response = await fetch("/remote/session/" + encodeURIComponent(state.sessionID) + "/events", {
          headers: { Authorization: "Bearer " + state.token, Accept: "text/event-stream" },
          signal: controller.signal,
        })
        if (response.status === 401 || response.status === 403) throw expireRemoteAccess()
        if (!response.ok || !response.body) throw new Error("Live connection failed (" + response.status + ")")
        state.connected = true
        scheduleRefresh()

        var reader = response.body.getReader()
        var decoder = new TextDecoder()
        var buffer = ""
        while (true) {
          var result = await reader.read()
          if (result.done) break
          buffer += decoder.decode(result.value, { stream: true })
          var boundary
          while ((boundary = /\r\n\r\n|\n\n|\r\r/.exec(buffer))) {
            var block = buffer.slice(0, boundary.index).replace(/\r/g, "")
            buffer = buffer.slice(boundary.index + boundary[0].length)
            if (block.split("\n").some(function (line) { return line.indexOf("data:") === 0 })) scheduleRefresh()
          }
        }
        state.connected = false
        scheduleRefresh()
      }

      async function reconnectLoop() {
        while (state.token && state.sessionID) {
          try {
            await streamEvents()
          } catch (error) {
            if (!state.token || !state.sessionID) return
            if (state.streamAbort && state.streamAbort.signal.aborted) return
            state.connected = false
            setStatus(error instanceof Error ? error.message : String(error), true)
          }
          if (!state.token || !state.sessionID) return
          await new Promise(function (resolve) { setTimeout(resolve, 1200) })
        }
      }

      async function submitPrompt() {
        var text = prompt.value.trim()
        if (!text) return
        send.disabled = true
        try {
          await api("/remote/session/" + encodeURIComponent(state.sessionID) + "/message", {
            method: "POST",
            body: JSON.stringify({ parts: [{ type: "text", text: text }] }),
          })
          prompt.value = ""
          scheduleRefresh()
        } finally {
          send.disabled = false
        }
      }

      async function abortSession() {
        await api("/remote/session/" + encodeURIComponent(state.sessionID) + "/abort", { method: "POST" })
        scheduleRefresh()
      }

      function fail(error) {
        setStatus(error instanceof Error ? error.message : String(error), true)
      }

      send.addEventListener("click", function () { submitPrompt().catch(fail) })
      stop.addEventListener("click", function () { abortSession().catch(fail) })
      prompt.addEventListener("keydown", function (event) {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault()
          submitPrompt().catch(fail)
        }
      })

      redeemTicket().then(function (paired) {
        if (!paired) throw new Error("Open this page from a fresh OpenCode Remote QR code.")
        return refresh()
      }).then(function () {
        reconnectLoop()
      }).catch(fail)
    })()
  </script>
</body>
</html>`

export function markup() {
  return html
}

export function response() {
  return HttpServerResponse.text(html, {
    contentType: "text/html; charset=utf-8",
    headers: {
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; connect-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  })
}

export * as RemoteMobile from "./mobile"
