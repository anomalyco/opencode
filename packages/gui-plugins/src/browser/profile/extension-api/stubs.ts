import { Schema } from "effect"
import { constant, method, none, type ApiModule, type ApiNamespace, type Wire } from "./api"
import type { Manifests } from "./manifest"

// Browser settings an extension may read or change: here none is under its control, so it reads Chrome's defaults.
const SETTINGS = {
  "privacy.network.networkPredictionEnabled": true,
  "privacy.network.webRTCIPHandlingPolicy": "default",
  "privacy.services.alternateErrorPagesEnabled": false,
  "privacy.services.autofillAddressEnabled": true,
  "privacy.services.autofillCreditCardEnabled": true,
  "privacy.services.autofillEnabled": true,
  "privacy.services.passwordSavingEnabled": true,
  "privacy.services.safeBrowsingEnabled": true,
  "privacy.services.searchSuggestEnabled": true,
  "privacy.services.spellingServiceEnabled": false,
  "privacy.services.translationServiceEnabled": false,
  "privacy.websites.hyperlinkAuditingEnabled": true,
  "privacy.websites.referrersEnabled": true,
  "privacy.websites.thirdPartyCookiesAllowed": true,
  "privacy.websites.doNotTrackEnabled": false,
  "privacy.websites.protectedContentEnabled": true,
} satisfies Readonly<Record<string, Wire>>

/**
 * Namespaces this browser has nothing behind, so an extension that reads them as it starts still starts. Each
 * answers truthfully that there is nothing: no history, bookmarks, downloads or recently closed sessions, no font
 * list, no browser account, no side panel, settings that stay as they are, and commands without shortcuts. Their
 * events never fire.
 */
