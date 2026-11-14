/*
 * opencode-native plugin C ABI 2.0, for plugins written in C or anything with a C ABI. The Rust SDK in
 * `crates/plugin-abi/src/lib.rs` is the reference; this header follows it field by field, and
 * `crates/plugin/examples/c` is a plugin built against it, which the loader's tests build and load.
 *
 * Conformance. `crates/plugin/conformance` holds golden transcripts: every request and reply the host and a library
 * exchange in scripted sessions. `crates/plugin/examples/conformance` is the plugin they were recorded from, in Rust
 * and in C (`plugin.c`, on this header alone). A binding of this ABI in another language proves itself with its port of
 * that plugin: `opencode-native plugin test <library> --conformance` replays every transcript against it, also as a
 * host of a later minor.
 *
 * A plugin is a shared library that exports `opencode_plugin_v2`, which returns its `opencode_plugin_api`.
 * Everything after that crosses as JSON in byte buffers. A buffer one side returns is freed by that side's `free`,
 * so each side keeps its own allocator. Every call runs on the host's UI thread, except the entries of the host
 * table marked "any thread".
 *
 * Versions. A minor version only appends: each table starts with its own size, and an entry past the other side's
 * `size` is absent; read an entry only when `size >= offsetof(table, entry) + sizeof(entry)`, so a plugin built against
 * a later header still loads on an earlier host. Nothing is removed inside a major. A plugin that needs a newer host
 * minor sets `requires_minor`; a host older than that refuses it, as it refuses a major it does not serve. A 2.x host
 * gives a 1.x library (`opencode_plugin_v1`) the table of ABI 1.6, which ends before `send`. Either side answers a
 * request whose "type" it does not know with OPENCODE_ERROR, and changes nothing; the host sends a library no request
 * newer than the minor its table states, and a library should send the host none newer than the host's.
 *
 * What the host takes from the plugin, and what the plugin must keep to:
 *
 * - Borrowed bytes (`opencode_bytes`) are valid, and unchanged, for the length of the call that passes them only. They
 *   are not NUL-terminated. A null `ptr` means no bytes, with `len` 0.
 * - A buffer the plugin returns (`opencode_owned`) is one it allocated: `ptr` to `len` initialized bytes inside an
 *   allocation of `cap >= len` bytes, or `ptr` null with `len` 0. The host copies it out and hands that exact
 *   descriptor back to the plugin's `free` once, whatever the status, also when it refuses it. The host refuses,
 *   unread, a null `ptr` with a length, a `len` past `cap`, and a buffer over 256 MiB. The same holds the other way for
 *   the host's buffers and its `free`.
 * - Tables are aligned for their types. The plugin's table, and the host's `features` bytes, live as long as the
 *   library and the instance respectively.
 * - `call` and `theme_mode` of the host table are for the host's UI thread, the thread that calls the plugin; from
 *   another thread `call` answers OPENCODE_ERROR and `theme_mode` dark. Only the entries marked "any thread" are for
 *   the plugin's own threads.
 * - Nothing may unwind out of an exported function or into the host: catch C++ exceptions and Rust panics at the edge
 *   and answer OPENCODE_PANIC.
 * - A plugin's threads use the host table only until `destroy` returns. A plugin without `destroy`, or whose `create`
 *   did not answer OPENCODE_OK, gets no `destroy`: it must stop its threads itself, before `create` returns in the
 *   second case. The host keeps the table and its context of such an instance for the life of the process.
 * - In process nothing protects the host from a plugin that writes through a bad pointer, or whose allocator fails:
 *   such a fault ends the client, which restarts without the plugin.
 */

#ifndef OPENCODE_PLUGIN_H
#define OPENCODE_PLUGIN_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define OPENCODE_ABI_MAJOR 2
#define OPENCODE_ABI_MINOR 0
#define OPENCODE_ENTRY "opencode_plugin_v2"

/* Status codes. With OPENCODE_OK an output buffer holds the JSON result; otherwise the error text. */
#define OPENCODE_OK 0
/* The callee answers with an error. From the plugin, this is an answer: what the call asked the host for happens, and
 * the host then fails a 2.x plugin (a 1.x plugin's error is logged). From the host's `call`, the request was refused. */
#define OPENCODE_ERROR 1
/* The callee panicked (or threw); the output holds the message. Nothing the call asked for happens, its storage writes
 * are put back, and the host fails the plugin. */
#define OPENCODE_PANIC 2
/* `send`: the mailbox holds OPENCODE_BOUND entries, and nothing was stored. */
#define OPENCODE_FULL 3
/* `send`: the plugin has left `active`, and nothing was stored; its threads should end. */
#define OPENCODE_CLOSED 4

#define OPENCODE_THEME_DARK 0
#define OPENCODE_THEME_LIGHT 1

