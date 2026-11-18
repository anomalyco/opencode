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
 * Everything after that crosses as JSON in byte buffers, but a draw's answer, which is bytes ("The messages", below).
 * A buffer one side returns is freed by that side's `free`,
 * so each side keeps its own allocator. Every call runs on the host's UI thread, except the entries of the host
 * table marked "any thread".
 *
 * Versions. Every entry of both tables below is in 2.0, and a table shorter than that is refused. A later minor only
 * appends: each table starts with its own size, and an entry past the other side's `size` is absent; read an entry a
 * later minor adds only when `size >= offsetof(table, entry) + sizeof(entry)`, so a plugin built against a later header
 * still loads on an earlier host. Nothing is removed inside a major. A plugin that needs a newer host minor sets
 * `requires_minor`; a host older than that refuses it, as it refuses a major it does not serve, ABI 1.x included.
 * Either side answers a request whose "type" it does not know with OPENCODE_ERROR, and changes nothing; the host sends
 * a library no request newer than the minor its table states, and a library should send the host none newer than the
 * host's.
 *
 * What the host takes from the plugin, and what the plugin must keep to:
 *
 * - Borrowed bytes (`opencode_bytes`) are valid, and unchanged, for the length of the call that passes them only: one
 *   readable allocation of `len` bytes. They are not NUL-terminated. A null `ptr` means no bytes, with `len` 0. The
 *   receiver refuses, unread, a null `ptr` with a length and a length over 256 MiB; `call` answers OPENCODE_ERROR and
 *   `send` OPENCODE_ERROR, and `report` reads at most the 4 KiB the host keeps of a report.
 * - A buffer either side returns (`opencode_owned`) is one it allocated: `ptr` to `len` initialized bytes inside an
 *   allocation of `cap >= len` bytes, or `ptr` null with `len` 0. The receiver copies it out and hands that exact
 *   descriptor back to the other side's `free` once, whatever the status, also when it refuses it. It refuses,
 *   unread, a null `ptr` with a length, a `len` past `cap`, and a buffer over 256 MiB. A `free` frees by `ptr` and
 *   `cap` and does not read `len`; it cannot check the descriptor, so each side hands back exactly what it received.
 * - An `out` pointer is writable and aligned for an `opencode_owned` for the length of the call; a callee writes it
 *   once, also when it answers an error.
 * - The one reentrant direction is the plugin's: while the host's `call` into a plugin runs, the plugin may call the
 *   host table's `call` on the same thread. The host never calls into an instance while one of its calls runs.
 * - `free` and `destroy` return nothing, so they cannot answer OPENCODE_PANIC: each contains its own failure (catches
 *   it and returns).
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
 * the host then fails the plugin. From the host's `call`, the request was refused. */
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
    /* OPENCODE_THEME_DARK or OPENCODE_THEME_LIGHT. */
    uint32_t (*theme_mode)(void *ctx);
    /* Any thread: a redraw hint. The host runs the plugin's wake handlers, or renders its claims again. */
    void (*wake)(void *ctx);
    /* Any thread, never blocks: puts `message`, JSON text, in the mailbox, at the end with an empty `key`, else
     * in the place of the entry that waits under `key`. Returns OPENCODE_OK, OPENCODE_FULL, OPENCODE_CLOSED, or
     * OPENCODE_ERROR for a message that is not JSON. The host then sends the plugin a `message` request. */
    int32_t (*send)(void *ctx, opencode_bytes key, opencode_bytes message);
    /* Any thread: a thread of the plugin failed with `message`, text. The host fails the plugin once. */
    void (*report)(void *ctx, opencode_bytes message);
    /* Any thread: 1 once the plugin has left `active`, else 0. */
    uint32_t (*stopped)(void *ctx);
    /* The host's optional features, a JSON array of names. */
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
    /* Writes the metadata JSON into `out`: {"version": "...", "id": "...", "requires": ["feature", ...]}. Required. */
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

/* The entry every 2.x plugin exports. */
OPENCODE_EXPORT const opencode_plugin_api *opencode_plugin_v2(void);

