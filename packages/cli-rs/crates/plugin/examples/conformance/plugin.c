/*
 * The conformance plugin (Pc) in C, on `crates/plugin-abi/include/opencode_plugin.h` alone: the behavior of
 * `src/conformance.rs`, request for request, so the golden transcripts of `crates/plugin/conformance`, recorded from the
 * Rust source, replay against it. The loader's conformance tests build it with the system's C compiler, with symbols
 * hidden and every warning an error, and `-DCONFORMANCE_V1` exports it as a 1.x library.
 *
 * It reads the few fields it needs from a request with a byte search, which holds for the requests the host sends it,
 * and is no way to read JSON in general. Its options, which no transcript uses, switch a fault on: "search-toast" asks
 * for a toast in each search, which the host must refuse, as a search reads only.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "opencode_plugin.h"

#ifdef CONFORMANCE_V1
#define MAJOR 1
#define MINOR 6
#define REQUIRES 4
#else
#define MAJOR OPENCODE_ABI_MAJOR
#define MINOR OPENCODE_ABI_MINOR
#define REQUIRES 0
#endif

typedef struct instance {
    const opencode_host_api *host;
    unsigned views;
    unsigned messages;
    int dup;
    /* The next view of `conf` holds a fence node. */
    int fenced;
    /* The host draws a fence node (`fence-node`); without it the fence claim lowers it. */
    int fence_node;
    /* The host gives a field the focus (`focus-input`); without it `conf.field` says the field needs a click. */
    int focus_input;
    /* The generation of the mount whose `fixed` subtree the host holds; 0 for none. */
    unsigned long long fixed;
    unsigned long long pads;
    unsigned draws;
    unsigned claimed;
    unsigned bumps;
    /* One more than the bumps `kept` showed last; 0 for none. */
    unsigned kept;
    int search_toast;
} instance;

/* Whether the host table has `entry`: its size covers it, and it is set. */
#define OFFERS(host, entry) \
    ((host)->size >= offsetof(opencode_host_api, entry) + sizeof((host)->entry) && (host)->entry != NULL)

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

/* Where `needle` starts in `haystack`, which is not NUL-terminated, or NULL. */
static const uint8_t *find(opencode_bytes haystack, const char *needle) {
    size_t len = strlen(needle);
    for (size_t at = 0; at + len <= haystack.len; at++) {
        if (memcmp(haystack.ptr + at, needle, len) == 0) {
            return haystack.ptr + at;
        }
    }
    return NULL;
}

static int is(opencode_bytes request, const char *type) {
    char needle[64];
    snprintf(needle, sizeof needle, "\"type\":\"%s\"", type);
    return find(request, needle) != NULL;
}

/* The number after `"name":`, or 0. */
static unsigned long long number(opencode_bytes request, const char *name) {
    char needle[64];
    snprintf(needle, sizeof needle, "\"%s\":", name);
    const uint8_t *at = find(request, needle);
    if (at == NULL) {
        return 0;
    }
    const uint8_t *end = request.ptr + request.len;
    unsigned long long value = 0;
    for (at += strlen(needle); at < end && *at >= '0' && *at <= '9'; at++) {
        value = value * 10 + (unsigned long long)(*at - '0');
    }
    return value;
}

/* Whether the command request names `name`. */
static int names(opencode_bytes request, const char *name) {
    char needle[96];
    snprintf(needle, sizeof needle, "\"name\":\"%s\"", name);
    return find(request, needle) != NULL;
}

/* Asks the host `request`; its answer goes into `answer`, NUL-terminated, when there is room. */
static int32_t ask(const opencode_host_api *host, const char *request, char *answer, size_t room) {
    opencode_owned out = {NULL, 0, 0};
    int32_t status = host->call(host->ctx, bytes(request), &out);
    if (answer != NULL && room > 0) {
        size_t len = out.len < room - 1 ? out.len : room - 1;
        if (len > 0) {
            memcpy(answer, out.ptr, len);
        }
        answer[len] = '\0';
    }
    host->free(out);
    return status;
}

static void toast(const opencode_host_api *host, const char *variant, const char *message) {
    char request[256];
    snprintf(request, sizeof request, "{\"type\":\"toast\",\"variant\":\"%s\",\"message\":\"%s\"}", variant, message);
    ask(host, request, NULL, 0);
}

static void send(const opencode_host_api *host, const char *key, const char *message) {
    if (OFFERS(host, send)) {
        host->send(host->ctx, bytes(key), bytes(message));
    }
}