/* The entries of one plugin's mailbox. */
#define OPENCODE_BOUND 256

/* Bytes borrowed for the length of one call. */
typedef struct opencode_bytes {
    const uint8_t *ptr;
    size_t len;
} opencode_bytes;

/* A buffer the callee allocated; the caller copies it out, then passes it to the callee's `free`. */
typedef struct opencode_owned {
    uint8_t *ptr;
    size_t len;
    size_t cap;
} opencode_owned;

/* What the host gives a plugin instance, valid until the host destroys it. Read an entry only when `size` covers it. */
typedef struct opencode_host_api {
    size_t size;
    uint32_t major;
    uint32_t minor;
    void *ctx;
    /* Handles a host request (JSON, below) and writes the JSON result into `out`. */
    int32_t (*call)(void *ctx, opencode_bytes request, opencode_owned *out);
    /* Frees a buffer `call` wrote. */
    void (*free)(opencode_owned owned);
    /* 1.2: OPENCODE_THEME_DARK or OPENCODE_THEME_LIGHT. */
    uint32_t (*theme_mode)(void *ctx);
    /* 1.3, any thread: a redraw hint. The host runs the plugin's wake handlers, or renders its claims again. */
    void (*wake)(void *ctx);
    /* 2.0, any thread, never blocks: puts `message`, JSON text, in the mailbox, at the end with an empty `key`, else
     * in the place of the entry that waits under `key`. Returns OPENCODE_OK, OPENCODE_FULL, OPENCODE_CLOSED, or
     * OPENCODE_ERROR for a message that is not JSON. The host then sends the plugin a `message` request. */
    int32_t (*send)(void *ctx, opencode_bytes key, opencode_bytes message);
    /* 2.0, any thread: a thread of the plugin failed with `message`, text. The host fails the plugin once. */
    void (*report)(void *ctx, opencode_bytes message);
    /* 2.0, any thread: 1 once the plugin has left `active`, else 0. */
    uint32_t (*stopped)(void *ctx);
    /* 2.0: the host's optional features, a JSON array of names. */
    opencode_bytes features;
} opencode_host_api;

/* What a plugin exports. Entries added by later minor versions go at the end and are optional. */
typedef struct opencode_plugin_api {
    /* sizeof(opencode_plugin_api) as the plugin built it. */
    size_t size;
    uint32_t major;
    uint32_t minor;
    /* The oldest host minor version the plugin works with; 0 for any. */
    uint32_t requires_minor;
    /* Runs setup with `options` (the JSON of the plugin's `plugins` entry options, or empty). On OPENCODE_OK it sets
     * `instance` and writes the manifest JSON into `out`. Required. */
    int32_t (*create)(const opencode_host_api *host, opencode_bytes options, void **instance, opencode_owned *out);
    /* Handles a request (JSON, below) and writes the JSON result into `out`. Required. */
    int32_t (*call)(void *instance, opencode_bytes request, opencode_owned *out);
    /* Destroys an instance. Optional. After it returns no thread of the plugin may call the host table. */
    void (*destroy)(void *instance);
    /* Frees a buffer `create`, `call` or `describe` wrote. Required. */
    void (*free)(opencode_owned owned);
    /* 1.1: writes the metadata JSON into `out`: {"version": "...", "id": "...", "requires": ["feature", ...]}. */
    int32_t (*describe)(opencode_owned *out);
} opencode_plugin_api;

/* What makes the entry visible from the library: exported from a DLL on Windows, and of default visibility where a
 * build hides symbols by default (`-fvisibility=hidden`). Define it before including this header to change it. */
#ifndef OPENCODE_EXPORT
#if defined(_WIN32) || defined(__CYGWIN__)
#define OPENCODE_EXPORT __declspec(dllexport)
#elif defined(__GNUC__) || defined(__clang__)
#define OPENCODE_EXPORT __attribute__((visibility("default")))
#else
#define OPENCODE_EXPORT
#endif
#endif

/* The entry every 2.x plugin exports. A 1.x plugin exports `opencode_plugin_v1` with the same table; the host serves
 * it ABI 1.4. */
OPENCODE_EXPORT const opencode_plugin_api *opencode_plugin_v2(void);

