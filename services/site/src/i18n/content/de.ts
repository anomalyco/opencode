import type { ContentOverlay } from "./source"

export const content = {
  products: {
    desktop: {
      name: "Desktop",
      body: "Sessions, Tabs, Diffs, integrierter Browser und Erweiterungen für macOS, Windows und Linux.",
      action: "Download",
    },
    mobile: {
      name: "Mobile",
      body: "Starte und steuere Sessions auf dem Handy und erteile Freigaben. Egal, wo du bist.",
      action: "Download",
    },
    terminal: {
      name: "Terminal",
      body: "Ein schnelles Terminal-UI für jede Shell, jeden Editor und jeden Remote-Server.",
      action: "Installieren",
    },
    sdk: { body: "Steuere OpenCode aus deinen eigenen Skripten, CI-Jobs und Tools.", action: "Doku lesen" },
    mini: {
      body: "Eine schlanke Terminal-Oberfläche. Die Antworten landen im Scrollback, darunter steht der Prompt.",
      action: "Installieren",
    },
  },
  productDetails: {
    desktop: {
      title: "OpenCode | Desktop-App für macOS, Windows und Linux",
      description:
        "Lass beliebig viele OpenCode-Agenten parallel laufen, sieh jede Änderung im Browser nebenan und arbeite auf jedem Gerät weiter. Für macOS, Windows und Linux.",
      intro:
        "Lass mehrere Agenten parallel laufen, mit einem Tab pro Session. Prüfe jede Änderung als Diff, kommentiere beliebige Zeilen und sieh dir das Ergebnis im integrierten Browser an. Für macOS, Windows und Linux.",
      showcase: {
        "parallel-agents": {
          title: "Agenten parallel ausführen",
          body: "Starte beliebig viele Agenten gleichzeitig und wechsle zu ihnen, sobald sie fertig sind.",
        },
        "see-it-in-the-browser": {
          title: "Im Browser ansehen",
          body: "Deine App läuft im Browser direkt neben dem Agenten. So seht ihr beide Änderungen, sobald sie wirksam werden.",
        },
        "on-every-device": {
          title: "Auf jedem Gerät",
          body: "Starte Agenten auf jedem deiner Geräte und mach in der Desktop-App, im Terminal oder auf dem Handy weiter.",
        },
        "extend-it": {
          title: "Erweitern",
          body: "Verbinde deine Tools und Dienste, damit der Agent sie nutzen kann. Oder lass OpenCode eigene Plugins bauen, mit eigener Oberfläche in der Seitenleiste.",
        },
      },
    },
    mobile: {
      title: "OpenCode | Mobile: deine Coding-Sessions auf dem Handy",
      description:
        "Starte und steuere OpenCode-Sessions vom Handy aus. Sprich mit dem Agenten, während er auf deinem Rechner läuft.",
      intro:
        "Starte und steuere Sessions von unterwegs. Ruf eine Session an und sprich mit dem Agenten oder öffne eine Session und mach da weiter, wo du aufgehört hast. OpenCode läuft dabei auf deinem eigenen Rechner.",
      features: {
        "notify-when-done": {
          title: "Benachrichtigung",
          body: "Erhalte eine kurze Zusammenfassung, wenn eine gestartete Session fertig ist.",
        },
        "pair-from-anywhere": {
          title: "Von überall koppeln",
          body: "Verbinde dich mit opencode pair --remote aus jedem Netzwerk.",
        },
        "every-computer": {
          title: "Jeder Computer",
          body: "Wechsle mit einem Tipp zwischen deinen gekoppelten Computern.",
        },
        "siri-and-shortcuts": {
          title: "Siri und Kurzbefehle",
          body: "Starte einen Anruf oder eine Session über Siri oder das Kontrollzentrum.",
        },
        "follow-along": {
          title: "Mitverfolgen",
          body: "Sieh zu, wie sich die Timeline aktualisiert, während der Agent arbeitet.",
        },
        "your-computer": { title: "Dein Computer", body: "Verbindet sich mit OpenCode auf deinem eigenen Rechner." },
        "share-sheet": { title: "Teilen-Menü", body: "Teile alles mit einer Session, ohne die App zu öffnen." },
        "mute-sessions": {
          title: "Stummschalten",
          body: "Behalte eine Session in deiner Liste, ohne ihre Benachrichtigungen zu bekommen.",
        },
      },
      showcase: {
        voice: { title: "Sprache", body: "Ruf eine Session an und sag, was du brauchst. Der Agent antwortet per Sprache." },
        sessions: {
          title: "Sessions",
          body: "Öffne eine beliebige Session, sieh dir den aktuellen Stand an und mach weiter, wo du aufgehört hast.",
        },
        results: { title: "Ergebnisse", body: "Sobald der Agent fertig ist, erfährst du im Anruf, was sich geändert hat." },
      },
    },
    terminal: {
      title: "OpenCode | Terminal-UI für den Open-Source-Coding-Agenten",
      description:
        "Ein schnelles Terminal-UI für OpenCode, das in jeder Shell, jedem Editor und auf jedem Remote-Server läuft. Beschreib, was du brauchst, prüf Änderungen als Diffs und gib Befehle frei.",
      intro:
        "Ein schnelles Terminal-UI für jede Shell, jeden Editor und jeden Remote-Server. Beschreib in einfachen Worten, was du brauchst, verfolg Änderungen live als Diffs und leg fest, welche Befehle automatisch laufen.",
      features: {
        "any-terminal": {
          title: "Jedes Terminal",
          body: "Läuft in jeder Shell, im Terminal deines Editors oder auf einem Remote-Server.",
        },
        "diffs-in-the-timeline": {
          title: "Diffs in der Timeline",
          body: "Verfolg in der Timeline als Diff, was der Agent gerade ändert.",
        },
        "pick-up-later": {
          title: "Weitermachen",
          body: "Setz mit -c die letzte Session fort, mit -s eine beliebige.",
        },
        "one-off-runs": {
          title: "Einmalige Ausführung",
          body: "opencode run sendet eine Nachricht und gibt die Antwort aus.",
        },
        "agents-and-commands": {
          title: "Agenten und Befehle",
          body: "Wechsle mit shift+tab den Agenten und öffne mit ctrl+p die Befehlsliste.",
        },
        "auto-approve": {
          title: "Automatische Freigabe",
          body: "Mit --auto erlaubst du alle Aktionen, außer denen, die du verweigert hast.",
        },
        "any-server": { title: "Jeder Server", body: "Verbinde dich mit --server per URL mit einem OpenCode-Server." },
        "usage-stats": { title: "Nutzungsstatistik", body: "opencode stats zeigt Nutzungsstatistiken, die du teilen kannst." },
      },
      showcase: {
        "ask-in-plain-words": {
          title: "In einfachen Worten",
          body: "Schreib, was du willst. Der Agent zeigt beim Arbeiten seinen Plan.",
        },
        "approve-what-runs": {
          title: "Du gibst Befehle frei",
          body: "Du siehst Änderungen als Diffs und entscheidest, welche Befehle laufen dürfen.",
        },
        "make-it-yours": {
          title: "Dein Terminal, dein Stil",
          body: "Wechsle das Theme per Tastendruck, etwa vom Standard zu tokyonight.",
        },
        mini: { title: "Mini", body: "Mit opencode mini landen Antworten in deinem eigenen Scrollback." },
      },
    },
    sdk: {
      title: "OpenCode | TypeScript-SDK für Skripte, CI-Jobs und Tools",
      description:
        "Steuere OpenCode aus deinen eigenen Skripten, CI-Jobs und Tools. Der typisierte TypeScript-Client erstellt Sessions, sendet Prompts und streamt jedes Event in Echtzeit.",
      intro:
        "Steuere OpenCode aus eigenen Skripten, CI-Jobs und Tools. Das SDK führt OpenCode mit deiner Konfiguration und deinen Modellen direkt in deinem Prozess aus. Der typisierte Client erstellt Sessions, sendet Prompts und streamt jedes Event.",
      features: {
        "typescript-client": {
          title: "TypeScript-Client",
          body: "Typisierte Anfragen und Events mit denselben Werten wie @opencode/client.",
        },
        "sessions-from-code": {
          title: "Sessions aus Code",
          body: "Erstelle Sessions und sende Prompts aus jedem Skript.",
        },
        "any-model": { title: "Jedes Modell", body: "Nutzt alle Modelle aus deiner OpenCode-Konfiguration." },
        "npm-or-bun": {
          title: "npm oder bun",
          body: "Installiere es mit npm i @opencode/sdk oder bun add @opencode/sdk.",
        },
        "in-process-host": {
          title: "In-Process-Host",
          body: "Führt OpenCode im Speicher aus, ohne Umweg übers Netzwerk.",
        },
        "your-plugins": {
          title: "Deine Plugins",
          body: "Übergib eigene Plugins, wenn du den In-Process-Host erstellst.",
        },
        "promise-or-effect": {
          title: "Promise oder Effect",
          body: "Eine Promise-API und eine Effect-API mit denselben Werten.",
        },
        "cloudflare-workers": {
          title: "Cloudflare Workers",
          body: "Führe OpenCode in einem Cloudflare Durable Object auf Workers aus.",
        },
      },
      showcase: {
        "fix-ci-from-code": {
          title: "CI per Code reparieren",
          body: "Ein kurzes Skript bittet OpenCode, fehlgeschlagene Tests zu reparieren, und führt sie erneut aus.",
        },
        "follow-every-step": {
          title: "Jeden Schritt verfolgen",
          body: "Streame Events und sieh jedes Tool, das der Agent aufruft, in Echtzeit.",
        },
        "build-your-own-tools": {
          title: "Eigene Tools bauen",
          body: "Binde OpenCode mit wenigen Zeilen in Bots, Dashboards und Workflows ein.",
        },
        "in-your-process": {
          title: "In deinem Prozess",
          body: "OpenCode läuft mit deiner Konfiguration und deinen Modellen direkt in deinem Prozess.",
        },
      },
    },
    mini: {
      title: "OpenCode | Mini: eine schlanke Terminal-Oberfläche für den Agenten",
      description:
        "Mini führt OpenCode in einer schlanken Terminal-Oberfläche aus. Antworten landen im Scrollback deines Terminals. Unten bleiben nur ein Prompt und eine Statuszeile.",
      intro:
        "Die schlanke Terminal-Oberfläche für OpenCode. Mit opencode mini landen Antworten direkt im Scrollback deines Terminals. Dort kannst du wie bei jeder anderen Ausgabe scrollen, suchen und kopieren. Unten bleiben nur der Prompt und eine Statuszeile.",
      features: {
        "your-scrollback": { title: "Dein Scrollback", body: "Antworten erscheinen wie jede andere Ausgabe im Scrollback." },
        "one-prompt": { title: "Ein Prompt", body: "Agent, Modell, Kontext und Kosten in einer Statuszeile." },
        permissions: { title: "Berechtigungen", body: "Erlaube Änderungen und Befehle direkt im Prompt-Bereich." },
        "how-much-shows": {
          title: "Wie viel du siehst",
          body: "Wähl für Denkprozess und Tool-Ausgaben zwischen reduzierter, normaler und vollständiger Anzeige.",
        },
        "pick-up-later": {
          title: "Weitermachen",
          body: "Setz mit -c die letzte Session fort, mit -s eine beliebige.",
        },
        "same-opencode": {
          title: "Dasselbe OpenCode",
          body: "Derselbe Server, dieselben Agenten und dieselben Modelle wie in den anderen Apps.",
        },
        agents: { title: "Agenten", body: "Wechsle den Agenten direkt im Prompt." },
        compact: { title: "Compaction", body: "Komprimier eine lange Session mit /compact." },
      },
    },
  },
  extensionCard: {
    name: "Erweiterungen",
    body: "Nutze OpenCode in VS Code oder über ACP in Zed und anderen Editoren.",
    action: "Installieren",
  },
  extensions: {
    browse: {
      body: "Lass Agenten in deinem eigenen Browser arbeiten.",
      title: "OpenCode | Browse: dein Browser für Coding-Agenten",
      description:
        "Mit Browse nutzen OpenCode und andere MCP-Clients deinen eigenen Browser. Agenten lesen, klicken und tippen, erstellen Screenshots und zeichnen Tabs auf. Für die Anmeldung oder 2FA übernimmst du.",
      intro:
        "Mit dem MCP-Server und der Chromium-Erweiterung arbeiten deine Agenten in deinem eigenen Browser, mit deinen Tabs, Anmeldungen und Erweiterungen. Sie öffnen eigene Tab-Gruppen im Hintergrund, lesen Seiten, klicken und tippen, erstellen Screenshots und zeichnen Tabs auf. Bei Anmeldungen, 2FA oder Zahlungen geben sie dir den Tab zurück. Sobald du auf „Continue“ klickst, machen sie weiter.",
      features: {
        "your-real-browser": {
          title: "Dein eigener Browser",
          body: "Chrome, Edge, Brave, Arc, Helium, Vivaldi, Opera und Chromium.",
        },
        "out-of-your-way": {
          title: "Unauffällig im Hintergrund",
          body: "Tabs von Agenten öffnen sich im Hintergrund in eingeklappten Gruppen.",
        },
        handoffs: { title: "Übergaben", body: "Übernimm bei der Anmeldung oder 2FA und klick dann auf „Continue“." },
        "lend-a-tab": {
          title: "Tab übergeben",
          body: "Übergib einem Agenten über die Schaltfläche in der Symbolleiste einen offenen Tab.",
        },
        "record-and-capture": {
          title: "Aufnehmen",
          body: "Screenshots, Tab-Aufnahmen und Netzwerkverkehr.",
        },
        "any-mcp-client": {
          title: "Jeder MCP-Client",
          body: "OpenCode, Claude Code, Cursor, Codex, Zed und viele mehr.",
        },
        "all-your-logins": {
          title: "Deine Anmeldungen",
          body: "Agenten nutzen Websites, auf denen du schon angemeldet bist. Keine Schlüssel, keine Einrichtung.",
        },
        "allowed-sites": { title: "Erlaubte Websites", body: "Beschränk Agenten-Tabs auf die Websites, die du vorgibst." },
      },
      install:
        "Installier zuerst die [Chrome-Erweiterung]. Sie führt dich durch die nächsten Schritte. Die CLI kannst du mit einem dieser Befehle direkt installieren. Das ist normalerweise nicht nötig.",
    },
  },
  apps: {
    browse: {
      category: "Browsersteuerung für Agenten",
      body: "Lass deinen Agenten in deinem Browser arbeiten, mit deinen Anmeldungen und Tabs.",
    },
    opentunnel: { category: "Lokale Tunnel", body: "Öffentliche HTTPS-URLs für lokale Apps." },
    opentui: { category: "Bibliothek", body: "Eine Bibliothek für Terminal-Oberflächen." },
    hex: { category: "Diktieren", body: "Diktier in jeder App direkt auf deinem Gerät." },
  },
  getStarted: {
    title: "Loslegen",
    lead: "Am einfachsten startest du, indem du OpenCode herunterlädst und die kostenlosen Modelle nutzt. Ohne Konto. Für mehr Modelle nutzt du dein eigenes Abo oder OpenCode Go.",
    phrases: {
      "download-opencode": { text: "OpenCode herunterlädst" },
      "free-models": { text: "kostenlosen Modelle" },
      "your-own-subscription": { text: "dein eigenes Abo" },
      "a-subscription-you-already-have": { text: "ein Abo, das du schon hast" },
    },
    subscriptions: { "chatgpt-plus-pro": { name: "ChatGPT Plus/Pro" } },
    steps: {
      download: { title: "Download", line: "Desktop, Terminal oder Mobile." },
      "use-free-models": {
        title: "Kostenlose Modelle nutzen",
        line: "OpenCode bringt kostenlose Modelle mit. Ohne Konto.",
      },
      "add-more-models": {
        title: "Mehr Modelle",
        line: "Nutze dein eigenes Abo oder die ausgewählten Modelle von OpenCode Go ab 10 $ im Monat.",
      },
    },
    sentence:
      "Lade OpenCode herunter und starte mit kostenlosen Modellen. Wenn du mehr Modelle willst, nutze dein Abo oder OpenCode Go.",
  },
  byos: {
    title: "Eigenes Abo nutzen",
    headline: "Nutze die Abos, die du schon hast.",
    line: "Melde dich mit ChatGPT Plus oder Pro oder mit GitHub Copilot an. Oder nutze ein OpenCode-Abo.",
    yours: { label: "Dein Abo", items: { "chatgpt-plus-pro": { name: "ChatGPT Plus/Pro" } } },
    planLinks: ["OpenCode-Abo"],
    ours: { label: "OpenCode-Tarife" },
  },
  brand: {
    hero: { copy: { text: "Regeln für Agenten", copied: "Regeln kopiert" } },
    naming: {
      title: "Name",
      body: "Schreib OpenCode als ein Wort, mit großem O und großem C. Schreib nicht Opencode, Open Code, OpenCode AI oder Open-Code.",
      code: "Nutze das kleingeschriebene `opencode` nur in Code und Paketnamen, etwa `opencode-figma` oder `@acme/opencode-plugin`.",
    },
    families: {
      logo: {
        title: "Logo",
        body: "Das Logo ohne Wortmarke, für App-Icons, Avatare und andere kleine Flächen. Die quadratischen Varianten haben zusätzlichen Rand, wenn das Format einen quadratischen Zuschnitt verlangt.",
        assets: {
          light: { name: "Hell" },
          dark: { name: "Dunkel" },
          "square-light": { name: "Quadratisch, hell" },
          "square-dark": { name: "Quadratisch, dunkel" },
        },
      },
      wordmark: {
        title: "Wortmarke",
        body: "Der ausgeschriebene Name im OpenCode-Schriftzug. Nutze die Wortmarke überall, wo dafür genug Platz ist.",
        assets: { light: { name: "Hell" }, dark: { name: "Dunkel" } },
      },
      "simple-wordmark": {
        title: "Einfache Wortmarke",
        body: "Die einfarbige Wortmarke für Druck, Stickerei und alles, was nur eine Farbe zulässt.",
        assets: { light: { name: "Hell" }, dark: { name: "Dunkel" } },
      },
    },
    icons: {
      title: "Avatare",
      body: "Quadratische Avatare mit 1024 px für Slack, Discord, GitHub und andere Profile. Der Hintergrund füllt das ganze Quadrat. Das Logo bleibt beim runden Zuschnitt vollständig sichtbar.",
      items: { dark: { name: "Dunkel" }, light: { name: "Hell" } },
    },
    colors: {
      title: "Farben",
      body: "Logo und Wortmarke verwenden jeweils eine Farbe in drei Abstufungen der Deckkraft. Für dunkle Hintergründe ist der Farbton heller. Unten stehen die Farbwerte aus den Standarddateien. Verwende sie nur für das Logo und die Wortmarke, nicht für andere Texte oder Hintergründe. Klick zum Kopieren auf einen Wert.",
      palettes: {
        light: {
          name: "Hell",
          swatches: {
            ink: { name: "Farbe", use: "Die Kontur des Logos und die Buchstaben von „code“." },
            "ink-70": { name: "Farbe 70 %", use: "Die Buchstaben von „open“.", ink: "Die Farbe mit 70 % Deckkraft." },
            "ink-20": {
              name: "Farbe 20 %",
              use: "Die innere Schattierung des Logos.",
              ink: "Die Farbe mit 20 % Deckkraft.",
            },
          },
        },
        dark: {
          name: "Dunkel",
          swatches: {
            ink: { name: "Farbe", use: "Die Kontur des Logos und die Buchstaben von „code“." },
            "ink-72": { name: "Farbe 72 %", use: "Die Buchstaben von „open“.", ink: "Die Farbe mit 72 % Deckkraft." },
            "ink-28": {
              name: "Farbe 28 %",
              use: "Die innere Schattierung des Logos.",
              ink: "Die Farbe mit 28 % Deckkraft.",
            },
          },
        },
      },
    },
    variants: {
      title: "Varianten",
      body: "Achte auf einen gut sichtbaren Kontrast: dunkles Logo auf hellem Grund, helles Logo auf dunklem Grund. Logo und Wortmarke gibt es als separate Dateien. Verwende nur eines von beiden.",
      groups: {
        default: {
          name: "Standard",
          body: "Das Logo für fast alle Fälle. Die Schattierung innen ist transparent. Auf Schwarz und Weiß sieht das Logo genau wie die zweifarbige graue Variante aus. Bei Fotos, Verläufen und Farben scheint der Hintergrund durch.",
          rows: {
            logo: { title: "Logo", tiles: { dark: { name: "Dunkel" }, light: { name: "Hell" } } },
            wordmark: { title: "Wortmarke", tiles: { dark: { name: "Dunkel" }, light: { name: "Hell" } } },
          },
        },
        simple: {
          name: "Einfach",
          body: "Einfarbig, mit offenen Innenräumen und ohne Schattierung. Nutze diese Variante auf einfarbigen Flächen, für einfarbigen Druck und überall, wo die Grautöne nicht passen. Setz die dunkle Variante auf helle Farben und die helle auf dunkle Farben.",
          rows: { wordmark: { title: "Wortmarke", tiles: { dark: { name: "Dunkel" }, light: { name: "Hell" } } } },
        },
      },
    },
    usage: {
      title: "Einsatz",
      body: "Nutze die hellen Versionen auf hellen Hintergründen und die dunklen Versionen auf dunklen Hintergründen. Logo und Wortmarke sind getrennt. Nutze das eine oder das andere, nicht beide zusammen.",
      stroke: {
        title: "Ein Strich",
        body: "Abstände auf dieser Seite werden in Strichen gemessen. Ein Strich ist die Stärke der Logo-Kontur, also ein Viertel seiner Breite. Das Logo ist damit 4 Striche breit und 5 Striche hoch.",
      },
      clearSpace: {
        title: "Schutzraum",
        body: "Lass auf jeder Seite von Logo und Wortmarke mindestens zwei Striche Platz. Beim Logo ist ein Strich die Stärke seiner Kontur, ein Viertel seiner Breite. Bei der Wortmarke ist es die Stärke ihrer Buchstaben, ein Siebtel ihrer Höhe.",
      },
      pixels: {
        title: "Ganze Pixel",
        body: "Das Logo hat immer das Seitenverhältnis 4:5, ein Strich ist ein Viertel der Breite. Skaliere es in Schritten von 4 × 5 px, damit jede Kante und jeder Strich auf ganzen Pixeln liegt.",
        do: "jede Kante und den 4px-Strich auf ganzen Pixeln zu halten.",
        dont: "das Logo in einem anderen Verhältnis als 4:5 zu skalieren. Sonst liegen die Kanten zwischen den Pixeln und wirken unscharf.",
        sizes: { logo: { title: "Logo" }, wordmark: { title: "Wortmarke" } },
      },
      minimumTitle: "Mindestgrößen",
      minimum: {
        logo: { title: "Logo", body: "Mindestens 16 × 20px, mit einem 4px-Strich. Kleiner wird es unscharf." },
        wordmark: {
          title: "Wortmarke",
          body: "Mindestens 117 × 21px, mit einem 3px-Strich. Kleiner wird es unscharf.",
        },
      },
    },
    donts: {
      title: "Verbote",
      body: "Häufige Fehler, die du bei Logo und Wortmarke vermeiden solltest.",
      examples: {
        "two-tone": { caption: "das Logo in neuen Farben einzufärben." },
        bright: { caption: "eine einzelne grelle Farbe zu verwenden." },
        gradient: { caption: "das Logo mit einem Verlauf zu füllen." },
        inverted: { caption: "die Töne zu vertauschen." },
        stretch: { caption: "das Logo zu strecken oder zu stauchen." },
        shadow: { caption: "Schlagschatten hinzuzufügen." },
        glow: { caption: "Leuchteffekte oder Konturen hinzuzufügen." },
        lockup: { caption: "andere Wörter neben das Logo zu setzen." },
        "low-contrast": { caption: "kontrastarmes Grau auf Grau zu verwenden." },
        color: {
          caption:
            "das graue zweifarbige Logo auf einen farbigen Hintergrund zu setzen, wo seine Grautöne schmutzig wirken.",
        },
      },
    },
    integrations: {
      title: "Integrationen",
      body: "Du kannst kenntlich machen, dass dein Plugin, Anbieter oder Tool mit OpenCode funktioniert oder dass dein Projekt damit entstanden ist. Verwende ein Badge oder ein Partner-Lockup und mach im Namen deutlich, dass es dein eigenes Projekt ist.",
      badges: {
        body: "Setz ein Badge in dein README, in deine Doku oder auf deine Website und verlinke es mit opencode.ai. Wähl die helle oder dunkle Datei passend zum Hintergrund. In HTML wechselt die Variante automatisch. Lass Farben und Text unverändert.",
        sizes: "Alle Stile gibt es in 20, 32 und 44 px (Shields nur in 20 px), als SVG und als PNG mit doppelter Auflösung.",
        mono: "Alle Dateien gibt es auch mit Schrift in OpenMono. Setz dazu -mono vor die Dateiendung, wie in opencode-works-with-a-light-20-mono.svg. Für OpenMono in Großbuchstaben nimm -mono-caps.",
        groups: {
          "works-with": {
            title: "Läuft mit",
            alt: "Funktioniert mit OpenCode",
            body: "Für Plugins, Anbieter und Tools, die mit OpenCode laufen.",
          },
          "built-with": {
            title: "Gebaut mit",
            alt: "Gebaut mit OpenCode",
            body: "Für Projekte, die mit OpenCode entstanden sind.",
          },
        },
        styles: { a: { name: "Rahmen" }, c: { name: "Zellen" }, f: { name: "Vollfarbe" }, g: { name: "Shields" } },
      },
      lockup: {
        title: "Partner-Lockup",
        body: "Stell das OpenCode-Logo und das Partnerlogo nebeneinander, mit einem × dazwischen. Lass auf jeder Seite des × 3 Striche Platz, skaliere das Partnerlogo so, dass es so hoch wirkt wie das OpenCode-Logo, und halte Schutzraum um das ganze Lockup.",
      },
      naming: {
        title: "Dein Projekt benennen",
        body: "Stell deinen eigenen Namen voran, damit klar ist, dass das Projekt deins ist.",
        rule: "Schreib `Linear for OpenCode` oder nenne das Paket `opencode-linear`. Schreib nicht `OpenCode Linear` oder `Linear by OpenCode`.",
      },
    },
    trademarks: {
      title: "Marken",
      body: "OpenCode und das OpenCode-Logo sind Marken von Anomaly. Nutze sie nicht, um zu suggerieren, dass Anomaly dich unterstützt oder sponsert, nicht in deinem Produkt- oder Firmennamen und nicht ohne Erlaubnis auf Merchandise.",
      contact: { before: "Bei Fragen schreib an " },
    },
  },
  press: {
    title: "OpenCode | Pressekit mit Fakten zum Unternehmen und Marken-Assets",
    description:
      "Das Pressekit bietet Fakten zu OpenCode und Anomaly, dem Unternehmen dahinter, dazu Logos und Wortmarken zum Download und einen Kontakt für Presseanfragen.",
    hero: { title: "Presse", body: "Fakten, Marken-Assets und Kontakte für Berichte über OpenCode und Anomaly." },
    company: {
      title: "Über Anomaly",
      lead: "Anomaly ist das Unternehmen hinter OpenCode. Es baut Open-Source-Tools für Entwickler.",
      more: "Weitere Projekte sind SST und OpenTUI, alle als Open Source auf [GitHub](github).",
      learnMore: "Mehr erfährst du auf [anoma.ly](site).",
      projects: {
        opencode: {
          body: "Der Open-Source-Coding-Agent, mit Apps für Desktop, Terminal und Mobile sowie einem SDK. MIT-lizenziert, über 220.000 GitHub-Sterne.",
        },
        sst: {
          body: "Ein Framework, um Full-Stack-Apps auf deiner eigenen Infrastruktur zu bauen. MIT-lizenziert, offen seit 2020, mit über 26.000 GitHub-Sternen.",
        },
        opentui: {
          name: "OpenTUI",
          body: "Eine Bibliothek für Terminal-UIs in TypeScript, React oder Solid, mit einem Kern in Zig. OpenCode nutzt sie in Produktion. Über 13.000 GitHub-Sterne.",
        },
        "models-dev": {
          body: "Eine Open-Source-Datenbank mit Spezifikationen, Preisen und Fähigkeiten von KI-Modellen und einer öffentlichen API. Sie listet über 8.900 Modelle von über 200 Anbietern.",
        },
        hex: {
          body: "Diktieren auf Mac, Windows und Linux. Hex wandelt Sprache direkt auf deinem Gerät in Text um und fügt ihn in jede App ein. Die Audiodaten bleiben auf deinem Gerät.",
        },
        opentunnel: {
          body: "Eine CLI und ein SDK für öffentliche HTTPS-URLs für Apps auf deinem Rechner. TLS endet auf deinem Rechner. Das Relay sieht keinen Klartext.",
        },
      },
    },
    about: {
      title: "Über OpenCode",
      body: "Beschreibungen von OpenCode und seinen Produkten in langer und kurzer Fassung, bereit zum Kopieren.",
      boilerplate: {
        long: "OpenCode ist ein Open-Source-Coding-Agent. Es gibt ihn als Desktop-App, Terminal-UI, Mobile-App und SDK, und er funktioniert mit Modellen jedes Anbieters, darunter Claude, GPT und Gemini. OpenCode ist MIT-lizenziert und wird von Anomaly entwickelt. Es hat über 220.000 GitHub-Sterne und mehr als 1.000 Mitwirkende, und über 22 Millionen Entwickler nutzen es jeden Monat.",
        short:
          "OpenCode ist ein Open-Source-Coding-Agent von Anomaly, mit Apps für Desktop, Terminal und Mobile sowie einem SDK.",
      },
      products: {
        "opencode-console": {
          name: "OpenCode Console",
          long: "OpenCode Console ist die Web-App, in der Entwickler und Teams Zugang zu KI-Modellen für OpenCode und andere Coding-Agenten kaufen und verwalten. Sie bietet Abos für OpenCode Go und nutzungsbasierte Inference für Frontier- und Open-Weight-Modelle. Die Kosten werden pro Anfrage vom vorausbezahlten Guthaben abgezogen. Teams erhalten Workspaces mit den Rollen Member, Admin und Owner, Ausgabenlimits pro Workspace und Nutzer, Single Sign-on mit Okta, Microsoft Entra ID oder Google Workspace sowie SCIM. Console unterstützt über 30 Anbieter. Teams können ihre vorhandenen Anbieterkonten verbinden und müssen die Inference der Console nicht nutzen. Die App findest du unter opencode.ai/console.",
          short:
            "OpenCode Console ist die Web-App von Anomaly für nutzungsbasierten Zugang zu KI-Modellen, Abos für OpenCode Go und Team-Funktionen wie Budgets und Single Sign-on.",
        },
        "opencode-go": {
          long: "OpenCode Go ist ein Abo für Entwickler, die Coding-Modelle zum festen Monatspreis nutzen wollen. Go kostet 10 $ im Monat, Go Plus mit höheren Limits 40 $ und Go Teams 20 $ pro Mitglied und Monat. Jeder Tarif enthält ausgewählte Modelle, die für Coding-Agenten getestet wurden. Die Nutzungslimits sind monatliche Dollarbeträge pro Modell. In rollierenden Zeitfenstern stehen 20 % des Monatslimits pro 5 Stunden und 50 % pro Woche zur Verfügung. Abonnenten können Guthaben aufladen, bei Bedarf nach Nutzung aus dem Guthaben zahlen und jederzeit kündigen. Go funktioniert mit OpenCode und anderen Agenten. Mehr unter opencode.ai/console/go.",
          short:
            "OpenCode Go ist ein Abo von Anomaly mit monatlichen Nutzungslimits für ausgewählte Coding-Modelle, ab 10 $ im Monat.",
        },
        "opencode-data": {
          name: "OpenCode Data",
          long: "OpenCode Data ist ein öffentliches Dashboard, das zeigt, welche KI-Modelle Entwickler in OpenCode nutzen und wie sich diese Verteilung über die Zeit verändert. Es veröffentlicht eine Rangliste der Top-Modelle, Token-Nutzung, Kosten pro Session und Token, Cache-Quoten, Marktanteile und eine Aufschlüsselung nach Ländern. Die Zahlen werden stündlich aggregiert, Tage und Wochen in UTC. Nutzer- und Session-Zahlen sind Näherungswerte, und Kosten basieren auf Listenpreisen aus dem OpenCode-Modellkatalog. Journalisten können es als OpenCode Data (opencode.ai/data) mit dem auf der Seite angezeigten Aktualisierungszeitpunkt zitieren.",
          short:
            "OpenCode Data ist ein öffentliches Dashboard unter opencode.ai/data. Es zeigt eine Rangliste der KI-Modelle nach tatsächlicher Nutzung in OpenCode. Zahlen zu Tokens, Kosten und Marktanteilen werden stündlich aktualisiert.",
        },
      },
    },
    facts: {
      title: "Auf einen Blick",
      items: {
        license: { label: "Lizenz" },
        "first-release": { label: "Erstes Release" },
        "made-by": { label: "Von" },
      },
    },
    milestones: {
      title: "Meilensteine",
      items: {
        "first-release-v0-0-1": { date: "Apr. 2025", text: "Erstes Release, v0.0.1" },
        "1-million-downloads": { date: "Okt. 2025", text: "Über 1 Million Downloads" },
        "opencode-1-0": { date: "Okt. 2025", text: "OpenCode 1.0" },
        "desktop-app-ships": { date: "Dez. 2025", text: "Desktop-App erscheint" },
        "10-million-downloads": { date: "Jan. 2026", text: "Über 10 Millionen Downloads" },
        "opencode-2-0": { date: "Sep. 2026", text: "OpenCode 2.0" },
        "220-000-github-stars": { date: "Nov. 2026", text: "Über 220.000 GitHub-Sterne" },
      },
    },
    news: {
      title: "Neueste Releases",
      intro: "OpenCode erhält regelmäßig Updates. Hier findest du die neuesten Releases mit neuen Funktionen.",
      changelog: { text: "Vollständiger Changelog" },
      feed: { text: "RSS-Feed" },
    },
    media: {
      title: "Medien",
      intro:
        "Standbilder und kurze Videos jeder App, aufgenommen im echten Produkt. Du kannst sie für Berichte über OpenCode verwenden.",
      note: "Alle Aufnahmen zeigen das dunkle Theme. Standbilder und Poster sind JPGs bis 1920 × 1080 oder 1080 × 1350 im Hochformat. Videos sind MP4-Clips ohne Ton.",
      products: {
        desktop: {
          name: "Desktop",
          items: {
            "locked-landscape": { title: "Desktop-Film" },
            "frame-1": { title: "Desktop-Standbild 1" },
            "frame-2": { title: "Desktop-Standbild 2" },
            "frame-3": { title: "Desktop-Standbild 3" },
            "frame-4": { title: "Desktop-Standbild 4" },
            "feature-1": { title: "Agenten parallel ausführen" },
            "feature-2": { title: "Im Browser ansehen" },
            "feature-3": { title: "Auf jedem Gerät" },
            "locked-portrait": { title: "Desktop-Film, Hochformat" },
          },
        },
        mobile: {
          name: "Mobile",
          items: {
            "locked-landscape": { title: "Mobile-Film" },
            "frame-1": { title: "Mobile-Standbild 1" },
            "frame-2": { title: "Mobile-Standbild 2" },
            "frame-3": { title: "Mobile-Standbild 3" },
            "feature-1": { title: "Sprache" },
            "feature-2": { title: "Sessions" },
            "feature-3": { title: "Ergebnisse" },
            "locked-portrait": { title: "Mobile-Film, Hochformat" },
          },
        },
        terminal: {
          name: "Terminal",
          items: {
            "locked-landscape": { title: "Terminal-Film" },
            "frame-1": { title: "Terminal-Standbild 1" },
            "frame-2": { title: "Terminal-Standbild 2" },
            "frame-3": { title: "Terminal-Standbild 3" },
            "frame-4": { title: "Terminal-Standbild 4" },
            "feature-1": { title: "In einfachen Worten" },
            "feature-2": { title: "Du gibst Befehle frei" },
            "feature-3": { title: "Dein Terminal, dein Stil" },
            "locked-portrait": { title: "Terminal-Film, Hochformat" },
          },
        },
        sdk: {
          items: {
            "locked-landscape": { title: "SDK-Film" },
            "frame-1": { title: "SDK-Standbild 1" },
            "frame-2": { title: "SDK-Standbild 2" },
            "frame-3": { title: "SDK-Standbild 3" },
            "frame-4": { title: "SDK-Standbild 4" },
            "feature-1": { title: "CI per Code reparieren" },
            "feature-2": { title: "Jeden Schritt verfolgen" },
            "feature-3": { title: "Eigene Tools bauen" },
            "locked-portrait": { title: "SDK-Film, Hochformat" },
          },
        },
      },
    },
    people: { title: "Personen" },
    anomalyLogo: {
      title: "Anomaly-Logo",
      body: "Das Anomaly-Zeichen und die Wortmarke, in Schwarz und Weiß. PNGs sind 2048 px breit.",
      assets: {
        "mark-black": { name: "Zeichen, schwarz" },
        "mark-white": { name: "Zeichen, weiß" },
        "wordmark-black": { name: "Wortmarke, schwarz" },
        "wordmark-white": { name: "Wortmarke, weiß" },
      },
      avatars: {
        body: "Quadratische Avatare für X, GitHub, Slack, LinkedIn und andere Profile. Das Zeichen sitzt gut innerhalb des Kreises, so übersteht es einen runden Zuschnitt. PNGs sind 1024 und 400 px breit.",
        items: {
          "avatar-dark": { name: "Avatar, dunkel" },
          "avatar-light": { name: "Avatar, hell" },
        },
      },
      all: { text: "Alle laden" },
    },
    coverage: { title: "Presseecho" },
    brand: {
      title: "Marke",
      before:
        "Lade die OpenCode-Logos und -Wortmarken in einer ZIP-Datei herunter. Einzelne Dateien, Varianten und Regeln zur Verwendung findest du auf der ",
      link: { text: "Markenseite" },
      usage:
        "Du kannst diese Dateien für Berichte über OpenCode verwenden. Ändere sie nicht und erwecke nicht den Eindruck, dass OpenCode deine Arbeit unterstützt.",
    },
    product: {
      title: "Produkt",
      items: {
        desktop: {
          name: "Desktop",
          body: "Lass auf macOS, Windows und Linux mehrere Agenten parallel laufen, jeden in einem eigenen Tab. Prüfe jede Änderung als Diff und sieh dir die Vorschau an.",
        },
        mobile: {
          name: "Mobile",
          body: "Die neueste OpenCode-App. Ruf eine Session an und sprich mit dem Agenten. Seine Änderungen kannst du überall auf dem Handy prüfen und freigeben.",
        },
        terminal: {
          name: "Terminal",
          body: "Ein Terminal-UI für jede Shell, jeden Editor und jeden Remote-Server. Sieh jede Änderung als Diff und lege fest, welche Befehle von selbst laufen.",
        },
        sdk: {
          body: "Ein typisierter TypeScript-Client für Skripte, CI-Jobs und eigene Tools. Erstelle Sessions, sende Prompts und streame jedes Event in Echtzeit.",
        },
      },
    },
    contact: {
      title: "Kontakt",
      items: {
        press: { title: "Presse", body: "Für Journalisten und Analysten. Wir antworten nur auf Medienanfragen." },
        support: {
          title: "Support",
          body: "Wenn du Hilfe mit OpenCode brauchst, erstell ein Issue oder frag die Community. Bei Fragen zu Konto und Abrechnung schreib uns eine E-Mail.",
          links: { "github-issues": { text: "GitHub-Issues" }, "help-anoma-ly": { text: "help@anoma.ly" } },
        },
        security: {
          title: "Sicherheit",
          body: "Melde eine Schwachstelle über GitHub. Wenn innerhalb von 6 Werktagen niemand antwortet, schreib uns eine E-Mail.",
          links: {
            "report-a-vulnerability": { text: "Schwachstelle melden" },
            "security-anoma-ly": { text: "security@anoma.ly" },
          },
        },
      },
    },
  },
  download: {
    desktop: { title: "Desktop" },
    mobile: { title: "Mobile", stores: { "google-play": { label: "Google Play" } } },
    terminal: { title: "Terminal", installs: { curl: { name: "Skript" } } },
    extensions: {
      title: "Erweiterungen",
      items: {
        cursor: { label: "Cursor" },
        zed: { label: "Zed" },
        windsurf: { label: "Windsurf" },
        vscodium: { label: "VSCodium" },
      },
    },
  },
  productDownloads: {
    terminal: { commands: { curl: { name: "Skript" } } },
    sdk: { more: { label: "SDK-Doku lesen" } },
    mini: {
      commands: { curl: { name: "Skript" } },
      lead: "Mini ist Teil der OpenCode CLI. Installiere sie auf einem dieser Wege und führe dann opencode mini aus.",
    },
  },
  pair: {
    title: "Smartphone verbinden",
    cardTitle: "Verbinde dein Smartphone mit einem Befehl",
    intro:
      "Mit OpenCode Mobile steuerst du OpenCode auf deinem Rechner aus der Ferne. Deine Sessions laufen dort weiter. In der App siehst und steuerst du sie.",
    steps: {
      "get-the-app": {
        title: "App holen",
        body: "Installier OpenCode aus dem App Store auf deinem iPhone oder über Google Play auf deinem Android-Handy.",
      },
      "run-this-on-your-computer": {
        title: "Auf dem Computer ausführen",
        body: "Der Befehl gibt einen Link und einen QR-Code aus. Beide sind nur einmal nutzbar und laufen nach 5 Minuten ab.",
      },
      "scan-the-code": {
        title: "Code scannen",
        body: "Scann den QR-Code mit der App oder füg den Link ein. Die letzten Sessions von deinem Rechner öffnen sich auf dem Handy.",
      },
    },
    note: "--remote verbindet über eine OpenTunnel-Adresse und funktioniert so aus jedem Netzwerk. Im selben WLAN führst du einmal opencode service set hostname 0.0.0.0 aus und dann opencode pair.",
    facts: [
      "Die Kopplung funktioniert aus jedem Netzwerk, denn --remote verbindet über eine OpenTunnel-Adresse.",
      "Link und Code funktionieren einmal und laufen nach 5 Minuten ab.",
      "Lass den Computer an, denn der Agent läuft dort und nicht auf dem Smartphone.",
      "Im selben WLAN führst du einmal opencode service set hostname 0.0.0.0 aus und dann opencode pair.",
    ],
  },
  announcements: {
    "create-install-and-share-desktop-plugins": {
      text: "Erstelle, installiere und teile Desktop-Plugins.",
      link: "Neu in 2.2 ansehen",
    },
    "desktop-terminals-now-survive-restarts": {
      text: "Desktop-Terminals überstehen jetzt Neustarts.",
      link: "v2.2.4 ansehen",
    },
    "agents-can-now-generate-images": { text: "Agenten können jetzt Bilder erzeugen.", link: "v2.2.1 ansehen" },
    "steer-your-sessions-from-your-phone": {
      text: "Steuere deine Sessions vom Smartphone aus.",
      link: "OpenCode Mobile entdecken",
    },
    "a-refreshed-desktop-app": { text: "Eine überarbeitete Desktop-App.", link: "Neu in 2.2 ansehen" },
  },
} satisfies ContentOverlay