export function createStubs(input: { manifest: Manifests }): ApiModule {
  const settings = Object.entries(SETTINGS).map(
    ([path]): ApiNamespace => ({ path, permissions: ["privacy"], methods: ["get", "set", "clear"], events: ["onChange"] }),
  )

  return {
    namespaces: [
      ...settings,
      {
        path: "sidePanel",
        permissions: ["sidePanel"],
        methods: ["setOptions", "getOptions", "setPanelBehavior", "getPanelBehavior", "open", "close"],
        events: ["onOpened", "onClosed"],
      },
      { path: "fontSettings", permissions: ["fontSettings"], methods: ["getFontList", "getFont", "setFont", "clearFont"] },
      {
        path: "history",
        permissions: ["history"],
        methods: ["search", "getVisits", "addUrl", "deleteUrl", "deleteRange", "deleteAll"],
        events: ["onVisited", "onVisitRemoved"],
      },
      {
        path: "bookmarks",
        permissions: ["bookmarks"],
        methods: ["get", "getChildren", "getRecent", "getTree", "getSubTree", "search", "create", "move", "update", "remove", "removeTree"],
        events: ["onCreated", "onRemoved", "onChanged", "onMoved", "onChildrenReordered", "onImportBegan", "onImportEnded"],
      },
      {
        path: "sessions",
        permissions: ["sessions"],
        methods: ["getRecentlyClosed", "getDevices", "restore"],
        events: ["onChanged"],
        constants: { MAX_SESSION_RESULTS: 25 },
      },
      { path: "search", permissions: ["search"], methods: ["query"] },
      {
        path: "downloads",
        permissions: ["downloads"],
        methods: ["download", "search", "pause", "resume", "cancel", "getFileIcon", "open", "show", "showDefaultFolder", "erase", "removeFile", "acceptDanger", "setUiOptions"],
        events: ["onCreated", "onErased", "onChanged", "onDeterminingFilename"],
      },
      {
        path: "identity",
        permissions: ["identity"],
        methods: ["getAuthToken", "getProfileUserInfo", "getAccounts", "removeCachedAuthToken", "clearAllCachedAuthTokens", "launchWebAuthFlow", "getRedirectURL"],
        events: ["onSignInChanged"],
      },
      { path: "commands", methods: ["getAll"], events: ["onCommand", "onChanged"] },
      // Extensions load without file access, and the profile has no incognito window.
      { path: "extension", methods: ["isAllowedFileSchemeAccess", "isAllowedIncognitoAccess", "setUpdateUrlData"] },
    ],
    methods: {
      ...Object.fromEntries(
        Object.entries(SETTINGS).flatMap(([path, value]) => [
          [`${path}.get`, constant({ value, levelOfControl: "not_controllable" })],
          [`${path}.set`, constant(undefined)],
          [`${path}.clear`, constant(undefined)],
        ]),
      ),
      "sidePanel.setOptions": constant(undefined),
      "sidePanel.getOptions": constant({ enabled: false }),
      "sidePanel.setPanelBehavior": constant(undefined),
      "sidePanel.getPanelBehavior": constant({ openPanelOnActionClick: false }),
      "sidePanel.open": unavailable("This browser has no side panel."),
      "sidePanel.close": constant(undefined),
      "fontSettings.getFontList": constant([]),
      "fontSettings.getFont": constant({ fontId: "", levelOfControl: "not_controllable" }),
      "fontSettings.setFont": constant(undefined),
      "fontSettings.clearFont": constant(undefined),
      "history.search": constant([]),
      "history.getVisits": constant([]),
      "history.addUrl": constant(undefined),
      "history.deleteUrl": constant(undefined),
      "history.deleteRange": constant(undefined),
      "history.deleteAll": constant(undefined),
      "bookmarks.get": constant([]),
      "bookmarks.getChildren": constant([]),
      "bookmarks.getRecent": constant([]),
      "bookmarks.getTree": constant([{ id: "0", title: "", children: [] }]),
      "bookmarks.getSubTree": constant([]),
      "bookmarks.search": constant([]),
      "bookmarks.create": unavailable("This browser has no bookmarks."),
      "bookmarks.move": unavailable("This browser has no bookmarks."),
      "bookmarks.update": unavailable("This browser has no bookmarks."),
      "bookmarks.remove": unavailable("This browser has no bookmarks."),
      "bookmarks.removeTree": unavailable("This browser has no bookmarks."),
      "sessions.getRecentlyClosed": constant([]),
      "sessions.getDevices": constant([]),
      "sessions.restore": unavailable("This browser keeps no closed sessions."),
      "search.query": unavailable("This browser has no search engine for extensions."),
      "downloads.download": unavailable("Extensions cannot download files in this browser."),
      "downloads.search": constant([]),
      ...Object.fromEntries(
        ["pause", "resume", "cancel", "open", "show", "showDefaultFolder", "acceptDanger", "setUiOptions", "removeFile"].map(
          (name) => [`downloads.${name}`, constant(undefined)],
        ),
      ),
      "downloads.getFileIcon": constant(undefined),
      "downloads.erase": constant([]),
      "identity.getAuthToken": unavailable("This browser has no browser account to sign in with."),
      "identity.getProfileUserInfo": constant({ email: "", id: "" }),
      "identity.getAccounts": constant([]),
      "identity.removeCachedAuthToken": constant(undefined),
      "identity.clearAllCachedAuthTokens": constant(undefined),
      "identity.launchWebAuthFlow": unavailable("This browser cannot open a sign-in window for extensions."),
      "identity.getRedirectURL": method(Schema.Tuple([Schema.optional(Schema.String)]), (context, [path]) =>
        `https://${context.extension.id}.chromiumapp.org/${path ?? ""}`,
      ),
      "extension.isAllowedFileSchemeAccess": constant(false),
      "extension.isAllowedIncognitoAccess": constant(false),
      "extension.setUpdateUrlData": constant(undefined),
      // Shortcuts are not bound here, so each command reports none.
      "commands.getAll": method(none, (context) =>
        input.manifest(context.extension).commands.map((command) => ({ ...command, shortcut: "" })),
      ),
    },
  }
}

function unavailable(message: string) {
  return () => Promise.reject(new Error(message))
}
