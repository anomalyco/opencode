# ئۇيغۇرچە: Telemetry ۋە سىرتقى ئادرېس تەكشۈرۈش دوكلاتى (2026-11-15)

ئۇيغۇرچە ئەسكەرتىش: بۇ تەكشۈرۈش `packages/` ئىچىدىكى مەنبە كودنى grep بىلەن ئىزدەش ئارقىلىق قىلىندى. ھەربىر ئادرېسنىڭ ئىجرا يولى تولۇق ئىزلەنمىدى.

## تاقالغان

| ئورنى | نېمە قىلاتتى | ھالىتى |
| ----- | ------------ | ------ |
| `cli/src/services/updater.ts` | `opencode.ai/update/api/...` غا نۇسخا ۋە سىستېما تۈرىنى يوللايتتى | سۈكۈتتە تاقالدى. `MUHLISCODE_ENABLE_AUTOUPDATE=1` بىلەنلا ئېچىلىدۇ |

## ئىختىيارى (مۇھىت ئۆزگەرگۈچىسى بولغاندىلا ئىشلەيدۇ)

- `util/src/observability/otlp.ts`: پەقەت `OTEL_EXPORTER_OTLP_ENDPOINT` بېكىتىلگەندە سىرتقا يوللايدۇ.
- `desktop/.../startup/sentry.ts` ۋە `app/vite.config.ts`: پەقەت `VITE_SENTRY_DSN` / `SENTRY_*` بېكىتىلگەندە ئىشلەيدۇ.

## تېخى ئوچۇق (قارار كېرەك)

- `core/src/models-dev.ts`: `https://models.opencode.ai` دىن مودېل تىزىملىكىنى چۈشۈرىدۇ (ئىشلەتكۈچى سانلىق مەلۇماتى يوللىمايدۇ). تاقاش: `OPENCODE_DISABLE_MODELS_FETCH=1`.
- `core/src/voice.ts`، `ai/src/providers/opencode.ts`، `core/src/console-access.ts`: `opencode.ai` نىڭ Zen / Go مۇلازىمىتىگە ئۇلىنىدۇ. ئىشلەتكۈچى تاللىمىسا ئىشلەمدۇ-يوق، تېخى تەكشۈرۈلمىدى.
- `app/src/shell/*`: `opencode.ai/desktop-feedback` ۋە favicon ئۇلانمىسى.
- `core/src/mcp/oauth.ts`: `opencode.ai` نى OAuth client ئۇچۇرى سۈپىتىدە ئىشلىتىدۇ.

## خىتاي مۇلازىمېتىرى

grep ئارقىلىق `.cn`، baidu، tencent، alibaba، aliyun، bytedance قاتارلىق دومېنلار تەكشۈرۈلدى. `packages/*/src` ئىچىدە ھەقىقىي سىرتقى ئادرېس سۈپىتىدە ئۇچرىغىنى يوق (تېخى تولۇق تەكشۈرۈلمىگەن: `bun.lock` دىكى npm پاكېتلىرى).