/* Whether the host table has its whole `features` entry: a 2.x table whose size covers the full descriptor. */
static int has_features(const opencode_host_api *host) {
    return host->major >= 2 && host->size >= offsetof(opencode_host_api, features) + sizeof(host->features);
}

/* Appends code point `point` to `out` as UTF-8, while `room` lasts; 0 when it did not fit. */
static int utf8(unsigned long point, char *out, size_t *len, size_t room) {
    unsigned char bytes[4];
    size_t count;
    if (point < 0x80) {
        bytes[0] = (unsigned char)point;
        count = 1;
    } else if (point < 0x800) {
        bytes[0] = (unsigned char)(0xc0 | (point >> 6));
        bytes[1] = (unsigned char)(0x80 | (point & 0x3f));
        count = 2;
    } else if (point < 0x10000) {
        bytes[0] = (unsigned char)(0xe0 | (point >> 12));
        bytes[1] = (unsigned char)(0x80 | ((point >> 6) & 0x3f));
        bytes[2] = (unsigned char)(0x80 | (point & 0x3f));
        count = 3;
    } else {
        bytes[0] = (unsigned char)(0xf0 | (point >> 18));
        bytes[1] = (unsigned char)(0x80 | ((point >> 12) & 0x3f));
        bytes[2] = (unsigned char)(0x80 | ((point >> 6) & 0x3f));
        bytes[3] = (unsigned char)(0x80 | (point & 0x3f));
        count = 4;
    }
    if (*len + count >= room) {
        return 0;
    }
    memcpy(out + *len, bytes, count);
    *len += count;
    return 1;
}

/* The four hex digits at `at`, or -1. */
static long hex4(const uint8_t *at, const uint8_t *end) {
    long value = 0;
    for (int index = 0; index < 4; index++, at++) {
        if (at >= end) {
            return -1;
        }
        int digit = *at >= '0' && *at <= '9'   ? *at - '0'
                    : *at >= 'a' && *at <= 'f' ? *at - 'a' + 10
                    : *at >= 'A' && *at <= 'F' ? *at - 'A' + 10
                                               : -1;
        if (digit < 0) {
            return -1;
        }
        value = value * 16 + digit;
    }
    return value;
}

/* Decodes the JSON string that starts after its opening quote at `*at` into `out`, NUL-terminated, and moves `*at`
 * past its closing quote; 0 when it is malformed or longer than `room`. */
static int json_string(const uint8_t **at, const uint8_t *end, char *out, size_t room) {
    size_t len = 0;
    while (*at < end && **at != '"') {
        unsigned long point = **at;
        *at += 1;
        if (point == '\\') {
            if (*at >= end) {
                return 0;
            }
            uint8_t escape = **at;
            *at += 1;
            switch (escape) {
            case '"': case '\\': case '/': point = escape; break;
            case 'b': point = '\b'; break;
            case 'f': point = '\f'; break;
            case 'n': point = '\n'; break;
            case 'r': point = '\r'; break;
            case 't': point = '\t'; break;
            case 'u': {
                long high = hex4(*at, end);
                if (high < 0) {
                    return 0;
                }
                *at += 4;
                point = (unsigned long)high;
                /* A surrogate pair is one code point. */
                if (high >= 0xd800 && high < 0xdc00 && end - *at >= 6 && (*at)[0] == '\\' && (*at)[1] == 'u') {
                    long low = hex4(*at + 2, end);
                    if (low >= 0xdc00 && low < 0xe000) {
                        point = 0x10000 + (((unsigned long)high - 0xd800) << 10) + ((unsigned long)low - 0xdc00);
                        *at += 6;
                    }
                }
                break;
            }
            default: return 0;
            }
            if (!utf8(point, out, &len, room)) {
                return 0;
            }
        } else {
            if (len + 1 >= room) {
                return 0;
            }
            out[len++] = (char)point;
        }
    }
    if (*at >= end) {
        return 0;
    }
    *at += 1;
    out[len] = '\0';
    return 1;
}

/* Whether the host states feature `name`: an element of its `features` array, decoded, equals it exactly. */
static int has_feature(const opencode_host_api *host, const char *name) {
    if (!has_features(host) || host->features.ptr == NULL) {
        return 0;
    }
    const uint8_t *at = host->features.ptr, *end = host->features.ptr + host->features.len;
    while (at < end && (*at == ' ' || *at == '\t' || *at == '\n' || *at == '\r')) {
        at++;
    }
    if (at >= end || *at != '[') {
        return 0;
    }
    at++;
    for (;;) {
        while (at < end && (*at == ' ' || *at == '\t' || *at == '\n' || *at == '\r' || *at == ',')) {
            at++;
        }
        if (at >= end || *at != '"') {
            return 0;
        }
        at++;
        char feature[128];
        if (!json_string(&at, end, feature, sizeof feature)) {
            return 0;
        }
        if (strcmp(feature, name) == 0) {
            return 1;
        }
    }
}

