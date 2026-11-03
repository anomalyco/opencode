import { app, session, type MenuItemConstructorOptions } from "electron"
import { SPELLCHECK_ENABLED_KEY, SPELLCHECK_LANGUAGES_KEY } from "../storage/keys"
import { getStore } from "../storage/store"
import { defaultSpellcheckLanguages } from "./spellcheck-languages"
import { nativeLanguageOptions, nativeT } from "./translations"

// macOS checks spelling with the system spellchecker, which detects the language itself; Electron
// ignores dictionary choices there.
const choosesLanguages = process.platform !== "darwin"

export function applySpellcheck() {
  // Setting languages also turns the spellchecker on, so the stored on/off state goes last.
  if (choosesLanguages) session.defaultSession.setSpellCheckerLanguages(spellcheckLanguages())

  session.defaultSession.setSpellCheckerEnabled(getSpellcheckEnabled())
}

export function getSpellcheckEnabled() {
  return getStore().get(SPELLCHECK_ENABLED_KEY) !== false
}

export function setSpellcheckEnabled(enabled: boolean) {
  getStore().set(SPELLCHECK_ENABLED_KEY, enabled)
  session.defaultSession.setSpellCheckerEnabled(enabled)
}

// Mirrors the Spellcheck menu in chat apps: a checkbox, and a dictionary picker where Electron owns
// the dictionaries.
export function spellcheckMenuItems(): MenuItemConstructorOptions[] {
  const enabled = getSpellcheckEnabled()
  const current = session.defaultSession.getSpellCheckerLanguages()

  const toggle: MenuItemConstructorOptions = {
    label: nativeT("desktop.contextMenu.spellcheck"),
    type: "checkbox",
    checked: enabled,
    click: () => setSpellcheckEnabled(!enabled),
  }

  if (!choosesLanguages) return [{ type: "separator" }, toggle]

  return [
    { type: "separator" },
    toggle,
    {
      label: nativeT("desktop.contextMenu.spellcheckLanguages"),
      enabled,
      submenu: nativeLanguageOptions(session.defaultSession.availableSpellCheckerLanguages).map((option) => ({
        label: option.label,
        type: "checkbox",
        checked: current.includes(option.tag),
        // The last dictionary stays; the Spellcheck checkbox is how to stop checking entirely.
        enabled: !(current.length === 1 && current[0] === option.tag),
        click: () => {
          const next = current.includes(option.tag)
            ? current.filter((language) => language !== option.tag)
            : [...current, option.tag]

          getStore().set(SPELLCHECK_LANGUAGES_KEY, next)
          session.defaultSession.setSpellCheckerLanguages(next)
        },
      })),
    },
  ]
}

// Dictionaries picked from the menu win; otherwise follow the system languages on every launch.
function spellcheckLanguages() {
  const available = session.defaultSession.availableSpellCheckerLanguages
  const stored = getStore().get(SPELLCHECK_LANGUAGES_KEY)
  const chosen = Array.isArray(stored) ? available.filter((language) => stored.includes(language)) : []

  return chosen.length ? chosen : defaultSpellcheckLanguages(available, app.getPreferredSystemLanguages())
}
