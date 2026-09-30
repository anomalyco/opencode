export * as Widget from "./widget.js"

import { Schema } from "effect"
import { ephemeral, inventory } from "./event.js"
import { optional } from "./schema.js"

export const ID = Schema.String.pipe(Schema.brand("Widget.ID"))
export type ID = typeof ID.Type

// A widget declares the capabilities it wants in its manifest. Granting is a
// separate, user-owned decision, so the requested set and the effective set are
// never the same value. "write" implies read access; "full" implies everything.
export const Capability = Schema.Literals(["read", "write", "full"]).annotate({
  identifier: "Widget.Capability",
  description:
    'Access a widget may request. "read" observes the current session, its messages, and location events; "write" adds prompt, command, interrupt, and agent/model switches; "full" additionally loads the widget same-origin with the server credential so it can call the API directly.',
})
export type Capability = typeof Capability.Type

// A widget is a user-authored HTML/JS/CSS bundle discovered on disk. The source
// records where it came from so the UI can explain how to edit or remove it.
export const Source = Schema.Union([
  Schema.Struct({ type: Schema.Literal("global"), path: Schema.String }),
  Schema.Struct({ type: Schema.Literal("project"), path: Schema.String }),
]).annotate({ identifier: "Widget.Source" })
export type Source = typeof Source.Type

// A widget that fails to load stays in the inventory with a reason so the UI can
// surface it instead of silently hiding the folder.
export const State = Schema.Union([
  Schema.Struct({ status: Schema.Literal("active") }),
  Schema.Struct({ status: Schema.Literal("failed"), error: Schema.String }),
]).annotate({ identifier: "Widget.State" })
export type State = typeof State.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  title: Schema.String,
  description: optional(Schema.String),
  source: Source,
  state: State,
  // Capabilities the widget asks for in its manifest. The user decides which to
  // grant; the requested list only tells the settings UI what to offer.
  requests: Schema.Array(Capability),
}).annotate({ identifier: "Widget.Info" })

// Emitted when the widgets directory changes so clients can refresh the list
// without restarting the server.
const Updated = ephemeral({ type: "widget.updated", schema: {} })
export const Event = { Updated, Definitions: inventory(Updated) }

// The bridge is a small postMessage contract between the app (parent) and a
// widget frame (child). It is browser-safe and shared by the app and by the
// server, which serves the helper script so a widget does not have to hand-roll
// the protocol. Message type strings are namespaced to avoid clashing with any
// other window messaging.
export const BRIDGE = {
  namespace: "opencode:widget",
  request: "opencode:widget:request",
  response: "opencode:widget:response",
  event: "opencode:widget:event",
} as const

// Reserved widget id that serves the bridge helper instead of a widget folder.
export const BRIDGE_ID = "@opencode"
export const BRIDGE_ASSET = "bridge.js"

// Widget-side helper. A widget loads it with a plain script tag and calls
// `opencode.session.prompt(...)`, `opencode.on("session.status", ...)`, and so
// on. Requests that the user has not granted are rejected by the parent.
export const BRIDGE_HELPER = `(function () {
  var pending = new Map();
  var listeners = new Map();
  var seq = 0;
  function call(method, params) {
    return new Promise(function (resolve, reject) {
      var id = "w" + (++seq) + "-" + Date.now();
      pending.set(id, { resolve: resolve, reject: reject });
      window.parent.postMessage({ type: "${BRIDGE.request}", id: id, method: method, params: params }, "*");
    });
  }
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "${BRIDGE.response}" && pending.has(data.id)) {
      var entry = pending.get(data.id);
      pending.delete(data.id);
      data.ok ? entry.resolve(data.result) : entry.reject(new Error(data.error));
      return;
    }
    if (data.type === "${BRIDGE.event}") {
      (listeners.get(data.name) || []).forEach(function (handler) { handler(data.payload); });
    }
  });
  window.opencode = {
    call: call,
    session: {
      current: function () { return call("session.current"); },
      messages: function () { return call("session.messages"); },
      status: function () { return call("session.status"); },
      prompt: function (text) { return call("session.prompt", { text: text }); },
      command: function (name, text) { return call("session.command", { name: name, text: text }); },
      interrupt: function () { return call("session.interrupt"); },
      switchAgent: function (agent) { return call("session.switchAgent", { agent: agent }); },
      switchModel: function (model) { return call("session.switchModel", { model: model }); }
    },
    location: { get: function () { return call("location.get"); } },
    context: function () { return call("widget.context"); },
    on: function (name, handler) {
      var list = listeners.get(name) || [];
      list.push(handler);
      listeners.set(name, list);
      return function () {
        listeners.set(name, (listeners.get(name) || []).filter(function (item) { return item !== handler; }));
      };
    }
  };
})();`