static const char *const COMMANDS[] = {
    "conf.toast", "conf.store", "conf.send", "conf.wake",  "conf.panic", "conf.dup",  "conf.read",
    "conf.pad",   "conf.down",  "conf.step", "conf.where", "conf.ui",    "conf.bump", "conf.message",
    "conf.field", "conf.fence", "conf.dialogs", "conf.plugins",
};

/* The scroll `items` of the surface `rows`, as a verb or a read names it. */
#define ITEMS "{\"type\":\"node\",\"surface\":\"rows\",\"id\":\"items\"}"

static int32_t create(const opencode_host_api *host, opencode_bytes options, void **out_instance,
                      opencode_owned *out) {
    if (out == NULL) {
        return OPENCODE_ERROR;
    }
    if (out_instance == NULL || host == NULL || !OFFERS(host, call) || !OFFERS(host, free)) {
        *out = owned("a host with call and free is needed");
        return OPENCODE_ERROR;
    }
    if (find(options, "fail-setup") != NULL) {
        *out = owned("setup refused");
        return OPENCODE_ERROR;
    }
    instance *self = calloc(1, sizeof(instance));
    if (self == NULL) {
        *out = owned("out of memory");
        return OPENCODE_ERROR;
    }
    self->host = host;
    self->search_toast = find(options, "search-toast") != NULL;
    self->fence_node = has_feature(host, "fence-node");
    self->focus_input = has_feature(host, "focus-input");
    /* As the Rust SDK's `storage_key` does: the host serves the key from here on, also during setup. */
    ask(host, "{\"type\":\"storage-key\",\"key\":\"count\"}", NULL, 0);
    *out_instance = self;
    char manifest[4096] = "{\"id\":\"conformance\",\"commands\":[";
    for (size_t index = 0; index < sizeof COMMANDS / sizeof COMMANDS[0]; index++) {
        char command[192];
        snprintf(command, sizeof command,
                 "%s{\"name\":\"%s\",\"title\":\"%s\",\"group\":null,\"slash\":null,\"keybind\":null,\"palette\":false}",
                 index == 0 ? "" : ",", COMMANDS[index], COMMANDS[index]);
        strncat(manifest, command, sizeof manifest - strlen(manifest) - 1);
    }
    strncat(manifest,
            "],\"fences\":[],\"slots\":[],\"routes\":[],\"storage\":[\"count\"],\"render\":2,\"wake\":true,"
            "\"surfaces\":[{\"name\":\"conf\",\"place\":{\"type\":\"route\",\"name\":\"conf\"}},"
            "{\"name\":\"pad\",\"place\":{\"type\":\"route\",\"name\":\"pad\"},\"draw\":true},"
            "{\"name\":\"rows\",\"place\":{\"type\":\"route\",\"name\":\"rows\"},"
            "\"notify\":[{\"type\":\"scroll\",\"id\":\"items\"}],\"layout\":true,\"handler\":true},"
            "{\"name\":\"kept\",\"place\":{\"type\":\"route\",\"name\":\"kept\"},\"handler\":true,\"mounts\":true}],"
            "\"messages\":true,\"plugins\":true,"
            "\"claims\":[{\"target\":{\"type\":\"fence\",\"name\":\"conf-fence\"}},"
            "{\"target\":{\"type\":\"fence\",\"name\":\"conf-fences\"}},"
            "{\"target\":{\"type\":\"tool\",\"name\":\"conf-tool\"}}],\"searches\":[\"conf.find\"],"
            "\"layers\":[{\"scope\":\"global\",\"keys\":[{\"key\":\"ctrl+g\",\"name\":\"conf\"},"
            "{\"key\":\"ctrl+o\",\"name\":\"pass\"}],\"paste\":true}]}",
            sizeof manifest - strlen(manifest) - 1);
    *out = owned(manifest);
    return OPENCODE_OK;
}

static int string_after(opencode_bytes request, const char *needle, char *out, size_t room);

