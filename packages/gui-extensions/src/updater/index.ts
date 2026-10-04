import { Schema } from "effect"
import { Extension, Store } from "../sdk"
import { Updater } from "./contract"
import en from "./i18n/en"

const ReleaseNotes = Schema.Struct({ enabled: Schema.Boolean })

const Seen = Schema.Struct({ version: Schema.optional(Schema.String) })

export default Extension.define({
  id: "updater",
  provides: { updater: Updater },
  stores: {
    // Whether What's New shows after an update; stored before in the app settings.
    releaseNotes: Store.global(
      ReleaseNotes,
      { enabled: true },
      {
        key: "settings.v3",
        pick: (value: { general?: { releaseNotes?: unknown } } | null) => {
          const enabled = value?.general?.releaseNotes

          return enabled === undefined ? undefined : { enabled }
        },
      },
    ),
    // The version whose What's New was last shown or skipped; stored before under the app's own key.
    seen: Store.global(Seen, {}, "highlights.v1"),
    // The update main staged for the next start; stored before in the updater's settings file.
    ready: Store.main(Schema.NullOr(Schema.Struct({ version: Schema.String })), null, {
      settings: "ready",
      file: "opencode.updater",
    }),
  },
  i18n: {
    en,
    am: () => import("./i18n/am"),
    ar: () => import("./i18n/ar"),
    az: () => import("./i18n/az"),
    bg: () => import("./i18n/bg"),
    bn: () => import("./i18n/bn"),
    br: () => import("./i18n/br"),
    bs: () => import("./i18n/bs"),
    ca: () => import("./i18n/ca"),
    cs: () => import("./i18n/cs"),
    da: () => import("./i18n/da"),
    de: () => import("./i18n/de"),
    dv: () => import("./i18n/dv"),
    dz: () => import("./i18n/dz"),
    el: () => import("./i18n/el"),
    es: () => import("./i18n/es"),
    et: () => import("./i18n/et"),
    fa: () => import("./i18n/fa"),
    fi: () => import("./i18n/fi"),
    fo: () => import("./i18n/fo"),
    fr: () => import("./i18n/fr"),
    he: () => import("./i18n/he"),
    hi: () => import("./i18n/hi"),
    hr: () => import("./i18n/hr"),
    hu: () => import("./i18n/hu"),
    hy: () => import("./i18n/hy"),
    id: () => import("./i18n/id"),
    is: () => import("./i18n/is"),
    it: () => import("./i18n/it"),
    ja: () => import("./i18n/ja"),
    ka: () => import("./i18n/ka"),
    km: () => import("./i18n/km"),
    ko: () => import("./i18n/ko"),
    lo: () => import("./i18n/lo"),
    lt: () => import("./i18n/lt"),
    lv: () => import("./i18n/lv"),
    mk: () => import("./i18n/mk"),
    mn: () => import("./i18n/mn"),
    ms: () => import("./i18n/ms"),
    my: () => import("./i18n/my"),
    ne: () => import("./i18n/ne"),
    nl: () => import("./i18n/nl"),
    no: () => import("./i18n/no"),
    pa: () => import("./i18n/pa"),
    pl: () => import("./i18n/pl"),
    ro: () => import("./i18n/ro"),
    ru: () => import("./i18n/ru"),
    si: () => import("./i18n/si"),
    sk: () => import("./i18n/sk"),
    sl: () => import("./i18n/sl"),
    sq: () => import("./i18n/sq"),
    sr: () => import("./i18n/sr"),
    sv: () => import("./i18n/sv"),
    tg: () => import("./i18n/tg"),
    th: () => import("./i18n/th"),
    tk: () => import("./i18n/tk"),
    tr: () => import("./i18n/tr"),
    uk: () => import("./i18n/uk"),
    ur: () => import("./i18n/ur"),
    uz: () => import("./i18n/uz"),
    vi: () => import("./i18n/vi"),
    zh: () => import("./i18n/zh"),
    zht: () => import("./i18n/zht"),
  },
})
