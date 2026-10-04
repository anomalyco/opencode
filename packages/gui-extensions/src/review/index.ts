import { Schema, Struct } from "effect"
import { FileTree } from "../file/contract"
import { Extension, Store } from "../sdk"
import { Changes } from "./contract"
import en from "./i18n/en"

const DiffState = Schema.Struct({ diffStyle: Schema.Literals(["unified", "split"]) }).mapFields(
  Struct.map(Schema.mutableKey),
)

const PanelState = Schema.Struct({ expandMode: Schema.Literals(["expand", "collapse"]) }).mapFields(
  Struct.map(Schema.mutableKey),
)

const MobileDiff = Schema.Struct({ wrap: Schema.Boolean }).mapFields(Struct.map(Schema.mutableKey))

const SessionState = Schema.Struct({
  mode: Schema.optional(Schema.Literals(["git", "branch", "turn"])),
  file: Schema.optional(Schema.String),
  open: Schema.mutable(Schema.Array(Schema.String)),
}).mapFields(Struct.map(Schema.mutableKey))

export default Extension.define({
  id: "review",
  provides: { changes: Changes },
  // The changed files list in the file browser's tree; without it the list stays empty.
  uses: { tree: FileTree },
  stores: {
    diff: Store.global(
      DiffState,
      { diffStyle: "split" },
      {
        key: "layout",
        pick: (value: { review?: { diffStyle?: unknown } } | null) => {
          const diffStyle = value?.review?.diffStyle

          return diffStyle === undefined ? undefined : { diffStyle }
        },
      },
    ),
    panel: Store.global(
      PanelState,
      { expandMode: "collapse" },
      {
        key: "review-panel-v2",
        pick: (value: { expandMode?: unknown } | null) => {
          const expandMode = value?.expandMode

          return expandMode === undefined ? undefined : { expandMode }
        },
      },
    ),
    // Whether narrow screens wrap long diff lines; stored before in the app settings.
    mobileDiff: Store.global(
      MobileDiff,
      { wrap: true },
      {
        key: "settings.v3",
        pick: (value: { general?: { mobileDiffWrap?: unknown } } | null) => {
          const wrap = value?.general?.mobileDiffWrap

          return wrap === undefined ? undefined : { wrap }
        },
      },
    ),
    // The mode, selected file and open files of each session.
    session: Store.session(
      SessionState,
      { open: [] },
      {
        key: "layout",
        sessions: "sessionView",
        // An entry that holds only other fields, such as its scroll, holds no review state.
        pick: (entry: { reviewMode?: unknown; reviewFile?: unknown; reviewOpen?: unknown } | undefined) =>
          entry && [entry.reviewMode, entry.reviewFile, entry.reviewOpen].some((field) => field !== undefined)
            ? { mode: entry.reviewMode, file: entry.reviewFile, open: entry.reviewOpen }
            : undefined,
      },
    ),
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