/* `conf.ui`: each verb and read of P2 once, then what the reads answered. */
static void ui(const opencode_host_api *host) {
    char answer[256];
    ask(host, "{\"type\":\"focus\",\"node\":\"i2\"}", NULL, 0);
    int32_t status = ask(host, "{\"type\":\"focused\"}", answer, sizeof answer);
    int focused = status == OPENCODE_OK && find(bytes(answer), "\"surface\":true") != NULL;
    status = ask(host, "{\"type\":\"rect\",\"node\":\"where\"}", answer, sizeof answer);
    int rect = status == OPENCODE_OK && answer[0] != '\0' && strcmp(answer, "null") != 0;
    ask(host, "{\"type\":\"set-mode\",\"mode\":\"nav\"}", NULL, 0);
    status = ask(host, "{\"type\":\"input-mode\"}", answer, sizeof answer);
    char mode[64] = "none";
    size_t len = strlen(answer);
    if (status == OPENCODE_OK && len >= 2 && answer[0] == '"' && answer[len - 1] == '"') {
        answer[len - 1] = '\0';
        snprintf(mode, sizeof mode, "%.63s", answer + 1);
    }
    ask(host, "{\"type\":\"release-keys\"}", NULL, 0);
    ask(host, "{\"type\":\"focus\",\"node\":\"field\"}", NULL, 0);
    char field[64] = "none";
    if (ask(host, "{\"type\":\"focused\"}", answer, sizeof answer) == OPENCODE_OK) {
        string_after(bytes(answer), "\"node\":\"", field, sizeof field);
    }
    ask(host, "{\"type\":\"blur\"}", NULL, 0);
    ask(host, "{\"type\":\"open-panel\",\"surface\":\"rows\"}", NULL, 0);
    ask(host, "{\"type\":\"close-panel\",\"surface\":\"rows\"}", NULL, 0);
    ask(host, "{\"type\":\"overlay\",\"surface\":\"rows\",\"anchor\":{\"edge\":\"top\"},\"width\":10,\"height\":3}", NULL,
        0);
    ask(host, "{\"type\":\"close-overlay\",\"surface\":\"rows\"}", NULL, 0);
    char message[192];
    snprintf(message, sizeof message, "ui %s %s %s %s", focused ? "true" : "false", rect ? "true" : "false", mode,
             field);
    toast(host, "info", message);
}

/* `conf.dialogs`: a select, an alert and a confirm, each centered; the select and the alert extra large. */
static void dialogs(const opencode_host_api *host) {
    ask(host,
        "{\"type\":\"dialog\",\"dialog\":{\"type\":\"select\",\"title\":\"pick\",\"options\":[{\"title\":\"one\","
        "\"value\":\"1\"}],\"action\":{\"type\":\"command\",\"name\":\"conf.toast\"},\"size\":\"xlarge\","
        "\"centered\":true}}",
        NULL, 0);
    ask(host,
        "{\"type\":\"dialog\",\"dialog\":{\"type\":\"alert\",\"title\":\"told\",\"message\":\"said\","
        "\"size\":\"xlarge\",\"centered\":true}}",
        NULL, 0);
    ask(host,
        "{\"type\":\"dialog\",\"dialog\":{\"type\":\"confirm\",\"title\":\"asked\",\"message\":\"sure?\","
        "\"action\":{\"type\":\"command\",\"name\":\"conf.toast\"},\"centered\":true}}",
        NULL, 0);
}

/* `conf.plugins` and a change of the plugin list (P6b): the entries the host lists and the first one's key, said as
 * `said N KEY`. */
static void read_plugins(const opencode_host_api *host, const char *said) {
    char answer[2048], key[96] = "", message[192];
    unsigned count = 0;
    if (ask(host, "{\"type\":\"plugins\"}", answer, sizeof answer) == OPENCODE_OK) {
        for (const char *at = strstr(answer, "\"key\":"); at != NULL; at = strstr(at + 1, "\"key\":")) {
            count += 1;
        }
        string_after(bytes(answer), "\"key\":\"", key, sizeof key);
    }
    snprintf(message, sizeof message, "%s %u %s", said, count, key);
    toast(host, "info", message);
}

/* `conf.message` (P6a): a read of one message, and its ID or none. */
static void read_message(const opencode_host_api *host) {
    char answer[512], id[64], message[96] = "message none";
    int32_t status = ask(host, "{\"type\":\"message\",\"session\":\"ses_a\",\"message\":\"msg_1\"}", answer, sizeof answer);
    if (status == OPENCODE_OK && string_after(bytes(answer), "\"id\":\"", id, sizeof id)) {
        snprintf(message, sizeof message, "message %s", id);
    }
    toast(host, "info", message);
}

