import type { Dict } from "./en"
import { dict as en } from "./en"

export const dict = {
  ...en,
  "desktop.menu.checkForUpdates": "Controlla aggiornamenti...",
  "desktop.menu.installCli": "Installa CLI...",
  "desktop.menu.reloadWebview": "Ricarica Webview",
  "desktop.menu.restart": "Riavvia",

  "desktop.dialog.chooseFolder": "Scegli una cartella",
  "desktop.dialog.chooseFile": "Scegli un file",
  "desktop.dialog.saveFile": "Salva file",

  "desktop.updater.checkFailed.title": "Controllo aggiornamenti fallito",
  "desktop.updater.checkFailed.message": "Controllo aggiornamenti fallito",
  "desktop.updater.none.title": "Nessun aggiornamento disponibile",
  "desktop.updater.none.message": "Stai già usando l'ultima versione di OpenCode",
  "desktop.updater.downloadFailed.title": "Aggiornamento fallito",
  "desktop.updater.downloadFailed.message": "Download aggiornamento fallito",
  "desktop.updater.downloaded.title": "Aggiornamento scaricato",
  "desktop.updater.downloaded.prompt":
    "La versione {{version}} di OpenCode è stata scaricata, vuoi installarla e riavviare?",
  "desktop.updater.installFailed.title": "Aggiornamento fallito",
  "desktop.updater.installFailed.message": "Installazione aggiornamento fallita",

  "desktop.cli.installed.title": "CLI installata",
  "desktop.cli.installed.message": "CLI installata in {{path}}\n\nRiavvia il terminale per usare il comando 'opencode'.",
  "desktop.cli.failed.title": "Installazione fallita",
  "desktop.cli.failed.message": "Installazione CLI fallita: {{error}}",
} as Dict