/*
 * The messages. Their schema is `crates/plugin-abi/schema/v2.json` (JSON Schema 2020-12, `$id` .../plugin-abi/2.0.json),
 * generated from the Rust types and normative for every binding; the definitions named below are its `$defs`, and
 * its `x-messages` names the definition of each request type's answer. Every message is JSON but a draw's answer,
 * which is bytes (`DrawList`). A request is tagged by "type". A field the schema leaves out of "required" may be left
 * out, and a reader ignores a field it does not know. The HTTP API's types (a session, a message, a model) are
 * references into the API's OpenAPI document, `packages/protocol/openapi.json`, relative to the schema's file.
 * `describe` answers `Metadata`, whose "id" is required and nonempty. `crates/plugin/conformance` holds every message of
 * its scripted sessions, each of which the schema takes.
 *
 * - `describe` answers `Metadata`; a library names a nonempty "id", which the host reads before it runs any
 *   `create`, so setup runs once, at activation. Loading a library runs its native initializers, never its setup.
 * - `create` answers `Manifest`: what the plugin registered. A request names a registration by its index in the
 *   manifest's list ("claim" a slot claim, "surface" a surface, "handler" an event handler, "layer" a layer).
 * - The host's `call` sends a `Request`; the host table's `call` takes a `HostRequest`.
 *
 * What the requests of the host mean (`Request`):
 * - "command", "event", "reply", "mount", "route-mount", "wake", "fence-gone", "cancelled", "deltas", "unmount",
 *   "message" and "plugins" run the plugin's handlers and answer null. "reply" carries {"Ok": json} or {"Err": text};
 *   "message" the JSON text a thread sent, as a JSON string; "plugins" goes to a plugin whose manifest has "plugins".
 *   "cancelled" goes to a plugin whose manifest has "cancelled", once for each request ("id") the host cancelled as
 *   the mount that owned it closed: no "reply" comes for it, before or after. A "command" may answer "pass" instead,
 *   which declines the key that ran it: the key goes on as if the command were not there. A command of the manifest
 *   with "enabled" false binds no key and is in neither the palette nor the slash list until the host request
 *   "set-enabled" ({"name", "enabled"}, an effect) enables it.
 * - "render-fence", "render" and "render-route" answer `Fenced` and `Render`.
 * - "view" (2.0) answers `ViewReply`. Its "content" is what the view gave the host this time, numbered "next" + 1,
 *   "next" + 2, ...; a node names it as {"content": handle}, and "released" lets the host drop handles. "memo" is how
 *   many values the plugin's memo table for the mount holds, at most the tree's nodes with an id. A tree may name a
 *   subtree the last accepted tree had under an id as {"type": "keep", "key": id}; with "full" in the input the host
 *   holds no tree to keep from, and a keep of the last tree's root keeps the mount as it is. "changed" is what changed
 *   since the mount's last view; "slot" a slot surface's input.
 * - "claim" (2.0) answers `ClaimReply`: a renderer claim's view of one part, a tool call or a fence, each part a mount
 *   of its own and as tall as its tree ("height" 0). A null node leaves the part to the host's own row. A tool part
 *   leaves out what the call returned, which a "part-output" source names, and metadata over 4096 bytes of JSON.
 * - "draw" (2.0) answers a `DrawList`, bytes, or none to keep the list the host holds. The host sends it only for a
 *   surface whose manifest entry has "draw", for one of its canvases, as it paints the canvas at the frame's size;
 *   "dt" is the animation's time since its last frame, zero for the other causes. A list the host cannot read fails
 *   the plugin; one over a limit shows a placeholder. A reader skips an operation it does not know.
 * - "layout" (2.0) answers `LayoutReply`, for a surface whose manifest entry has "layout", after the solve, when
 *   something its "notify" names changed. Its geometry's "mount" is the mount it is for.
 * - "input" (2.0) answers `Handled` ("consume" or "pass"). A surface's handler hears the events of the mount the host
 *   routed them to, which "to" names in "mount" (none for a "mount" event, which the plugin hears and which names its
 *   mount); what the handler reads and asks of the input ("rect", "focused", "input-mode", "focus", "set-mode",
 *   "overlay", "scroll", ...) is that mount's. A layer of the manifest is the plugin's own. The answer to a scroll's
 *   and an input node's events does not matter.
 * - "search" (2.0) answers the values of the options to list, in order.
 *
 * Tree nodes (`Node`, by "type"): "box", "text", "slot", "markdown", "spinner", "scroll", "diff", "input", "list",
 * "code", "image", "keep", "canvas" and "fence". A source (`Source`) is {"text": text}, {"content": handle} or
 * {"part-output": {"session", "part"}}. A dialog's body and a render's node are a `RenderNode`. A tree the
 * host cannot decode, such as one with a kind it does not know, fails the plugin and leaves no effect: a library
 * lowers a kind of a later minor, or of a feature the host does not list, for that host before it answers (the Rust
 * SDK's `View::or`). A "fence" is the host's own code view of the fence a claim draws, current with each revision of
 * it with no call: a host with the feature "fence-node" takes it in a fence claim's tree only, at most once, refuses
 * any other tree that holds it (a surface's view fails the plugin, a claim's tree shows the host's own row), and
 * charges it one node and one row, whatever its code.
 *
 * What the requests to the host do (`HostRequest`):
 * - Effects wait until the plugin's call returns. A call that panics, or whose answer the host refuses (it cannot
 *   decode it, the tree breaks the contract, a handler answers anything but null), has none, and fails the plugin;
 *   so does a `create` whose buffer the host refuses, whatever its status. A call that answers OPENCODE_ERROR keeps
 *   them (see above).
 * - A render, a view, a claim's view, a draw, a layout and a search read only: the host answers OPENCODE_ERROR to any
 *   request of theirs that asks for something.
 * - A "scroll" of the transcript is taken only from a call that answers the user's input (a key, a click, an edit,
 *   the palette, the user's scroll): the host answers OPENCODE_ERROR to any other. None of the input requests ("focus",
 *   "set-mode", "overlay", ...) is taken during `create`, which has no input yet. A "focus" names a box that is
 *   focusable, or, on a host with the feature "focus-input", an "input" with an id, which then takes what the user
 *   types; a node in a hidden box, and any focus while a host dialog is open, is not taken. A node the mount's tree
 *   does not hold yet takes the focus if the mount's next view (the one after the call) shows it, and is dropped if
 *   it does not: a later view, after a resize or a theme, does not apply it.
 * - "fetch", "foreground" and "timer" answer the ID their one reply comes back with ("reply"), never 0, which names no
 *   request: an SDK refuses an answer of 0 as malformed. A "timer"'s reply is {"Ok": null} once "ms" milliseconds
 *   passed on the host's clock, at least 20; with 32 timers of the plugin waiting already, it is {"Err": why} at once.
 *   A mount's timer is owned as a mount's fetch is. "cancel-timer" {"id"} lets a timer go once the call's earlier
 *   effects apply: it fires no more and frees its place; another ID, or a timer that fired, is ignored. One the host
 *   does not take, as while the effects that wait fill its queue, answers OPENCODE_ERROR with why, and no reply comes
 *   for it: the Rust SDK's `Host::try_fetch` returns that as an `Err`. A request a mount's call asks for (a "command"
 *   of the route it shows, an "input" to that mount) is the mount's: once it closes, the request is not sent, a program
 *   does not start, and its "reply" is dropped, also for the surface opened again under the same key. Any other is the
 *   activation's, whose reply comes until `destroy`: so is one of the "input" of a "mount" event, at its begin as at
 *   its end, whose "to" names no mount.
 * - "owner" answers the owner of what the running call asks for now, a number: 0 for the activation, another for a
 *   mount. "set-owner" {"owner": n} makes owner n's what the call asks for from now on, until it returns, also when
 *   that mount has closed (its requests are then cancelled); null, or no "owner", gives the call its own back. A
 *   library that goes on with a task in a later call (a reply's, a close's, a wake's) keeps the owner of the call that
 *   started it and sets it around each step, so a task a mount started stays that mount's: the Rust SDK's tasks do.
 * - "setting" names one of "diffs.source", "diffs.view", "diffs.fullscreen", "diffs.tree", "diffs.single". "image-size"
 *   takes the image's bytes in base64 and answers the size the host decodes, or null. A host with the feature
 *   "image-bounds" answers "image-bounds" with the bounds of the images it decodes (`ImageBounds`): bytes past them
 *   answer null, so a library need not send them. A "fetch" with "bytes" answers
 *   the body's bytes in base64 as a JSON string.
 * - "utc-offset" takes "at", milliseconds since the epoch, and answers the seconds the user's local time is east of
 *   UTC then. "measure" takes "text" and answers {"cells": n, "graphemes": n} as the host's text layout counts it, a
 *   line break no cell; a text over one node's text limit is OPENCODE_ERROR. "info" has the user's "locale", a BCP 47
 *   tag, when one is set. A "prompt" dialog may carry the "value" its field starts with and a "description" line
 *   above it; a "command" may carry its slash "aliases"; a layout may carry "min_width" and "max_width".
 *
 * Content (`Blob`) is a JSON string when its bytes are UTF-8, else {"base64": "..."} (RFC 4648, padded).
 */

#ifdef __cplusplus
}
#endif

#endif /* OPENCODE_PLUGIN_H */
