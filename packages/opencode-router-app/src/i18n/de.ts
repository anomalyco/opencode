export const dict = {
  "app.loading": "Lädt...",
  "app.error.connect": "Verbindung fehlgeschlagen",
  "app.error.timeout": "Anfrage abgelaufen — der Router ist möglicherweise nicht erreichbar",

  "session.idle.stopsIn": "stoppt in ~{{minutes}}m",
  "session.idle.stoppedOn": "gestoppt am {{date}}",
  "session.idle.stoppingSoon": "stoppt gleich",

  "session.action.cancel": "Abbrechen",
  "session.action.attach": "Attach ⌘",
  "session.action.attachCopied": "In die Zwischenablage kopiert",
  "session.action.terminate": "Beenden",
  "session.action.terminating": "Wird beendet…",
  "session.terminate.title": "Sitzung beenden?",
  "session.terminate.description":
    '„{{repo}}" wird unwiderruflich gelöscht – alle nicht gespeicherten Änderungen gehen verloren.',

  "form.submit": "Sitzung starten",
  "form.submitting": "Wird gestartet...",
  "form.error.sessionBranch": "Sitzungs-Branch konnte nicht generiert werden – bitte erneut versuchen",
  "form.error.sessionBranch.waiting": "Warte auf Sitzungs-Branch…",
  "form.error.prompt.required": "Beschreibe deine Aufgabe, um fortzufahren",
  "form.error.repoUrl.required": "Repository-URL ist erforderlich",
  "form.error.repoUrl.invalid": "Gib eine gültige HTTP(S)-Repository-URL ein",
  "form.error.sourceBranch.required": "Quell-Branch ist erforderlich",

  "loading.title": "Deine OpenCode-Sitzung wird gestartet...",
  "loading.subtitle": "Sitzung wird initialisiert...",

  "loading.stage.initializing": "Initialisierung",
  "loading.stage.configuring": "Umgebung konfigurieren",
  "loading.stage.cloning": "Repository klonen",
  "loading.stage.starting": "OpenCode-Server starten",
  "loading.stage.readying": "Sitzung abschließen",

  "app.welcomeBack": "Willkommen zurück, {{email}}",
  "app.sessions": "Sitzungen",
  "app.recents": "Zuletzt verwendet",
  "app.newSession": "Neue Sitzung",
  "app.newSession.repoUrl.placeholder": "https://github.com/org/repo.git",
  "app.newSession.sourceBranch.placeholder": "main",
  "app.newSession.prompt.placeholder": "Beschreibe eine Aufgabe oder stelle eine Frage",
  "sidebar.collapse": "Seitenleiste einklappen",
  "sidebar.expand": "Seitenleiste ausklappen",
} as const

export type DictKey = keyof typeof dict
