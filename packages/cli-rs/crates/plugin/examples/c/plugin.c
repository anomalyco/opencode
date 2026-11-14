/*
 * A plugin of ABI 2.0 in C, on `crates/plugin-abi/include/opencode_plugin.h` alone. The loader's tests build it with
 * the system's C compiler and load it: a command that toasts and sends itself a message, a route surface that shows
 * how many messages arrived, the message handler, and a renderer claim of the `c` tool's calls. It matches requests
 * by their "type" with a byte search, which is enough for a test and no way to read JSON.
 *
 * The tests build variants of it. `-DOPENCODE_AS_V1` exports it as a 1.4 plugin, through `opencode_plugin_v1`, still
 * declaring its surface, messages and claim; `-DOPENCODE_BAD_DESCRIBE` answers metadata the host cannot read. Its
 * options (the JSON text of its `plugins` entry) switch faults on: "view-toast" asks for a toast in a view, and
 * "claim-toast" in a claim's view; "claim-memo" declines a call and says its memo table holds 7 values; "claim-handle"
 * gives content numbered 0, which the host never numbers so; "command-true" answers `true` to a command,
 * "command-error" answers OPENCODE_ERROR, "no-messages" declares no message handler.
 * "canvas" adds a canvas `m` below the count, whose version is the count, and a draw that writes its list by hand: a
 * text of how many draws ran, and for which canvas. With it, "draw-toast" asks for a toast in each draw, and
 * "draw-keep" answers no list after the first draw, so the canvas keeps that one.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "opencode_plugin.h"

#ifdef OPENCODE_AS_V1
#define MAJOR 1
#define MINOR 4
#else
#define MAJOR OPENCODE_ABI_MAJOR
#define MINOR OPENCODE_ABI_MINOR
#endif

typedef struct instance {
    const opencode_host_api *host;
    int messages;
    int draws;
    char options[256];
} instance;

/* A buffer of `text`, or an empty one when there is no memory. */
static opencode_owned owned(const char *text) {
    opencode_owned out = {NULL, 0, 0};
    size_t len = strlen(text);
    if (len == 0) {
        return out;
    }
    uint8_t *ptr = malloc(len);
    if (ptr == NULL) {
        return out;
    }
    memcpy(ptr, text, len);
    out.ptr = ptr;
    out.len = len;
    out.cap = len;
    return out;
}

static opencode_bytes bytes(const char *text) {
    opencode_bytes out = {(const uint8_t *)text, strlen(text)};
    return out;
}

/* Whether `haystack`, which is not NUL-terminated, holds `needle`. */
static int holds(opencode_bytes haystack, const char *needle) {
    size_t len = strlen(needle);
    for (size_t at = 0; at + len <= haystack.len; at++) {
        if (memcmp(haystack.ptr + at, needle, len) == 0) {
            return 1;
        }
    }
    return 0;
}

static int is(opencode_bytes request, const char *type) {
    char needle[64];
    snprintf(needle, sizeof needle, "\"type\":\"%s\"", type);
    return holds(request, needle);
}

static int option(const instance *self, const char *name) {
    return strstr(self->options, name) != NULL;
}

/* Whether the host table has `entry`: its size covers it. */
#define OFFERS(host, entry) \
    ((host)->size >= offsetof(opencode_host_api, entry) + sizeof((host)->entry) && (host)->entry != NULL)

static int32_t create(const opencode_host_api *host, opencode_bytes options, void **out_instance,
                      opencode_owned *out) {
    if (out == NULL) {
        return OPENCODE_ERROR;
    }
    if (out_instance == NULL || host == NULL || !OFFERS(host, call) || !OFFERS(host, free)) {
        *out = owned("a host with call and free is needed");
        return OPENCODE_ERROR;
    }
    instance *self = calloc(1, sizeof(instance));
    if (self == NULL) {
        *out = owned("out of memory");
        return OPENCODE_ERROR;
    }
    self->host = host;
    size_t len = options.len < sizeof self->options - 1 ? options.len : sizeof self->options - 1;
    if (len > 0) {
        memcpy(self->options, options.ptr, len);
    }
    *out_instance = self;
    char manifest[600];
    snprintf(manifest, sizeof manifest,
             "{\"id\":\"example.c\",\"commands\":[{\"name\":\"c.hello\",\"title\":\"Hello from C\",\"group\":null,"
             "\"slash\":null,\"keybind\":null,\"palette\":false}],\"fences\":[],\"slots\":[],\"routes\":[],"
             "\"storage\":[],\"render\":2,\"surfaces\":[{\"name\":\"c\",\"place\":{\"type\":\"route\",\"name\":\"c\"},"
             "\"draw\":%s}],\"claims\":[{\"target\":{\"type\":\"tool\",\"name\":\"c\"}}],\"messages\":%s}",
             option(self, "canvas") ? "true" : "false", option(self, "no-messages") ? "false" : "true");
    *out = owned(manifest);
    return OPENCODE_OK;
}

/* A canvas list of one text at the top-left corner, white, as `crates/plugin-abi/src/canvas.rs` lays it out: the
 * version byte, then a record of the operation (2, text), its payload's length (u32, little-endian) and the payload:
 * x and y (i16, little-endian), the style (flags 1 for a foreground, attributes, the foreground and the background as
 * r, g, b, a) and the text. */
