/*
 * A plugin of ABI 2.0 in C, on `crates/plugin-abi/include/opencode_plugin.h` alone. The loader's tests build it with
 * the system's C compiler and load it: a command that toasts and sends itself a message, a route surface that shows
 * how many messages arrived, and the message handler. It matches requests by their "type" with `strstr`, which is
 * enough for a test and no way to read JSON.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "opencode_plugin.h"

typedef struct instance {
    const opencode_host_api *host;
    int messages;
} instance;

static opencode_owned owned(const char *text) {
    size_t len = strlen(text);
    uint8_t *ptr = malloc(len ? len : 1);
    memcpy(ptr, text, len);
    opencode_owned out = {ptr, len, len};
    return out;
}

static opencode_bytes bytes(const char *text) {
    opencode_bytes out = {(const uint8_t *)text, strlen(text)};
    return out;
}

/* Whether the request, which is not NUL-terminated, has `type`. */
static int is(opencode_bytes request, const char *type) {
    char needle[64];
    snprintf(needle, sizeof needle, "\"type\":\"%s\"", type);
    size_t len = strlen(needle);
    for (size_t at = 0; at + len <= request.len; at++) {
        if (memcmp(request.ptr + at, needle, len) == 0) {
            return 1;
        }
    }
    return 0;
}

static const char MANIFEST[] =
    "{\"id\":\"example.c\",\"commands\":[{\"name\":\"c.hello\",\"title\":\"Hello from C\",\"group\":null,"
    "\"slash\":null,\"keybind\":null,\"palette\":false}],\"fences\":[],\"slots\":[],\"routes\":[],\"storage\":[],"
    "\"render\":2,\"surfaces\":[{\"name\":\"c\",\"place\":{\"type\":\"route\",\"name\":\"c\"}}],\"messages\":true}";

static int32_t create(const opencode_host_api *host, opencode_bytes options, void **out_instance,
                      opencode_owned *out) {
    (void)options;
    if (out_instance == NULL || host == NULL || host->size < sizeof(opencode_host_api)) {
        *out = owned("a host of ABI 2.0 is needed");
        return OPENCODE_ERROR;
    }
    instance *self = calloc(1, sizeof(instance));
    self->host = host;
    *out_instance = self;
    *out = owned(MANIFEST);
    return OPENCODE_OK;
}

static int32_t call(void *raw, opencode_bytes request, opencode_owned *out) {
    instance *self = raw;
    const opencode_host_api *host = self->host;
    if (is(request, "command")) {
        opencode_owned answer = {0};
        host->call(host->ctx, bytes("{\"type\":\"toast\",\"variant\":\"success\",\"message\":\"hello from C\"}"),
                   &answer);
        host->free(answer);
        int32_t sent = host->send(host->ctx, bytes(""), bytes("\"ping\""));
        *out = owned(sent == OPENCODE_OK ? "null" : "\"not sent\"");
        return sent == OPENCODE_OK ? OPENCODE_OK : OPENCODE_ERROR;
    }
    if (is(request, "message")) {
        self->messages += 1;
        *out = owned("null");
        return OPENCODE_OK;
    }
    if (is(request, "view")) {
        char tree[160];
        snprintf(tree, sizeof tree,
                 "{\"node\":{\"type\":\"text\",\"id\":\"c\",\"spans\":[{\"text\":\"drawn in C, %d messages\"}]}}",
                 self->messages);
        *out = owned(tree);
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
    *out = owned("{\"version\":\"0.1.0\",\"id\":\"example.c\"}");
    return OPENCODE_OK;
}

static const opencode_plugin_api API = {
    sizeof(opencode_plugin_api), OPENCODE_ABI_MAJOR, OPENCODE_ABI_MINOR, 0, create, call, destroy, release, describe,
};

const opencode_plugin_api *opencode_plugin_v2(void) {
    return &API;
}
