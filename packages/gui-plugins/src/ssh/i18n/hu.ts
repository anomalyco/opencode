export default {
  label: "SSH",
  placeholder: "ssh user@example.com",
  add: "SSH szerver hozzáadása",
  "server.menu.label": "SSH szerver",
  target: "Host vagy SSH parancs",
  connect: "Csatlakozás",
  connectTo: "Csatlakozás a {{host}}",
  authenticate: "SSH hitelesítés",
  "session.disconnected": "SSH kapcsolat inaktív",
  "session.connecting": "Csatlakozás a SSH szerverhez",
  "session.reconnectDescription":
    "Csatlakozzon újra a munkamenet megtekintéséhez és a munka folytatásához. A távoli munkamenet megmarad.",
  "session.reconnect": "Csatlakozás újra",
  trust: "Bízzon és csatlakozzon",
  continue: "Folytatás",
  update: "Frissítés és újracsatlakozás",
  project: "Projekt megnyitása a {{host}}",
  "stage.incompatible": "Szerverfrissítés szükséges",
  "error.input":
    "Adjon meg egy gazdagép vagy SSH kapcsolódási parancsot. A távoli parancsok és a nem támogatott SSH opciók nem engedélyezettek.",
  "error.connection": "Nem sikerült létrehozni a SSH kapcsolatot. Ellenőrizze a hálózatot és a SSH konfigurációt.",
  "error.platform":
    "Ez a távoli platform nem támogatott. Az automatikus beállításhoz jelenleg Linux vagy macOS szükséges x64-en vagy arm64-en.",
  "error.version": "A távoli szolgáltatásnak meg kell egyeznie ezzel az asztali verzióval a csatlakozás előtt.",
  "error.install":
    "Nem sikerült telepíteni a távoli kiszolgálót. Ellenőrizze a csatlakozást, a lemezterületet és a tar telepítését.",
  "error.unpublished":
    "Ennek az asztali verziónak nincs közzétett távoli kiszolgálója. Fejlesztési összeállításokhoz telepítse és indítsa el a V2-t a gazdagépen, majd próbálkozzon újra.",
  "error.service": "A SSH csatlakozott, de a OpenCode szerver nem vált készenlétben.",
  "error.host-key":
    "A házigazda személyazonosságát nem sikerült ellenőrizni. A SSH ismert gazdagépeinek frissítése előtt ellenőrizze az ujjlenyomatát.",
  "error.ssh-missing":
    "OpenSSH nem található. Telepítsen egy OpenSSH klienst, és győződjön meg arról, hogy az ssh elérhető a PATH-on.",
  "action.authenticate": "Hitelesítés",
  "stage.connecting": "Csatlakozás SSH-n keresztül…",
  "stage.authentication": "Hitelesítés szükséges",
  "form.name": "Szerver neve (nem kötelező)",
  "form.namePlaceholder": "Localhost",
  "form.add": "Szerver hozzáadása",
  "menu.delete": "Törlés",
}