static opencode_owned list(const char *text) {
    opencode_owned out = {NULL, 0, 0};
    size_t len = strlen(text), payload = 4 + 10 + len, total = 1 + 1 + 4 + payload;
    uint8_t *ptr = calloc(1, total);
    if (ptr == NULL) {
        return out;
    }
    uint8_t head[] = {1, 2, payload & 0xff, (payload >> 8) & 0xff, (payload >> 16) & 0xff, (payload >> 24) & 0xff};
    memcpy(ptr, head, sizeof head);
    uint8_t style[] = {0, 0, 0, 0, 1, 0, 255, 255, 255, 255, 0, 0, 0, 0};
    memcpy(ptr + sizeof head, style, sizeof style);
    memcpy(ptr + sizeof head + sizeof style, text, len);
    out.ptr = ptr;
    out.len = total;
    out.cap = total;
    return out;
}

/* Asks the host for a toast of `message`. */
static int32_t toast(const opencode_host_api *host, const char *message) {
    char request[160];
    snprintf(request, sizeof request, "{\"type\":\"toast\",\"variant\":\"success\",\"message\":\"%s\"}", message);
    opencode_owned answer = {NULL, 0, 0};
    int32_t status = host->call(host->ctx, bytes(request), &answer);
    host->free(answer);
    return status;
}

static int32_t call(void *raw, opencode_bytes request, opencode_owned *out) {
    if (out == NULL) {
        return OPENCODE_ERROR;
    }
    instance *self = raw;
    const opencode_host_api *host = self->host;
    /* A claim's request names the part's own types, so it is told first. */
    if (is(request, "claim")) {
        if (option(self, "claim-memo")) {
            *out = owned("{\"node\":null,\"memo\":7}");
            return OPENCODE_OK;
        }
        if (option(self, "claim-handle")) {
            *out = owned("{\"node\":{\"type\":\"markdown\",\"id\":\"m\",\"source\":{\"content\":0}},"
                         "\"content\":[[0,\"claimed\"]]}");
            return OPENCODE_OK;
        }
        int refused = 0;
        if (option(self, "claim-toast")) {
            refused = toast(host, "a claim asked for this") != OPENCODE_OK;
        }
        char tree[200];
        snprintf(tree, sizeof tree, "{\"node\":{\"type\":\"text\",\"id\":\"c\",\"spans\":[{\"text\":\"claimed in C%s\"}]}}",
                 refused ? ", toast refused" : "");
        *out = owned(tree);
        return OPENCODE_OK;
    }
    if (is(request, "command")) {
        toast(host, "hello from C");
        /* A 1.x host has no `send`: the command only toasts there. */
        if (OFFERS(host, send)) {
            int32_t sent = host->send(host->ctx, bytes(""), bytes("\"ping\""));
            char note[64];
            snprintf(note, sizeof note, "send answered %d", (int)sent);
            toast(host, note);
        }
        if (option(self, "command-error")) {
            *out = owned("the command failed");
            return OPENCODE_ERROR;
        }
        *out = owned(option(self, "command-true") ? "true" : "null");
        return OPENCODE_OK;
    }
    if (is(request, "message")) {
        self->messages += 1;
        *out = owned("null");
        return OPENCODE_OK;
    }
    if (is(request, "view")) {
        int refused = 0;
        if (option(self, "view-toast")) {
            refused = toast(host, "a view asked for this") != OPENCODE_OK;
        }
        char text[200], tree[400];
        snprintf(text, sizeof text,
                 "{\"type\":\"text\",\"id\":\"c\",\"spans\":[{\"text\":\"drawn in C, %d messages%s\"}]}",
                 self->messages, refused ? ", toast refused" : "");
        if (option(self, "canvas")) {
            snprintf(tree, sizeof tree,
                     "{\"node\":{\"type\":\"box\",\"children\":[%s,{\"type\":\"canvas\",\"id\":\"m\",\"version\":%d,"
                     "\"layout\":{\"width\":{\"cells\":30},\"height\":{\"cells\":1}}}]}}",
                     text, self->messages);
        } else {
            snprintf(tree, sizeof tree, "{\"node\":%s}", text);
        }
        *out = owned(tree);
        return OPENCODE_OK;
    }
    if (is(request, "draw")) {
        self->draws += 1;
        if (option(self, "draw-keep") && self->draws > 1) {
            *out = owned("");
            return OPENCODE_OK;
        }
        int refused = option(self, "draw-toast") && toast(host, "a draw asked for this") != OPENCODE_OK;
        char text[64];
        snprintf(text, sizeof text, "C draw %d%s%s", self->draws, holds(request, "\"canvas\":\"m\"") ? " of m" : "",
                 refused ? ", toast refused" : "");
        *out = list(text);
        return OPENCODE_OK;
    }
    *out = owned("null");
    return OPENCODE_OK;
}

static void destroy(void *raw) {
    free(raw);
}

static void release(opencode_owned buffer) {
    free(buffer.ptr);
}

static int32_t describe(opencode_owned *out) {
    if (out == NULL) {
        return OPENCODE_ERROR;
    }
#ifdef OPENCODE_BAD_DESCRIBE
    *out = owned("{\"version\":2,\"id\":\"example.c\",\"requires\":[\"terminal\"]}");
#else
    *out = owned("{\"version\":\"0.1.0\",\"id\":\"example.c\"}");
#endif
    return OPENCODE_OK;
}

static const opencode_plugin_api API = {
    sizeof(opencode_plugin_api), MAJOR, MINOR, 0, create, call, destroy, release, describe,
};

#ifdef OPENCODE_AS_V1
OPENCODE_EXPORT const opencode_plugin_api *opencode_plugin_v1(void) {
    return &API;
}
#else
OPENCODE_EXPORT const opencode_plugin_api *opencode_plugin_v2(void) {
    return &API;
}
#endif
