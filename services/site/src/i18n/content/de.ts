import type { ContentOverlay } from "./source"

export const content = {
  products: {
    desktop: {
      name: "Desktop",
      body: "Sessions, Tabs, Diffs, integrierter Browser und Extensions auf macOS, Windows und Linux.",
      action: "Download",
    },
    mobile: {
      name: "Mobile",
      body: "Starte, steuere und genehmige Sessions vom Smartphone aus, wo immer du bist.",
      action: "Download",
    },
    terminal: {
      name: "Terminal",
      body: "Ein schnelles Terminal-UI für jede Shell, jeden Editor und jeden Remote-Server.",
      action: "Installieren",
    },
    sdk: { body: "Steuere OpenCode aus deinen eigenen Skripten, CI-Jobs und Tools.", action: "Doku lesen" },
    mini: {
      body: "Ein minimales Terminal-Interface. Antworten landen in deinem Scrollback, darunter steht ein Prompt.",
      action: "Installieren",
    },
  },
  productDetails: {
    desktop: {
      title: "OpenCode | Desktop-App für macOS, Windows und Linux",
      description:
        "Lass so viele OpenCode-Agents parallel laufen, wie du willst, sieh jede Änderung im Browser daneben und mach auf jedem Gerät weiter. Für macOS, Windows und Linux.",
      intro:
        "Lass mehrere Agents gleichzeitig laufen, jede Session in einem eigenen Tab. Prüfe jede Änderung als Diff, kommentiere jede Zeile und kontrolliere das Ergebnis im integrierten Browser. Für macOS, Windows und Linux.",
      showcase: {
        "parallel-agents": {
          title: "Parallele Agents",
          body: "Starte so viele Agents, wie du willst, und lass sie alle parallel arbeiten. Wechsle zwischen ihnen, sobald sie fertig sind.",
        },
        "see-it-in-the-browser": {
          title: "Im Browser ansehen",
          body: "Deine App öffnet sich in einem Browser neben dem Agent, so seht ihr beide jede Änderung, sobald sie landet.",
        },
        "on-every-device": {
          title: "Auf jedem Gerät",
          body: "Starte Agents auf all deinen Geräten und mach in der Desktop-App, im Terminal oder auf dem Smartphone weiter.",
        },
        "extend-it": {
          title: "Erweitern",
          body: "Verbinde deine Tools und Dienste, damit der Agent mit allem arbeiten kann. Oder lass OpenCode Plugins für sich selbst bauen, mit eigener Oberfläche in der Seitenleiste.",
        },
      },
    },
    mobile: {
      title: "OpenCode | Mobile, deine Coding-Sessions auf dem Smartphone",
      description:
        "Starte und steuere OpenCode-Sessions vom Smartphone aus. Sprich mit dem Agent, während er auf deinem Computer läuft.",
      intro:
        "Starte und steuere Sessions vom Smartphone aus, wo immer du bist. Ruf eine Session an und sprich mit dem Agent, oder öffne eine Session und mach dort weiter, wo du aufgehört hast, alles mit OpenCode auf deinem eigenen Computer.",
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
        voice: { title: "Stimme", body: "Ruf eine Session an und sag, was du brauchst. Der Agent antwortet laut." },
        sessions: {
          title: "Sessions",
          body: "Öffne eine Session, um ihren Stand zu sehen, und mach dort weiter, wo du aufgehört hast.",
        },
        steer: {
          title: "Steuern",
          body: "Schick eine Folgenachricht, um mitten in der Session die Richtung zu ändern.",
        },
        results: { title: "Ergebnisse", body: "Ist die Arbeit erledigt, sagt dir der Anruf, was sich geändert hat." },
      },
    },
    terminal: {
      title: "OpenCode | Terminal-UI für den Open-Source-Coding-Agent",
      description:
        "Ein schnelles Terminal-UI für OpenCode, das in jeder Shell, jedem Editor und auf jedem Remote-Server läuft. Beschreibe, was du willst, sieh jede Änderung als Diff und genehmige Befehle.",
      intro:
        "Ein schnelles Terminal-UI für jede Shell, jeden Editor und jeden Remote-Server. Beschreibe in einfachen Worten, was du willst, sieh jede Änderung als Diff entstehen und lege fest, welche Befehle von selbst laufen.",
      features: {
        "any-terminal": {
          title: "Jedes Terminal",
          body: "Läuft in jeder Shell, im Terminal deines Editors oder auf einem Remote-Server.",
        },
        "diffs-in-the-timeline": {
          title: "Diffs in der Timeline",
          body: "Sieh jede Änderung als Diff in der Timeline, während der Agent sie macht.",
        },
        "pick-up-later": {
          title: "Weitermachen",
          body: "Setze die letzte Session mit -c fort, oder eine beliebige mit -s.",
        },
        "one-off-runs": {
          title: "Einzelne Läufe",
          body: "opencode run sendet eine Nachricht und gibt die Antwort aus.",
        },
        "agents-and-commands": {
          title: "Agents und Befehle",
          body: "Wechsle Agents mit shift+tab und öffne alle Befehle mit ctrl+p.",
        },
        "auto-approve": {
          title: "Auto-Freigabe",
          body: "Mit --auto erlaubst du jede Aktion, die du nicht abgelehnt hast.",
        },
        "any-server": { title: "Jeder Server", body: "Verbinde dich mit --server per URL mit einem OpenCode-Server." },
        "usage-stats": { title: "Statistiken", body: "opencode stats zeigt teilbare Nutzungsstatistiken." },
      },
      showcase: {
        "ask-in-plain-words": {
          title: "In einfachen Worten",
          body: "Schreib, was du willst. Der Agent zeigt beim Arbeiten seinen Plan.",
        },
        "approve-what-runs": {
          title: "Freigeben, was läuft",
          body: "Änderungen erscheinen als Diffs, und Befehle warten auf deine Erlaubnis.",
        },
        "make-it-yours": {
          title: "Mach es zu deinem",
          body: "Wechsle Themes mit einem Tastendruck, vom Standard bis zu tokyonight und mehr.",
        },
        mini: { title: "Mini", body: "Mit opencode mini landen Antworten in deinem eigenen Scrollback." },
      },
    },
    sdk: {
      title: "OpenCode | TypeScript-SDK für Skripte, CI-Jobs und Tools",
      description:
        "Steuere OpenCode aus deinen eigenen Skripten, CI-Jobs und Tools. Der typisierte TypeScript-Client erstellt Sessions, sendet Prompts und streamt jedes Event in Echtzeit.",
      intro:
        "Steuere OpenCode aus deinen eigenen Skripten, CI-Jobs und Tools. Das SDK führt OpenCode in deinem Prozess aus, mit deiner Konfiguration und deinen Modellen, und sein typisierter Client erstellt Sessions, sendet Prompts und streamt jedes Event.",
      features: {
        "typescript-client": {
          title: "TypeScript-Client",
          body: "Typisierte Requests und Events, mit denselben Werten wie @opencode/client.",
        },
        "sessions-from-code": {
          title: "Sessions aus Code",
          body: "Erstelle Sessions und sende Prompts aus jedem Skript.",
        },
        "any-model": { title: "Jedes Modell", body: "Nutzt die Modelle, die dein OpenCode-Setup hat." },
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
          body: "Ein Skript lässt OpenCode kaputte Tests reparieren und führt sie neu aus.",
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
          body: "OpenCode läuft in deinem Prozess, mit deiner Config und deinen Modellen.",
        },
      },
    },
    mini: {
      title: "OpenCode | Mini, ein minimales Terminal-Interface für den Agent",
      description:
        "Mini führt OpenCode in einem minimalen Terminal-Interface aus. Antworten landen im Scrollback deines Terminals, und nur ein Prompt und eine Statuszeile bleiben unten.",
      intro:
        "Ein minimales Terminal-Interface für OpenCode. Führe opencode mini aus, und Antworten landen direkt im Scrollback deines Terminals. Du scrollst, suchst und kopierst sie wie jede andere Ausgabe. Nur der Prompt und eine Statuszeile bleiben unten.",
      features: {
        "your-scrollback": { title: "Dein Scrollback", body: "Antworten werden zu normalem Terminal-Verlauf." },
        "one-prompt": { title: "Ein Prompt", body: "Agent, Modell, Kontext und Kosten in einer Statuszeile." },
        permissions: { title: "Berechtigungen", body: "Erlaube Änderungen und Befehle direkt im Prompt-Bereich." },
        "how-much-shows": {
          title: "Wie viel du siehst",
          body: "Ruhig, Standard oder alles, für Denkprozess und Tool-Ausgabe.",
        },
        "pick-up-later": {
          title: "Weitermachen",
          body: "Setze die letzte Session mit -c fort, oder eine beliebige mit -s.",
        },
        "same-opencode": {
          title: "Dasselbe OpenCode",
          body: "Derselbe Server, dieselben Agents und Modelle wie die anderen Apps.",
        },
        agents: { title: "Agents", body: "Wechsle Agents direkt im Prompt." },
        compact: { title: "Kompakt", body: "Verkürze eine lange Session mit /compact." },
      },
    },
  },
  extensionCard: {
    name: "Extensions",
    body: "Nutze OpenCode in VS Code, oder über ACP in Zed und anderen Editoren.",
    action: "Installieren",
  },
  extensions: {
    browse: {
      body: "Lass Agents deinen echten Browser nutzen.",
      title: "OpenCode | Browse, dein echter Browser für Coding-Agents",
      description:
        "Mit Browse nutzen OpenCode und andere MCP-Clients deinen echten Browser. Agents steuern Tabs im Hintergrund mit Playwright und geben Logins und 2FA an dich zurück.",
      intro:
        "Ein MCP-Server und eine Chromium-Extension, mit denen deine Agents deinen echten Browser nutzen, mit deinen Tabs, Logins und Extensions. Sie öffnen und steuern Tabs mit Playwright, machen Screenshots und Bildschirmaufnahmen, in Hintergrund-Tabs, die gruppiert und dir aus dem Weg sind. Bist du dran, etwa für einen Login, eine 2FA-Abfrage oder eine Zahlung, geben sie dir den Tab zurück und machen weiter, sobald du auf Continue klickst.",
      features: {
        "your-real-browser": {
          title: "Dein echter Browser",
          body: "Chrome, Edge, Brave, Arc, Helium, Vivaldi, Opera und Chromium.",
        },
        "out-of-your-way": {
          title: "Aus dem Weg",
          body: "Agent-Tabs öffnen sich im Hintergrund, in eingeklappten Gruppen.",
        },
        handoffs: { title: "Übergaben", body: "Erledige Login oder 2FA selbst und klick dann auf Continue." },
        "lend-a-tab": {
          title: "Tab ausleihen",
          body: "Klick auf den Toolbar-Button, um einem Agent einen offenen Tab zu geben.",
        },
        "record-and-capture": {
          title: "Aufnehmen",
          body: "Screenshots, Bildschirmaufnahmen und Netzwerkverkehr als HAR.",
        },
        "any-mcp-client": {
          title: "Jeder MCP-Client",
          body: "OpenCode, Claude Code, Cursor, Codex, Zed und viele mehr.",
        },
        "all-your-logins": {
          title: "Alle deine Logins",
          body: "Agents nutzen die Websites, bei denen du schon angemeldet bist. Keine Keys, kein Setup.",
        },
        allowlists: { title: "Allowlists", body: "Beschränke die Tabs einer Session auf die Websites, die du nennst." },
      },
      install:
        "Installiere zuerst die [Chrome-Extension]. Sie führt dich durch die restlichen Schritte. Um die CLI direkt zu installieren (das solltest du nicht brauchen), nimm einen dieser Befehle.",
    },
  },
  apps: {
    browse: {
      category: "Browsersteuerung für Agenten",
      body: "Lass deinen Agenten deinen echten Browser nutzen, mit deinen Logins und Tabs.",
    },
    opentunnel: { category: "Lokale Tunnel", body: "Öffentliche HTTPS-URLs für lokale Apps." },
    opentui: { category: "Bibliothek", body: "Eine Bibliothek für Terminal-Oberflächen." },
    hex: { category: "Sprachdiktat", body: "Sprachdiktat direkt auf dem Gerät, für jede App." },
  },
  getStarted: {
    title: "Loslegen",
    lead: "Am einfachsten startest du, indem du OpenCode herunterlädst und die kostenlosen Modelle nutzt. Ohne Account. Für mehr bringst du dein eigenes Abo mit oder nutzt OpenCode Go.",
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
        title: "Gratis-Modelle nutzen",
        line: "OpenCode bringt eine Reihe kostenloser Modelle mit. Ohne Account.",
      },
      "add-more-models": {
        title: "Mehr Modelle",
        line: "Bring dein eigenes Abo mit oder nutze die kuratierten Modelle von OpenCode Go ab $10/Monat.",
      },
    },
    sentence:
      "Lade OpenCode herunter, starte mit kostenlosen Modellen und bring dein eigenes Abo oder OpenCode Go mit, wenn du mehr willst.",
  },
  byos: {
    title: "Eigenes Abo mitbringen",
    headline: "Nutze die Abos, die du schon hast.",
    line: "Melde dich mit ChatGPT Plus oder Pro oder mit GitHub Copilot an. Oder nutze ein OpenCode-Abo.",
    yours: { label: "Dein Abo", items: { "chatgpt-plus-pro": { name: "ChatGPT Plus/Pro" } } },
    planLinks: ["OpenCode-Abo"],
    ours: { label: "OpenCode-Pläne" },
  },
  brand: {
    hero: { copy: { text: "Regeln für Agents", copied: "Regeln kopiert" } },
    naming: {
      title: "Name",
      body: "Schreib OpenCode als ein Wort, mit großem O und großem C. Schreib nicht Opencode, Open Code, OpenCode AI oder Open-Code.",
      code: "Nutze das kleingeschriebene `opencode` nur in Code und Paketnamen, etwa `opencode-figma` oder `@acme/opencode-plugin`.",
    },
    families: {
      logo: {
        title: "Logo",
        body: "Das Logo allein, für App-Icons, Avatare und andere kleine Flächen. Die quadratischen Versionen haben Innenabstand für Orte, die auf ein Quadrat zuschneiden.",
        assets: {
          light: { name: "Hell" },
          dark: { name: "Dunkel" },
          "square-light": { name: "Quadratisch, hell" },
          "square-dark": { name: "Quadratisch, dunkel" },
        },
      },
      wordmark: {
        title: "Wortmarke",
        body: "Der volle Name in den OpenCode-Buchstabenformen. Nutze sie überall, wo Platz für den ausgeschriebenen Namen ist.",
        assets: { light: { name: "Hell" }, dark: { name: "Dunkel" } },
      },
      "simple-wordmark": {
        title: "Einfache Wortmarke",
        body: "Eine einfarbige Version der Wortmarke, für Druck, Stickerei und Orte, die nur eine Farbe erlauben.",
        assets: { light: { name: "Hell" }, dark: { name: "Dunkel" } },
      },
    },
    icons: {
      title: "Avatare",
      body: "Quadratische Avatare mit 1024px für Slack, Discord, GitHub und andere Profile. Der Hintergrund füllt das ganze Quadrat und das Logo sitzt gut innerhalb des Kreises, so übersteht es einen runden Zuschnitt.",
      items: { dark: { name: "Dunkel" }, light: { name: "Hell" } },
    },
    colors: {
      title: "Farben",
      body: "Logo und Wortmarke nutzen eine Farbe in drei Deckkräften, mit einer helleren Farbe für dunkle Hintergründe. Die Werte unten zeigen diese Farbe auf Weiß oder #0B0B0B, wie in den Standarddateien. Klick auf einen Wert, um ihn zu kopieren.",
      palettes: {
        light: {
          name: "Hell",
          swatches: {
            ink: { name: "Farbe", use: "Die Kontur des Logos und die Buchstaben von „code“." },
            "ink-70": { name: "Farbe 70%", use: "Die Buchstaben von „open“.", ink: "Die Farbe mit 70% Deckkraft." },
            "ink-20": {
              name: "Farbe 20%",
              use: "Die innere Schattierung des Logos.",
              ink: "Die Farbe mit 20% Deckkraft.",
            },
          },
        },
        dark: {
          name: "Dunkel",
          swatches: {
            ink: { name: "Farbe", use: "Die Kontur des Logos und die Buchstaben von „code“." },
            "ink-72": { name: "Farbe 72%", use: "Die Buchstaben von „open“.", ink: "Die Farbe mit 72% Deckkraft." },
            "ink-28": {
              name: "Farbe 28%",
              use: "Die innere Schattierung des Logos.",
              ink: "Die Farbe mit 28% Deckkraft.",
            },
          },
        },
      },
    },
    variants: {
      title: "Varianten",
      body: "Wähle die Version, mit der das Logo auf deinem Hintergrund klar bleibt, also dunkel auf hellen und hell auf dunklen Hintergründen. Logo und Wortmarke sind getrennte Dateien. Nutze das eine oder das andere.",
      groups: {
        default: {
          name: "Standard",
          body: "Das Logo für fast alle Fälle. Seine innere Schattierung ist transparent. Auf Weiß oder Schwarz sieht es genau wie die zweifarbigen Grautöne aus, und auf Fotos, Verläufen und Farben scheint der Hintergrund durch.",
          rows: {
            logo: { title: "Logo", tiles: { dark: { name: "Dunkel" }, light: { name: "Hell" } } },
            wordmark: { title: "Wortmarke", tiles: { dark: { name: "Dunkel" }, light: { name: "Hell" } } },
          },
        },
        simple: {
          name: "Einfach",
          body: "Eine Farbe, mit offenen Innenräumen und ohne innere Schattierung. Nutze sie auf flachen farbigen Hintergründen, für einfarbigen Druck und überall, wo die Grautöne nicht gehen, einfach dunkel auf hellen Farben und einfach hell auf dunklen Farben.",
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
        body: "Die Proportionen des Logos sind auf 4:5 festgelegt, und ein Strich ist ein Viertel seiner Breite. Skaliere es in Schritten von 4 × 5px, damit jede Kante und jeder Strich auf einem ganzen Pixel liegt.",
        do: "jede Kante und den 4px-Strich auf ganzen Pixeln zu halten.",
        dont: "das Logo abweichend von 4:5 zu skalieren, sonst fallen die Kanten zwischen Pixel und verschwimmen.",
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
      body: "Plugins, Anbieter und Tools, die mit OpenCode funktionieren, und Projekte, die damit gebaut sind, dürfen das sagen. Nutze ein Badge oder ein Partner-Lockup und benenne dein Projekt so, dass klar ist, dass es deins ist.",
      badges: {
        body: "Setz ein Badge in deine README, Doku oder Website und verlinke es auf opencode.ai. Wähle die helle oder dunkle Datei für deinen Hintergrund (das HTML wechselt von selbst) und ändere weder Farben noch Text.",
        sizes: "Jeder Stil kommt in 20, 32 und 44px (Shields nur in 20px), als SVG und als PNG in 2×.",
        mono: "Jede Datei gibt es auch mit Text in OpenTUI Mono. Füge -mono vor der Endung ein, wie in opencode-works-with-a-light-20-mono.svg, oder -mono-caps für OpenTUI Mono in Großbuchstaben.",
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
      "Das Pressekit von OpenCode, mit Fakten zu OpenCode und Anomaly, dem Unternehmen dahinter, dazu Logos und Wortmarken zum Download und ein Kontakt für Presseanfragen.",
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
          body: "Sprachdiktat für Mac, Windows und Linux. Hex transkribiert auf deinem Gerät und fügt in jede App ein, so verlässt das Audio nie dein Gerät.",
        },
        opentunnel: {
          body: "Eine CLI und ein SDK, die Apps auf deinem Rechner eine öffentliche HTTPS-URL geben. TLS endet auf deinem Rechner, so sieht das Relay nie Klartext.",
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
          long: "OpenCode Console ist die Web-App, in der Entwickler und Teams Zugang zu KI-Modellen für OpenCode und andere Coding-Agents kaufen und verwalten. Sie bietet Pay-as-you-go-Inferenz für Frontier- und Open-Weight-Modelle, abgerechnet pro Request aus vorausbezahltem Guthaben, sowie Abos für OpenCode Go. Teams bekommen Workspaces mit den Rollen Member, Admin und Owner, Ausgabenlimits für Workspace und einzelne Nutzer, Single Sign-on mit Okta, Microsoft Entra ID oder Google Workspace sowie SCIM. Console unterstützt mehr als 30 Anbieter, sodass Teams vorhandene Anbieter-Accounts verbinden können, und die eigene Inferenz ist optional. Sie ist unter opencode.ai/console erreichbar.",
          short:
            "OpenCode Console ist die Web-App von Anomaly für Pay-as-you-go-Zugang zu KI-Modellen, Abos für OpenCode Go und Team-Kontrollen wie Budgets und Single Sign-on.",
        },
        "opencode-go": {
          long: "OpenCode Go ist ein Abo für Entwickler, die einen festen Monatspreis für Coding-Modelle wollen. Go kostet $10/Monat, Go Plus kostet $40/Monat mit höheren Limits, und Go Teams kostet $20/Monat pro Mitglied. Jeder Plan enthält eine kuratierte Auswahl an Modellen, die für agentisches Coding getestet sind. Die Nutzungslimits sind monatliche Dollarbeträge pro Modell, mit rollierenden 5-Stunden- und Wochenkontingenten von 20% und 50% des Monatslimits. Abonnenten können Guthaben aufladen, auf ein Pay-as-you-go-Guthaben ausweichen und jederzeit kündigen. Go funktioniert mit OpenCode und anderen Agents. Es ist unter opencode.ai/console/go erreichbar.",
          short:
            "OpenCode Go ist ein Monatsabo von Anomaly, das Entwicklern monatliche Nutzungslimits für eine kuratierte Auswahl an Coding-Modellen gibt, ab $10/Monat.",
        },
        "opencode-data": {
          name: "OpenCode Data",
          long: "OpenCode Data ist ein öffentliches Dashboard, das zeigt, welche KI-Modelle Entwickler in OpenCode nutzen und wie sich diese Verteilung über die Zeit verändert. Es veröffentlicht eine Rangliste der Top-Modelle, Token-Nutzung, Kosten pro Session und Token, Cache-Quoten, Marktanteile und eine Aufschlüsselung nach Ländern. Die Zahlen werden stündlich aggregiert, Tage und Wochen in UTC. Nutzer- und Session-Zahlen sind Näherungswerte, und Kosten basieren auf Listenpreisen aus dem OpenCode-Modellkatalog. Journalisten können es als OpenCode Data (opencode.ai/data) mit dem auf der Seite angezeigten Aktualisierungszeitpunkt zitieren.",
          short:
            "OpenCode Data ist ein öffentliches Dashboard unter opencode.ai/data, das KI-Modelle nach echter Nutzung in OpenCode einordnet, mit Tokens, Kosten und Marktanteilen, stündlich aktualisiert.",
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
      intro: "OpenCode erscheint oft. Das sind die neuesten Releases mit neuen Funktionen.",
      changelog: { text: "Ganzer Changelog" },
      feed: { text: "RSS-Feed" },
    },
    media: {
      title: "Medien",
      intro:
        "Standbilder und kurze Videos jeder App, aufgenommen im echten Produkt. Du kannst sie für Berichte über OpenCode verwenden.",
      note: "Alle Aufnahmen nutzen das dunkle Design. Standbilder und Poster sind JPGs bis 1920 × 1080, oder 1080 × 1350 im Hochformat. Videos sind MP4-Clips ohne Ton.",
      products: {
        desktop: {
          name: "Desktop",
          items: {
            "locked-landscape": { title: "Desktop-Film" },
            "frame-1": { title: "Desktop-Standbild 1" },
            "frame-2": { title: "Desktop-Standbild 2" },
            "frame-3": { title: "Desktop-Standbild 3" },
            "frame-4": { title: "Desktop-Standbild 4" },
            "feature-1": { title: "Sessions in Tabs" },
            "feature-2": { title: "Prüfen und kommentieren" },
            "feature-3": { title: "Im Browser ansehen" },
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
            "feature-1": { title: "Stimme" },
            "feature-2": { title: "Freigaben" },
            "feature-3": { title: "Sessions" },
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
            "feature-2": { title: "Freigeben, was läuft" },
            "feature-3": { title: "Mach es zu deinem" },
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
          body: "Lass mehrere Agents gleichzeitig laufen, jeden in einem eigenen Tab, auf macOS, Windows und Linux. Prüfe jede Änderung als Diff und sieh sie dir an.",
        },
        mobile: {
          name: "Mobile",
          body: "Die neueste OpenCode-App. Ruf eine Session an, um mit dem Agent zu sprechen, und prüfe und genehmige seine Änderungen von überall auf dem Smartphone.",
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
          body: "Für Hilfe mit OpenCode eröffne ein Issue oder frag die Community. Bei Fragen zu Account und Abrechnung schreib uns eine E-Mail.",
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
      title: "Extensions",
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
    cardTitle: "Koppel dein Smartphone mit einem Befehl",
    intro:
      "OpenCode Mobile ist eine Fernbedienung für OpenCode auf deinem Computer. Deine Sessions laufen dort weiter, und die App zeigt sie dir und lässt dich sie steuern.",
    steps: {
      "get-the-app": {
        title: "App holen",
        body: "Installiere die OpenCode-Beta über TestFlight auf deinem iPhone. Die Android-App folgt bald.",
      },
      "run-this-on-your-computer": {
        title: "Auf dem Computer ausführen",
        body: "Der Befehl gibt einen Einmal-Link und einen QR-Code aus. Beide funktionieren einmal und laufen nach 5 Minuten ab.",
      },
      "scan-the-code": {
        title: "Code scannen",
        body: "Scanne den QR-Code mit der App oder füge den Link ein. Die letzten Sessions deines Computers öffnen sich auf dem Smartphone.",
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
    "agents-can-now-generate-images": { text: "Agents können jetzt Bilder erzeugen.", link: "v2.2.1 ansehen" },
    "steer-your-sessions-from-your-phone": {
      text: "Steuere deine Sessions vom Smartphone aus.",
      link: "OpenCode Mobile entdecken",
    },
    "a-refreshed-desktop-app": { text: "Eine überarbeitete Desktop-App.", link: "Neu in 2.2 ansehen" },
  },
} satisfies ContentOverlay