/*
 * The message schema. Every message is a JSON object; a request is tagged by "type". Fields with a default may be
 * left out, and a reader ignores fields it does not know. The Rust types in `crates/plugin-abi/src/lib.rs` and
 * `src/v2.rs` and `src/claim.rs` are the reference.
 *
 * Manifest (what `create` returns):
 *   {"id", "commands": [{"name", "title", "group", "slash", "keybind", "palette", "description"?, "arguments"?,
 *    "scope"?}], "fences": [language], "slots": [{"kind", "path", "render"?, "mount"?}], "routes": [name],
 *    "storage": [key], "render": 2, "events"?: [[type]], "render_routes"?: [name], "wake"?: bool,
 *    "route_mounts"?: [name], "fence_gone"?: bool,
 *    "surfaces"?: [{"name", "place": {"type": "route", "name"} | {"type": "slot", "kind", "path"}
 *      | {"type": "panel", "name"} | {"type": "overlay", "name"}, "palette"?, "draw"?: bool, "notify"?: [notify],
 *      "layout"?: bool, "handler"?: bool, "layers"?: [layer], "mounts"?: bool}],
 *    "claims"?: [{"target": {"type": "tool" | "fence", "name"}, "palette"?}],
 *    "messages"?: bool, "layers"?: [layer], "searches"?: [name]}
 *   A layer is {"scope": "surface" | {"node": id} | "composer" | "global", "priority"?, "mode"?,
 *    "keys"?: [{"key", "name", "title"?, "hold"?}], "any"?, "paste"?}.
 *
 * Requests from the host (`call`), with their results:
 *   {"type": "command", "name", "input"}                      -> null
 *   {"type": "render-fence", fence fields, "index"}            -> {"type": "code" | "keep" | "lines", ...}
 *   {"type": "render", "claim", "input", "changed"}            -> {"type": "keep" | "hide" | "show", "node"}
 *   {"type": "render-route", "name", "changed"}                -> the same
 *   {"type": "event", "handler", "event"}                      -> null
 *   {"type": "reply", "id", "result": {"Ok": json} | {"Err": text}} -> null
 *   {"type": "mount", "claim", "input", "mounted"}             -> null
 *   {"type": "route-mount", "name", "mounted"}                 -> null
 *   {"type": "wake"}                                           -> null
 *   {"type": "fence-gone", "key"}                              -> null
 *   2.0:
 *   {"type": "view", "surface": index, "mount": {"surface", "key", "generation"},
 *    "input": {"width", "height", "palette": {"mode", "colors"}, "full"?, "changed"?, "slot"?}, "next": n}
 *                                     -> {"node": tree, "content"?: [[handle, content]], "memo"?: n}
 *      `memo` is how many values the plugin's memo table for the mount holds, at most the tree's nodes with an id.
 *      `content` is what the view gave the host this time, numbered next + 1, next + 2, ...; a node names it as
 *      {"content": handle}. A tree may name a subtree the last accepted tree had under an id as
 *      {"type": "keep", "key": id}. With "full" set, the host holds no tree to keep from. "changed" is what changed
 *      since the mount's last view, as in "render"; a keep of the last tree's root keeps the mount as it is. "slot" is a
 *      slot surface's input, as in "render".
 *   {"type": "draw", "surface": index, "mount", "canvas": id,
 *    "frame": {"width", "height", "cause": "first" | "resized" | "version" | "animate", "dt": {"secs", "nanos"}}}
 *                                     -> the canvas's list as bytes, not JSON; none keeps the list the host holds
 *      The host sends it only for a surface whose manifest entry has "draw", for one of its canvases, as it paints the
 *      canvas at the frame's size. "dt" is the animation's time since its last frame, zero for the other causes. The
 *      list's format is in `crates/plugin-abi/src/canvas.rs`: a version byte (1), then records of an operation byte, a
 *      little-endian u32 payload length and the payload. One the host cannot read fails the plugin; one over a limit
 *      shows a placeholder.
 *   {"type": "claim", "claim": index, "mount", "input", "part", "next": n}
 *                                     -> {"node": tree | null, "content"?, "released"?, "memo"?}
 *      A renderer claim's view of one part: a tool call {"type": "tool", "session", "message", "state": "pending" |
 *      "running" | "completed" | "error", "permission", "tool": the transcript's tool part without what the call
 *      returned, which a "part-output" source names, and without metadata over 4096 bytes of JSON}, or a fence
 *      {"type": "fence", "language", "info", "code", "streaming", "closed"}. A null node leaves the part to the
 *      host's own row. The rest is as for "view", but "height" is 0: a part is as tall as its tree. Each part is a
 *      mount of its own.
 *   {"type": "unmount", "mount"}                               -> null
 *   {"type": "message", "message": "<json text>"}              -> null
 *   2.0 (P3), for a surface the manifest says has them:
 *   {"type": "layout", "surface": index, "geometry": {"rects", "scrolls", "groups", "tops", "moved_only",
 *    "reached", "transcript"?}}                                -> {"paints"?: [{"node", "bg"}], "again"?: bool}
 *      After the solve, when something the surface's "notify" names changed. It reads only, as a view does.
 *   2.0 (P2), with P3's scroll and input events:
 *   {"type": "input", "to": {"type": "surface", "surface": index} | {"type": "layer", "layer": index},
 *    "event": {"type": "key" | "paste" | "pointer" | "hover" | "closed", ...} |
 *     {"type": "scroll", "event": {"type": "landed", "scroll", "anchor"} | {"type": "user-scroll", "scroll"}} |
 *     {"type": "change" | "submit", "node", "text"} |
 *     {"type": "mount", "mount": {"surface", "key", "generation"}, "mounted", "slot"?}} -> "consume" | "pass"
 *      A surface's handler hears the events of the mount the host routed them to; what it reads and asks of the input
 *      ("rect", "focused", "input-mode", "focus", "set-mode", "overlay", "scroll", ...) is that mount's. A layer of the
 *      manifest is the plugin's own. A scroll's and an input's events go to the surface's handler; the answer to them
 *      does not matter.
 *   {"type": "search", "name", "query", "options": [option]}   -> [value]
 *
 * 2.0 tree nodes ("type"): "box" {"id"?, "row"?, "gap"?, "padding"?, "justify"?, "align"?, "bg"?, "layout"?,
 *   "on_click"?, "children", "visible"?}, "text" {"id"?, "spans", "fg"?, "wrap"?, "truncate"?, "selectable"?, "hover_fg"?,
 *   "layout"?, "on_click"?}, "slot" {"path"}, "markdown" {"id"?, "source"}, "spinner" {"id"?, "label"},
 *   "scroll" {"id"?, "height"?, "follow"?, "layout"?, "children"}, "diff" {"id"?, "content", "view"?, "filetype"?},
 *   "canvas" {"id", "layout"?, "version"?, "animate"?}, "keep" {"key"}. A source is {"text": text},
 *   {"content": handle} or {"part-output": {"session", "part"}}. A tree the host cannot decode, such as one with a
 *   kind it does not know, fails the plugin and leaves no effect.
 *
 * Requests to the host (the host table's `call`), tagged by "type". Those that read, or shape only the call's own
 *   effects: "log", "storage-get", "storage-key", "color", "session", "family", "messages", "models", "model",
 *   "limits", "providers", "info", "mcp-servers", "integrations", "vcs", "route", "interactive", "shortcut",
 *   "dialog-open", 1.5 "composer", "checkpoint", "rollback", 1.6 "variants", "tabs-enabled", "tabs",
 *   "keymap-pending", "keymap-active", "keymap-commands", "shortcuts", "selection", "theme", "themes", 2.0 (P3)
 *   "scroll-state" {"target"}, "anchors" {"target", "group"}, "top-anchor" {"target", "group", "inset"?},
 *   "transcript", 2.0 (P2) "rect", "focused", "input-mode", 2.0 (P6a) "message" {"session", "message"} (one
 *   message, or null). Those that ask for something: "toast", "storage-set",
 *   "storage-merge", "open-route", "dispatch", "attention", "navigate", "fetch", "dialog", "copy", 1.5
 *   "composer-edit", 1.6 "set-variant", "set-model", "tab", "clear-selection", "foreground", "title", "set-theme",
 *   "install-theme", 2.0 (P3) "scroll" {"target", "verb"}, 2.0 (P2) "open-panel", "close-panel", "overlay",
 *   "close-overlay", "focus", "blur", "set-mode", "release-keys" (none of P2's during `create`, which has no input
 *   yet). `crates/plugin-abi/schema/v2.json` has the types of P3's (Target, Scroll, ScrollState, AnchorAt, Geometry,
 *   LayoutReply, ScrollEvent, TranscriptView). Effects wait until the plugin's call returns. A call that panics, or
 *   whose answer the host refuses (it cannot decode it, the tree breaks the contract, a handler answers anything but
 *   null), has none, and fails the plugin. A call that answers OPENCODE_ERROR keeps them (see above). A render of 1.4
 *   on, a view, a claim's view, a draw, a layout or a search ("render-fence", "render", "render-route", "view",
 *   "claim", "draw", "layout", "search") reads only, as in process, where these get the host's reads alone: the host
 *   answers OPENCODE_ERROR to any request of it that asks for something. A
 *   render of 1.3 ("fence", "slot", "route") may ask, and what it asks for happens when the host draws its answer. A
 *   "scroll" of the transcript is taken only from a call that answers the user's input (a key, a click, an edit, the
 *   palette, the user's scroll): the host answers OPENCODE_ERROR to any other.
 *
 * Content in a view reply is a JSON string when its bytes are UTF-8, else {"base64": "..."} (RFC 4648, padded).
 * A message the host delivers ("message") is the JSON text the sender wrote, as a JSON string.
 */

#ifdef __cplusplus
}
#endif

#endif /* OPENCODE_PLUGIN_H */