static int32_t command(instance *self, opencode_bytes request, opencode_owned *out) {
    const opencode_host_api *host = self->host;
    if (names(request, "conf.toast")) {
        toast(host, "success", "hello");
    } else if (names(request, "conf.store")) {
        ask(host, "{\"type\":\"storage-set\",\"key\":\"count\",\"value\":\"1\"}", NULL, 0);
        char answer[64];
        int32_t status = ask(host, "{\"type\":\"storage-get\",\"key\":\"count\"}", answer, sizeof answer);
        char message[96] = "stored nothing";
        size_t len = strlen(answer);
        /* The answer is the stored JSON text as a JSON string, here "\"1\"" without escapes. */
        if (status == OPENCODE_OK && len >= 2 && answer[0] == '"' && answer[len - 1] == '"') {
            answer[len - 1] = '\0';
            snprintf(message, sizeof message, "stored %s", answer + 1);
        }
        toast(host, "info", message);
    } else if (names(request, "conf.send")) {
        send(host, "", "\"ping\"");
        send(host, "k", "\"a\"");
        send(host, "k", "\"b\"");
        toast(host, "info", "sent");
    } else if (names(request, "conf.wake")) {
        if (OFFERS(host, wake)) {
            host->wake(host->ctx);
        }
    } else if (names(request, "conf.panic")) {
        toast(host, "info", "before panic");
        *out = owned("boom");
        return OPENCODE_PANIC;
    } else if (names(request, "conf.dup")) {
        self->dup = 1;
    } else if (names(request, "conf.field")) {
        if (self->focus_input) {
            ask(host, "{\"type\":\"focus\",\"node\":\"field\"}", NULL, 0);
        } else {
            toast(host, "info", "field needs a click");
        }
    } else if (names(request, "conf.fence")) {
        self->fenced = 1;
    } else if (names(request, "conf.dialogs")) {
        dialogs(host);
    } else if (names(request, "conf.pad")) {
        self->pads += 1;
    } else if (names(request, "conf.down")) {
        ask(host, "{\"type\":\"scroll\",\"target\":" ITEMS ",\"verb\":{\"type\":\"by\",\"rows\":2}}", NULL, 0);
    } else if (names(request, "conf.step")) {
        ask(host, "{\"type\":\"scroll\",\"target\":" ITEMS ",\"verb\":{\"type\":\"step\",\"group\":\"items\",\"by\":1}}",
            NULL, 0);
    } else if (names(request, "conf.where")) {
        char answer[128];
        int32_t status = ask(host, "{\"type\":\"scroll-state\",\"target\":" ITEMS "}", answer, sizeof answer);
        char message[64] = "nowhere";
        opencode_bytes state = bytes(answer);
        if (status == OPENCODE_OK && find(state, "\"offset\":") != NULL) {
            snprintf(message, sizeof message, "offset %llu of %llu", number(state, "offset"), number(state, "extent"));
        }
        toast(host, "info", message);
    } else if (names(request, "conf.ui")) {
        ui(host);
    } else if (names(request, "conf.bump")) {
        self->bumps += 1;
    } else if (names(request, "conf.message")) {
        read_message(host);
    } else if (names(request, "conf.plugins")) {
        read_plugins(host, "plugins");
    } else if (names(request, "conf.read")) {
        int light = OFFERS(host, theme_mode) && host->theme_mode(host->ctx) == OPENCODE_THEME_LIGHT;
        char answer[16];
        int32_t status = ask(host, "{\"type\":\"interactive\"}", answer, sizeof answer);
        char message[64];
        snprintf(message, sizeof message, "read %s %s", light ? "light" : "dark",
                 status == OPENCODE_OK && strcmp(answer, "true") == 0 ? "true" : "false");
        toast(host, "info", message);
    } else {
        *out = owned("no such command");
        return OPENCODE_ERROR;
    }
    *out = owned("null");
    return OPENCODE_OK;
}

