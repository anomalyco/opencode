/*
 * opencode-native plugin C ABI 2.0, for plugins written in C or anything with a C ABI. The Rust SDK in
 * `crates/plugin-abi/src/lib.rs` is the reference; this header follows it field by field, and
 * `crates/plugin/examples/c` is a plugin built against it, which the loader's tests build and load.
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
 * gives a 1.x library (`opencode_plugin_v1`) the table of ABI 1.4, which ends before `send`.
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
 * `src/v2.rs` are the reference.
 *
 * Manifest (what `create` returns):
 *   {"id", "commands": [{"name", "title", "group", "slash", "keybind", "palette", "description"?, "arguments"?,
 *    "scope"?}], "fences": [language], "slots": [{"kind", "path", "render"?, "mount"?}], "routes": [name],
 *    "storage": [key], "render": 2, "events"?: [[type]], "render_routes"?: [name], "wake"?: bool,
 *    "route_mounts"?: [name], "fence_gone"?: bool,
 *    "surfaces"?: [{"name", "place": {"type": "route", "name"} | {"type": "slot", "kind", "path"}, "palette"?}],
 *    "messages"?: bool}
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
 *    "input": {"width", "height", "palette": {"mode", "colors"}, "full"?}, "next": n}
 *                                     -> {"node": tree, "content"?: [[handle, content]], "memo"?: n}
 *      `memo` is how many values the plugin's memo table for the mount holds, at most the tree's nodes with an id.
 *      `content` is what the view gave the host this time, numbered next + 1, next + 2, ...; a node names it as
 *      {"content": handle}. A tree may name a subtree the last accepted tree had under an id as
 *      {"type": "keep", "key": id}. With "full" set, the host holds no tree to keep from.
 *   {"type": "unmount", "mount"}                               -> null
 *   {"type": "message", "message": "<json text>"}              -> null
 *
 * 2.0 tree nodes ("type"): "box" {"id"?, "row"?, "gap"?, "padding"?, "justify"?, "align"?, "bg"?, "layout"?,
 *   "on_click"?, "children"}, "text" {"id"?, "spans", "fg"?, "wrap"?, "truncate"?, "selectable"?, "hover_fg"?,
 *   "layout"?, "on_click"?}, "slot" {"path"}, "markdown" {"id"?, "source"}, "spinner" {"id"?, "label"},
 *   "scroll" {"id"?, "height"?, "follow"?, "layout"?, "children"}, "diff" {"id"?, "content", "view"?, "filetype"?},
 *   "keep" {"key"}. A source is {"text": text}, {"content": handle} or {"part-output": {"session", "part"}}. A tree
 *   the host cannot decode, such as one with a kind it does not know, fails the plugin and leaves no effect.
 *
 * Requests to the host (the host table's `call`), tagged by "type": "log", "toast", "storage-get", "storage-set",
 *   "storage-merge", "storage-key", "open-route", "color", "session", "family", "messages", "models", "model",
 *   "limits", "providers", "info", "mcp-servers", "integrations", "vcs", "route", "dispatch", "attention",
 *   "navigate", "fetch", "dialog", "copy", "interactive", "shortcut", "dialog-open". Effects wait until the
 *   plugin's call returns. A call that panics, or whose answer the host refuses (it cannot decode it, the tree breaks
 *   the contract, a handler answers anything but null), has none, and fails the plugin. A call that answers
 *   OPENCODE_ERROR keeps them (see above). A render or a view ("fence", "slot", "route", "render-fence", "render",
 *   "render-route", "view") reads only: the host answers OPENCODE_ERROR to any request of it that asks for something.
 *
 * Content in a view reply is a JSON string when its bytes are UTF-8, else {"base64": "..."} (RFC 4648, padded).
 * A message the host delivers ("message") is the JSON text the sender wrote, as a JSON string.
 */

#ifdef __cplusplus
}
#endif

#endif /* OPENCODE_PLUGIN_H */
