import { dict as en } from "./en"

type Keys = keyof typeof en

export const dict = {
  "ui.sessionReview.title": "Sitzungsänderungen",
  "ui.sessionReview.diffStyle.unified": "Vereinheitlicht",
  "ui.sessionReview.diffStyle.split": "Geteilt",
  "ui.sessionReview.expandAll": "Alle erweitern",
  "ui.sessionReview.collapseAll": "Alle reduzieren",

  "ui.sessionReview.change.added": "Hinzugefügt",
  "ui.sessionReview.change.removed": "Entfernt",
  "ui.lineComment.label.prefix": "Kommentar zu ",
  "ui.lineComment.label.suffix": "",
  "ui.lineComment.editorLabel.prefix": "Kommentiere ",
  "ui.lineComment.editorLabel.suffix": "",
  "ui.lineComment.placeholder": "Kommentar hinzufügen",
  "ui.lineComment.submit": "Kommentieren",
  "ui.sessionTurn.steps.show": "Schritte anzeigen",
  "ui.sessionTurn.steps.hide": "Schritte ausblenden",
  "ui.sessionTurn.summary.response": "Antwort",
  "ui.sessionTurn.diff.showMore": "Weitere Änderungen anzeigen ({{count}})",

  "ui.sessionTurn.retry.retrying": "erneuter Versuch",
  "ui.sessionTurn.retry.inSeconds": "in {{seconds}}s",

  "ui.sessionTurn.status.delegating": "Arbeit delegieren",
  "ui.sessionTurn.status.planning": "Nächste Schritte planen",
  "ui.sessionTurn.status.gatheringContext": "Kontext sammeln",
  "ui.sessionTurn.status.searchingCodebase": "Codebasis durchsuchen",
  "ui.sessionTurn.status.searchingWeb": "Web durchsuchen",
  "ui.sessionTurn.status.makingEdits": "Änderungen vornehmen",
  "ui.sessionTurn.status.runningCommands": "Befehle ausführen",
  "ui.sessionTurn.status.thinking": "Denken",
  "ui.sessionTurn.status.thinkingWithTopic": "Denken - {{topic}}",
  "ui.sessionTurn.status.gatheringThoughts": "Gedanken sammeln",
  "ui.sessionTurn.status.consideringNextSteps": "Nächste Schritte erwägen",

  "ui.messagePart.diagnostic.error": "Fehler",
  "ui.messagePart.title.edit": "Bearbeiten",
  "ui.messagePart.title.write": "Schreiben",
  "ui.messagePart.option.typeOwnAnswer": "Eigene Antwort eingeben",
  "ui.messagePart.review.title": "Antworten überprüfen",

  "ui.list.loading": "Laden",
  "ui.list.empty": "Keine Ergebnisse",
  "ui.list.clearFilter": "Filter löschen",
  "ui.list.emptyWithFilter.prefix": "Keine Ergebnisse für",
  "ui.list.emptyWithFilter.suffix": "",

  "ui.messageNav.newMessage": "Neue Nachricht",

  "ui.textField.copyToClipboard": "In die Zwischenablage kopieren",
  "ui.textField.copyLink": "Link kopieren",
  "ui.textField.copied": "Kopiert",

  "ui.imagePreview.alt": "Bildvorschau",

  "ui.tool.read": "Lesen",
  "ui.tool.loaded": "Geladen",
  "ui.tool.list": "Auflisten",
  "ui.tool.glob": "Glob",
  "ui.tool.grep": "Grep",
  "ui.tool.webfetch": "Webabruf",
  "ui.tool.shell": "Shell",
  "ui.tool.patch": "Patch",
  "ui.tool.todos": "Aufgaben",
  "ui.tool.todos.read": "Aufgaben lesen",
  "ui.tool.questions": "Fragen",
  "ui.tool.agent": "{{type}} Agent",

  "ui.common.file.one": "Datei",
  "ui.common.file.other": "Dateien",
  "ui.common.question.one": "Frage",
  "ui.common.question.other": "Fragen",

  "ui.common.add": "Hinzufügen",
  "ui.common.cancel": "Abbrechen",
  "ui.common.confirm": "Bestätigen",
  "ui.common.dismiss": "Verwerfen",
  "ui.common.close": "Schließen",
  "ui.common.next": "Weiter",
  "ui.common.submit": "Absenden",

  "ui.permission.deny": "Verweigern",
  "ui.permission.allowAlways": "Immer erlauben",
  "ui.permission.allowOnce": "Einmal erlauben",

  "ui.message.expand": "Nachricht erweitern",
  "ui.message.collapse": "Nachricht reduzieren",
  "ui.message.copy": "Kopieren",
  "ui.message.copied": "Kopiert!",
  "ui.message.attachment.alt": "Anhang",

  "ui.patch.action.deleted": "Gelöscht",
  "ui.patch.action.created": "Erstellt",
  "ui.patch.action.moved": "Verschoben",
  "ui.patch.action.patched": "Gepatched",

  "ui.question.subtitle.answered": "{{count}} beantwortet",
  "ui.question.answer.none": "(keine Antwort)",
  "ui.question.review.notAnswered": "(nicht beantwortet)",
  "ui.question.multiHint": "(alle zutreffenden auswählen)",
  "ui.question.custom.placeholder": "Geben Sie Ihre Antwort ein...",
} satisfies Partial<Record<Keys, string>>