/* The view of the route `conf`: the `fixed` subtree is built once a mount, and kept while the host holds it. */
static int32_t view(instance *self, opencode_bytes request, opencode_owned *out) {
    unsigned long long generation = number(request, "generation");
    unsigned long long next = number(request, "next");
    int full = find(request, "\"full\":true") != NULL;
    self->views += 1;
    char count[128];
    snprintf(count, sizeof count, "{\"type\":\"text\",\"id\":\"count\",\"spans\":[{\"text\":\"views %u, messages %u\"}]}",
             self->views, self->messages);
    char reply[1024];
    if (self->fenced) {
        self->fixed = 0;
        snprintf(reply, sizeof reply, "{\"node\":{\"type\":\"box\",\"id\":\"root\",\"children\":[%s,{\"type\":\"fence\"}]}}",
                 count);
    } else if (self->dup) {
        self->fixed = 0;
        snprintf(reply, sizeof reply, "{\"node\":{\"type\":\"box\",\"id\":\"root\",\"children\":[%s,%s]}}", count,
                 count);
    } else if (full || self->fixed != generation) {
        self->fixed = generation;
        snprintf(reply, sizeof reply,
                 "{\"node\":{\"type\":\"box\",\"id\":\"root\",\"children\":[%s,{\"type\":\"markdown\",\"id\":\"fixed\","
                 "\"source\":{\"content\":%llu}}]},\"content\":[[%llu,\"# fixed\"]],\"memo\":1}",
                 count, next + 1, next + 1);
    } else {
        snprintf(reply, sizeof reply,
                 "{\"node\":{\"type\":\"box\",\"id\":\"root\",\"children\":[%s,{\"type\":\"keep\",\"key\":\"fixed\"}]},"
                 "\"memo\":1}",
                 count);
    }
    *out = owned(reply);
    return OPENCODE_OK;
}

/* The view of the route `pad`: its canvas at the version `conf.pad` counts. */
static int32_t pad(instance *self, opencode_owned *out) {
    char reply[256];
    snprintf(reply, sizeof reply,
             "{\"node\":{\"type\":\"box\",\"id\":\"pad-root\",\"children\":[{\"type\":\"canvas\",\"id\":\"pad\","
             "\"layout\":{\"width\":{\"cells\":20},\"height\":{\"cells\":1}},\"version\":%llu}]}}",
             self->pads);
    *out = owned(reply);
    return OPENCODE_OK;
}

/* The view of the route `rows`: a text `where` over a scroll `items`, 3 rows high, of six anchored items. */
static int32_t rows(opencode_owned *out) {
    char reply[1536] = "{\"node\":{\"type\":\"box\",\"id\":\"rows-root\",\"children\":[{\"type\":\"text\",\"id\":\"where\","
                       "\"spans\":[{\"text\":\"where\"}]},{\"type\":\"box\",\"id\":\"button\",\"pointer\":true,\"children\":["
                       "{\"type\":\"text\",\"spans\":[{\"text\":\"press\"}]}]},{\"type\":\"scroll\",\"id\":\"items\",\"height\":3,"
                       "\"children\":[";
    for (int index = 0; index < 6; index++) {
        char item[160];
        snprintf(item, sizeof item,
                 "%s{\"type\":\"box\",\"id\":\"i%d\",\"anchor\":{\"group\":\"items\"},\"children\":[{\"type\":\"text\","
                 "\"spans\":[{\"text\":\"item %d\"}]}]}",
                 index == 0 ? "" : ",", index, index);
        strncat(reply, item, sizeof reply - strlen(reply) - 1);
    }
    strncat(reply, "]},{\"type\":\"input\",\"id\":\"field\"}]}}", sizeof reply - strlen(reply) - 1);
    *out = owned(reply);
    return OPENCODE_OK;
}

/* The view of the route `kept` (P6a): its root kept while it would show the bumps it showed last, unless the host says
 * everything changed; a hidden box beside. */
static int32_t kept(instance *self, opencode_bytes request, opencode_owned *out) {
    if (find(request, "\"all\":true") == NULL && self->kept == self->bumps + 1) {
        *out = owned("{\"node\":{\"type\":\"keep\",\"key\":\"kept-root\"}}");
        return OPENCODE_OK;
    }
    self->kept = self->bumps + 1;
    char reply[512];
    snprintf(reply, sizeof reply,
             "{\"node\":{\"type\":\"box\",\"id\":\"kept-root\",\"children\":[{\"type\":\"text\",\"id\":\"kept\","
             "\"spans\":[{\"text\":\"kept %u\"}]},{\"type\":\"box\",\"id\":\"hidden\",\"visible\":false,\"children\":["
             "{\"type\":\"text\",\"spans\":[{\"text\":\"hidden\"}]}]}]}}",
             self->bumps);
    *out = owned(reply);
    return OPENCODE_OK;
}

/* The layout of `rows`: `where` painted while `items` is scrolled down. Its geometry's scrolls hold the first
 * "offset", as the only scroll it is told of. */
static int32_t layout(opencode_bytes request, opencode_owned *out) {
    int down = number(request, "offset") > 0;
    *out = owned(down ? "{\"paints\":[{\"node\":\"where\",\"bg\":\"#203040\"}]}" : "{}");
    return OPENCODE_OK;
}

/* Copies the JSON string after `needle` into `out`, up to its closing quote, without escapes; whether it was there. */
static int string_after(opencode_bytes request, const char *needle, char *out, size_t room) {
    const uint8_t *at = find(request, needle);
    if (at == NULL || room == 0) {
        return 0;
    }
    at += strlen(needle);
    size_t len = 0;
    while (at < request.ptr + request.len && *at != '"' && len < room - 1) {
        out[len++] = (char)*at++;
    }
    out[len] = '\0';
    return 1;
}

/* The handler of `rows` and of the layer of setup: a key bound as `conf`, a paste and a press are said and consumed;
 * where a step landed is said; everything else passes on. */
static int32_t input(instance *self, opencode_bytes request, opencode_owned *out) {
    char said[96], text[64];
    int consume = 1;
    if (is(request, "mount")) {
        /* A mount of `kept` begins or ends (P6a). */
        snprintf(said, sizeof said, "mount %s", find(request, "\"mounted\":true") != NULL ? "begins" : "ends");
        consume = 0;
    } else if (find(request, "\"bind\":\"conf\"") != NULL) {
        snprintf(said, sizeof said, "key conf");
    } else if (is(request, "paste") && string_after(request, "\"text\":\"", text, sizeof text)) {
        snprintf(said, sizeof said, "paste %s", text);
    } else if (is(request, "pointer") && find(request, "\"kind\":\"down\"") != NULL &&
               string_after(request, "\"node\":\"", text, sizeof text)) {
        snprintf(said, sizeof said, "pressed %s", text);
    } else if (is(request, "landed") && string_after(request, "\"anchor\":{\"id\":\"", text, sizeof text)) {
        snprintf(said, sizeof said, "landed %s", text);
        consume = 0;
    } else {
        *out = owned("\"pass\"");
        return OPENCODE_OK;
    }
    toast(self->host, "info", said);
    *out = owned(consume ? "\"consume\"" : "\"pass\"");
    return OPENCODE_OK;
}

/* The search `conf.find`: the values of the options whose title holds the query, in their order. */
static int32_t search(instance *self, opencode_bytes request, opencode_owned *out) {
    if (self->search_toast) {
        toast(self->host, "info", "a search asked for this");
    }
    char query[64] = "";
    string_after(request, "\"query\":\"", query, sizeof query);
    char reply[512] = "[";
    const uint8_t *at = request.ptr;
    const uint8_t *end = request.ptr + request.len;
    for (;;) {
        opencode_bytes rest = {at, (size_t)(end - at)};
        const uint8_t *option = find(rest, "{\"title\":\"");
        if (option == NULL) {
            break;
        }
        opencode_bytes from = {option, (size_t)(end - option)};
        char title[64], value[64];
        string_after(from, "{\"title\":\"", title, sizeof title);
        string_after(from, "\"value\":\"", value, sizeof value);
        if (strstr(title, query) != NULL) {
            char item[80];
            snprintf(item, sizeof item, "%s\"%s\"", strlen(reply) > 1 ? "," : "", value);
            strncat(reply, item, sizeof reply - strlen(reply) - 1);
        }
        at = option + 1;
    }
    strncat(reply, "]", sizeof reply - strlen(reply) - 1);
    *out = owned(reply);
    return OPENCODE_OK;
}

/* The draw of the canvas `pad`: a list, as `crates/plugin-abi/src/canvas.rs` lays it out, of one text at the corner in
 * the terminal's colors. The version byte, then the record: its operation (2, text), its payload's length (u32,
 * little-endian), and the payload: x and y (i16, little-endian), the style (no flags, no attributes, two colors of
 * zeros), and the text. */
static int32_t draw(instance *self, opencode_bytes request, opencode_owned *out) {
    static const char *const CAUSES[] = {"first", "resized", "version", "animate"};
    const char *cause = "first";
    for (size_t index = 0; index < sizeof CAUSES / sizeof CAUSES[0]; index++) {
        char needle[32];
        snprintf(needle, sizeof needle, "\"cause\":\"%s\"", CAUSES[index]);
        if (find(request, needle) != NULL) {
            cause = CAUSES[index];
        }
    }
    self->draws += 1;
    char text[64];
    snprintf(text, sizeof text, "draw %u %s", self->draws, cause);
    size_t len = strlen(text), payload = 4 + 10 + len, total = 1 + 1 + 4 + payload;
    uint8_t *ptr = calloc(1, total);
    if (ptr == NULL) {
        *out = owned("out of memory");
        return OPENCODE_ERROR;
    }
    uint8_t head[] = {1, 2, payload & 0xff, (payload >> 8) & 0xff, (payload >> 16) & 0xff, (payload >> 24) & 0xff};
    memcpy(ptr, head, sizeof head);
    /* x, y and the style are all zeros, as calloc left them. */
    memcpy(ptr + sizeof head + 4 + 10, text, len);
    out->ptr = ptr;
    out->len = total;
    out->cap = total;
    return OPENCODE_OK;
}

static int32_t call(void *raw, opencode_bytes request, opencode_owned *out) {
    if (out == NULL) {
        return OPENCODE_ERROR;
    }
    instance *self = raw;
    if (self == NULL) {
        *out = owned("no instance");
        return OPENCODE_ERROR;
    }
    if (is(request, "command")) {
        return command(self, request, out);
    }
    if (is(request, "claim") && find(request, "\"part\":{\"type\":\"fence\"") != NULL) {
        /* The claims of fences: claim 1 is `conf-fences`, whose tree holds two fence nodes. */
        if (number(request, "claim") == 1) {
            *out = owned("{\"node\":{\"type\":\"box\",\"id\":\"fences\",\"children\":[{\"type\":\"text\",\"spans\":"
                         "[{\"text\":\"fences\"}]},{\"type\":\"fence\"},{\"type\":\"fence\"}]}}");
            return OPENCODE_OK;
        }
        /* `conf-fence`: a label over the host's code view of the fence, or the code as text for an older host. */
        char code[64] = "", language[64] = "", lowered[128], reply[384];
        string_after(request, "\"code\":\"", code, sizeof code);
        string_after(request, "\"language\":\"", language, sizeof language);
        snprintf(lowered, sizeof lowered, "{\"type\":\"text\",\"spans\":[{\"text\":\"fenced %s\"}]}", code);
        snprintf(reply, sizeof reply,
                 "{\"node\":{\"type\":\"box\",\"id\":\"fence\",\"children\":[{\"type\":\"text\",\"spans\":"
                 "[{\"text\":\"fence %s\"}]},%s]}}",
                 language, self->fence_node ? "{\"type\":\"fence\"}" : lowered);
        *out = owned(reply);
        return OPENCODE_OK;
    }
    if (is(request, "claim")) {
        /* The claim of `conf-tool`'s calls: Markdown of content given anew in each view, numbered after `next`. */
        self->claimed += 1;
        unsigned long long handle = number(request, "next") + 1;
        char reply[192];
        snprintf(reply, sizeof reply,
                 "{\"node\":{\"type\":\"markdown\",\"id\":\"claim\",\"source\":{\"content\":%llu}},"
                 "\"content\":[[%llu,\"claimed %u\"]]}",
                 handle, handle, self->claimed);
        *out = owned(reply);
        return OPENCODE_OK;
    }
    if (is(request, "input")) {
        return input(self, request, out);
    }
    if (is(request, "search")) {
        return search(self, request, out);
    }
    if (is(request, "view")) {
        /* The mount names its surface. */
        if (find(request, "\"surface\":\"rows\"") != NULL) {
            return rows(out);
        }
        if (find(request, "\"surface\":\"kept\"") != NULL) {
            return kept(self, request, out);
        }
        return find(request, "\"surface\":\"pad\"") != NULL ? pad(self, out) : view(self, request, out);
    }
    if (is(request, "layout")) {
        return layout(request, out);
    }
    if (is(request, "draw")) {
        return draw(self, request, out);
    }
    if (is(request, "unmount")) {
        if (number(request, "generation") == self->fixed) {
            self->fixed = 0;
        }
    } else if (is(request, "message")) {
        self->messages += 1;
    } else if (is(request, "wake")) {
        toast(self->host, "info", "woken");
    } else if (is(request, "plugins")) {
        read_plugins(self->host, "plugins changed");
    } else {
        /* A request this plugin does not know, such as one of a later minor: an error, and nothing changes. */
        *out = owned("unknown request");
        return OPENCODE_ERROR;
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
    *out = owned("{\"version\":\"1.0.0\",\"id\":\"conformance\"}");
    return OPENCODE_OK;
}

static const opencode_plugin_api API = {
    sizeof(opencode_plugin_api), MAJOR, MINOR, REQUIRES, create, call, destroy, release, describe,
};

#ifdef CONFORMANCE_V1
OPENCODE_EXPORT const opencode_plugin_api *opencode_plugin_v1(void) {
    return &API;
}
#else
OPENCODE_EXPORT const opencode_plugin_api *opencode_plugin_v2(void) {
    return &API;
}
#endif
