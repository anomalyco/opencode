import type { ContentOverlay } from "./source"

export const content = {
  products: {
    desktop: {
      name: "Desktop",
      body: "Sessioner, faner, diffs, indbygget browser og udvidelser på macOS, Windows og Linux.",
      action: "Download",
    },
    mobile: {
      name: "Mobile",
      body: "Start, styr og godkend sessioner fra din telefon, uanset hvor du er.",
      action: "Download",
    },
    terminal: {
      name: "Terminal",
      body: "En hurtig terminalbrugerflade, der virker i enhver shell, editor eller fjernserver.",
      action: "Installer",
    },
    sdk: { body: "Styr OpenCode fra dine egne scripts, CI-jobs og værktøjer.", action: "Læs docs" },
    ide: {
      name: "IDE-udvidelser",
      body: "Åbn OpenCode i VS Code, Cursor og Windsurf, eller i Zed og JetBrains-IDE'er via ACP.",
      action: "Installer",
    },
    mini: {
      body: "En minimal terminalbrugerflade. Svarene skrives ind i din scrollback med én prompt nedenunder.",
      action: "Installer",
    },
  },
  productDetails: {
    desktop: {
      title: "OpenCode | Desktopapp til macOS, Windows og Linux",
      description:
        "Kør så mange OpenCode-agenter parallelt, som du vil, se hver ændring i en browser ved siden af, og fortsæt på enhver enhed. Til macOS, Windows og Linux.",
      intro:
        "Kør flere agenter på én gang, hver session i sin egen fane. Gennemgå hver ændring som et diff, kommenter enhver linje, og tjek resultatet i den indbyggede browser. Til macOS, Windows og Linux.",
      showcase: {
        "parallel-agents": {
          title: "Parallelle agenter",
          body: "Start så mange agenter, du vil, og lad dem alle arbejde parallelt. Skift mellem dem, efterhånden som de bliver færdige.",
        },
        "see-it-in-the-browser": {
          title: "Se det i browseren",
          body: "Din app åbner i en browser ved siden af agenten, så I begge ser hver ændring lande.",
        },
        "on-every-device": {
          title: "På alle enheder",
          body: "Start agenter på alle dine enheder, og fortsæt i desktop-appen, terminalen eller på din telefon.",
        },
        "extend-it": {
          title: "Udvid den",
          body: "Forbind dine værktøjer og tjenester, så agenten kan arbejde med alt. Eller lad OpenCode bygge plugins til sig selv med deres egen brugerflade i sidepanelet.",
        },
      },
    },
    mobile: {
      title: "OpenCode | Mobile, dine kodningssessioner på telefonen",
      description:
        "Start og styr OpenCode-sessioner fra din telefon. Tal med agenten, mens den kører på din computer.",
      intro:
        "Start og styr sessioner fra din telefon, hvor du end er. Ring til en session og tal med agenten, eller åbn en session og fortsæt, hvor du slap, alt med OpenCode på din egen computer.",
      features: {
        "notify-when-done": {
          title: "Besked når færdig",
          body: "Få et kort resumé, når en session, du har startet, er færdig.",
        },
        "pair-from-anywhere": {
          title: "Par hvor som helst",
          body: "Forbind fra ethvert netværk med opencode pair --remote.",
        },
        "every-computer": { title: "Alle computere", body: "Skift mellem dine parrede computere med ét tryk." },
        "siri-and-shortcuts": {
          title: "Siri og Genveje",
          body: "Start et opkald eller en session fra Siri eller Kontrolcenter.",
        },
        "follow-along": { title: "Følg med", body: "Se tidslinjen opdatere, mens agenten arbejder." },
        "your-computer": { title: "Din computer", body: "Forbinder til OpenCode, der kører på din egen maskine." },
        "share-sheet": { title: "Delingsmenu", body: "Del hvad som helst med en session uden at åbne appen." },
        "mute-sessions": { title: "Slå lyd fra", body: "Behold en session på listen uden at få dens notifikationer." },
      },
      showcase: {
        voice: { title: "Stemme", body: "Ring til en session, og sig, hvad du har brug for. Agenten svarer højt." },
        sessions: { title: "Sessioner", body: "Åbn en session for at se, hvor den er, og fortsæt, hvor du slap." },
        steer: { title: "Styr", body: "Send en opfølgning for at skifte retning midt i sessionen." },
        results: { title: "Resultater", body: "Opkaldet fortæller dig, hvad der er ændret, når arbejdet er færdigt." },
      },
    },
    terminal: {
      title: "OpenCode | Terminal-UI til open source-kodningsagenten",
      description:
        "En hurtig terminalbrugerflade til OpenCode, der virker i enhver shell, editor eller fjernserver. Beskriv, hvad du vil, se hver ændring som et diff, og godkend kommandoer.",
      intro:
        "En hurtig terminalbrugerflade, der virker i enhver shell, editor eller fjernserver. Beskriv med almindelige ord, hvad du vil, se hver ændring lande som et diff, og vælg, hvilke kommandoer der kører af sig selv.",
      features: {
        "any-terminal": {
          title: "Enhver terminal",
          body: "Virker i enhver shell, i din editors terminal eller på en fjernserver.",
        },
        "diffs-in-the-timeline": {
          title: "Diffs i tidslinjen",
          body: "Se hver ændring som et diff i tidslinjen, mens agenten laver den.",
        },
        "pick-up-later": {
          title: "Fortsæt senere",
          body: "Fortsæt den seneste session med -c, eller en hvilken som helst med -s.",
        },
        "one-off-runs": { title: "Enkeltkørsler", body: "opencode run sender én besked og udskriver svaret." },
        "agents-and-commands": {
          title: "Agenter og kommandoer",
          body: "Skift agent med shift+tab, og åbn alle kommandoer med ctrl+p.",
        },
        "auto-approve": {
          title: "Autogodkend",
          body: "Kør med --auto for at tillade alle handlinger, du ikke har afvist.",
        },
        "any-server": { title: "Enhver server", body: "Forbind til en OpenCode-server via URL med --server." },
        "usage-stats": { title: "Forbrug", body: "opencode stats viser forbrugsstatistik, du kan dele." },
      },
      showcase: {
        "ask-in-plain-words": {
          title: "Spørg med egne ord",
          body: "Skriv, hvad du vil, så viser agenten sin plan, mens den arbejder.",
        },
        "approve-what-runs": {
          title: "Godkend det, der kører",
          body: "Ændringer vises som diffs, og kommandoer venter på din tilladelse.",
        },
        "make-it-yours": {
          title: "Gør den til din",
          body: "Skift tema med et tastetryk, fra standard til tokyonight og flere.",
        },
        mini: { title: "Mini", body: "Kør opencode mini, og svarene skrives ind i din egen scrollback." },
      },
    },
    sdk: {
      title: "OpenCode | TypeScript-SDK til scripts, CI-jobs og værktøjer",
      description:
        "Styr OpenCode fra dine egne scripts, CI-jobs og værktøjer. Den typede TypeScript-klient opretter sessioner, sender prompts og streamer alle events, mens de sker.",
      intro:
        "Styr OpenCode fra dine egne scripts, CI-jobs og værktøjer. SDK'et kører OpenCode i din egen proces med din konfiguration og dine modeller, og dets typede klient opretter sessioner, sender prompts og streamer alle events.",
      features: {
        "typescript-client": {
          title: "TypeScript-klient",
          body: "Typede requests og events med de samme værdier som @opencode/client.",
        },
        "sessions-from-code": {
          title: "Sessioner fra kode",
          body: "Opret sessioner og send prompts fra ethvert script.",
        },
        "any-model": { title: "Enhver model", body: "Bruger de modeller, din OpenCode-opsætning har." },
        "npm-or-bun": {
          title: "npm eller bun",
          body: "Installer det med npm i @opencode/sdk eller bun add @opencode/sdk.",
        },
        "in-process-host": { title: "In-process-host", body: "Kører OpenCode i hukommelsen uden netværkshop." },
        "your-plugins": {
          title: "Dine plugins",
          body: "Giv dine egne plugins med, når du opretter in-process-hosten.",
        },
        "promise-or-effect": {
          title: "Promise eller Effect",
          body: "En Promise-API og en Effect-API med de samme værdier.",
        },
        "cloudflare-workers": {
          title: "Cloudflare Workers",
          body: "Kør OpenCode i et Cloudflare Durable Object på Workers.",
        },
      },
      showcase: {
        "fix-ci-from-code": {
          title: "Ret CI fra kode",
          body: "Et kort script beder OpenCode rette fejlende tests og kører dem så igen.",
        },
        "follow-every-step": {
          title: "Følg hvert trin",
          body: "Stream events for at se hvert værktøj, agenten kalder, mens det sker.",
        },
        "build-your-own-tools": {
          title: "Byg egne værktøjer",
          body: "Kobl OpenCode på bots, dashboards og workflows med få linjer.",
        },
        "in-your-process": {
          title: "I din proces",
          body: "Kører OpenCode i din proces med din konfiguration og dine modeller.",
        },
      },
    },
    ide: {
      title: "OpenCode | Editorintegrationer til VS Code, Cursor og Zed",
      description:
        "Brug OpenCode i din editor med udvidelsen til VS Code, Cursor, Windsurf og VSCodium, og med opencode acp til Zed, JetBrains-IDE'er og andre ACP-editorer.",
      intro:
        "Brug OpenCode i din editor. I VS Code, Cursor, Windsurf og VSCodium kører du opencode i den indbyggede terminal, og udvidelsen installerer sig selv. Zed, JetBrains-IDE'er og andre editorer, der understøtter Agent Client Protocol, kører OpenCode med opencode acp.",
      features: {
        "quick-launch": { title: "Hurtig start", body: "Cmd+Esc eller Ctrl+Esc åbner OpenCode i en delt terminal." },
        "new-session": { title: "Ny session", body: "Cmd+Shift+Esc eller Ctrl+Shift+Esc starter en ny session." },
        context: { title: "Kontekst", body: "Deler din aktuelle markering eller fane med OpenCode." },
        "file-references": { title: "Filreferencer", body: "Cmd+Option+K eller Alt+Ctrl+K indsætter @File#L37-42." },
        "installs-itself": {
          title: "Installerer sig selv",
          body: "Kør opencode i den indbyggede terminal for at tilføje den.",
        },
        "acp-editors": { title: "ACP-editorer", body: "Zed, JetBrains-IDE'er, Avante.nvim og CodeCompanion.nvim." },
        "open-vsx": { title: "Open VSX", body: "Også på Open VSX til Cursor, Windsurf og VSCodium." },
        "same-agent": { title: "Samme agent", body: "Det OpenCode, du kører i terminalen, ved siden af din kode." },
      },
    },
    mini: {
      title: "OpenCode | Mini, en minimal terminalbrugerflade til agenten",
      description:
        "Mini kører OpenCode i en minimal terminalbrugerflade. Svarene skrives ind i din terminals egen scrollback, og kun en prompt og en statuslinje bliver nederst.",
      intro:
        "En minimal terminalbrugerflade til OpenCode. Kør opencode mini, og svarene skrives direkte ind i din terminals egen scrollback, så du kan scrolle, søge og kopiere dem som alt andet output. Kun prompten og en statuslinje bliver nederst.",
      features: {
        "your-scrollback": { title: "Din scrollback", body: "Svarene bliver til almindelig terminalhistorik." },
        "one-prompt": { title: "Én prompt", body: "Agent, model, kontekst og pris på én statuslinje." },
        permissions: { title: "Tilladelser", body: "Tillad ændringer og kommandoer fra promptområdet." },
        "how-much-shows": {
          title: "Hvor meget du ser",
          body: "Stille, standard eller alt, for tænkning og værktøjsoutput.",
        },
        "pick-up-later": {
          title: "Fortsæt senere",
          body: "Fortsæt den seneste session med -c, eller en hvilken som helst med -s.",
        },
        "same-opencode": { title: "Samme OpenCode", body: "Samme server, agenter og modeller som de andre apps." },
        agents: { title: "Agenter", body: "Skift agent direkte fra prompten." },
        compact: { title: "Kompakt", body: "Gør en lang session mindre med /compact." },
      },
    },
  },
  extensionCard: {
    name: "Udvidelser",
    body: "Brug OpenCode i VS Code, eller i Zed og andre editorer via ACP.",
    action: "Installer",
  },
  extensions: {
    browse: {
      body: "Lad agenter bruge din rigtige browser.",
      title: "OpenCode | Browse, din rigtige browser til kodningsagenter",
      description:
        "Browse lader OpenCode og andre MCP-klienter bruge din rigtige browser. Agenter styrer faner i baggrunden med Playwright og giver logins og 2FA tilbage til dig.",
      intro:
        "En MCP-server og en Chromium-udvidelse, der lader dine agenter bruge din rigtige browser med dine faner, logins og udvidelser. De åbner og styrer faner med Playwright, tager skærmbilleder og optager skærmen i baggrundsfaner, der er samlet i grupper og ude af vejen. Når det er din tur, for et login, en 2FA-prompt eller en betaling, giver de fanen tilbage til dig og fortsætter, når du klikker på Continue.",
      features: {
        "your-real-browser": {
          title: "Din rigtige browser",
          body: "Chrome, Edge, Brave, Arc, Helium, Vivaldi, Opera og Chromium.",
        },
        "out-of-your-way": { title: "Ude af vejen", body: "Agentfaner åbner i baggrunden i sammenklappede grupper." },
        handoffs: { title: "Aflevering", body: "Klar login eller 2FA selv, og klik så på Continue." },
        "lend-a-tab": {
          title: "Lån en fane ud",
          body: "Klik på knappen i værktøjslinjen for at give en agent en åben fane.",
        },
        "record-and-capture": {
          title: "Optag og gem",
          body: "Skærmbilleder, skærmoptagelser og netværkstrafik som HAR.",
        },
        "any-mcp-client": {
          title: "Enhver MCP-klient",
          body: "OpenCode, Claude Code, Cursor, Codex, Zed og mange flere.",
        },
        "all-your-logins": {
          title: "Alle dine logins",
          body: "Agenter bruger de sites, du allerede er logget ind på. Ingen nøgler, ingen opsætning.",
        },
        allowlists: { title: "Hvidlister", body: "Begræns en sessions faner til de sites, du angiver." },
      },
      install:
        "Installer [Chrome-udvidelsen] først. Den guider dig gennem resten af trinene. Vil du installere CLI'en direkte (det burde du ikke have brug for), så brug en af disse.",
    },
  },
  apps: {
    browse: {
      category: "Browserstyring for agenter",
      body: "Lad din agent bruge din rigtige browser, med dine logins og faner.",
    },
    opentunnel: { category: "Lokale tunneler", body: "Offentlige HTTPS-URL'er til lokale apps." },
    opentui: { category: "Bibliotek", body: "Et bibliotek til terminalbrugerflader." },
    hex: { category: "Diktering", body: "Diktering direkte på enheden til enhver app." },
  },
  getStarted: {
    title: "Kom i gang",
    lead: "Den nemmeste måde at starte på er at downloade OpenCode og bruge de gratis modeller. Ingen konto nødvendig. Vil du have mere, så tag dit eget abonnement med, eller brug OpenCode Go.",
    phrases: {
      "download-opencode": { text: "downloade OpenCode" },
      "free-models": { text: "gratis modeller" },
      "your-own-subscription": { text: "dit eget abonnement" },
      "a-subscription-you-already-have": { text: "et abonnement, du allerede har" },
    },
    subscriptions: { "chatgpt-plus-pro": { name: "ChatGPT Plus/Pro" } },
    steps: {
      download: { title: "Download", line: "Desktop, terminal eller mobil." },
      "use-free-models": {
        title: "Brug gratis modeller",
        line: "OpenCode har et sæt gratis modeller. Ingen konto nødvendig.",
      },
      "add-more-models": {
        title: "Tilføj flere modeller",
        line: "Tag dit eget abonnement med, eller brug OpenCode Go's udvalgte modeller fra $10/md.",
      },
    },
    sentence:
      "Download OpenCode, start med gratis modeller, og tag dit eget abonnement eller OpenCode Go med, når du vil have mere.",
  },
  byos: {
    title: "Brug dit eget abonnement",
    headline: "Brug de abonnementer, du allerede har.",
    line: "Log ind med ChatGPT Plus eller Pro eller med GitHub Copilot. Eller brug et OpenCode-abonnement.",
    yours: { label: "Dit abonnement", items: { "chatgpt-plus-pro": { name: "ChatGPT Plus/Pro" } } },
    planLinks: ["OpenCode-abonnement"],
    ours: { label: "OpenCode-abonnementer" },
  },
  brand: {
    hero: { copy: { text: "Regler til agent", copied: "Regler kopieret" } },
    naming: {
      title: "Navn",
      body: "Skriv OpenCode i ét ord med stort O og stort C. Skriv ikke Opencode, Open Code, OpenCode AI eller Open-Code.",
      code: "Brug kun `opencode` med små bogstaver i kode og pakkenavne, som `opencode-figma` eller `@acme/opencode-plugin`.",
    },
    families: {
      logo: {
        title: "Logo",
        body: "Logoet alene, til appikoner, avatarer og andre små flader. De kvadratiske versioner har ekstra luft til steder, der beskærer til et kvadrat.",
        assets: {
          light: { name: "Lyst" },
          dark: { name: "Mørkt" },
          "square-light": { name: "Kvadratisk, lyst" },
          "square-dark": { name: "Kvadratisk, mørkt" },
        },
      },
      wordmark: {
        title: "Ordmærke",
        body: "Det fulde navn i OpenCodes bogstavformer. Brug det, hvor der er plads til at skrive navnet helt ud.",
        assets: { light: { name: "Lyst" }, dark: { name: "Mørkt" } },
      },
      "simple-wordmark": {
        title: "Simpelt ordmærke",
        body: "En ensfarvet version af ordmærket til tryk, broderi og steder, der kun tillader én farve.",
        assets: { light: { name: "Lyst" }, dark: { name: "Mørkt" } },
      },
    },
    icons: {
      title: "Avatarer",
      body: "Kvadratiske avatarer på 1024px til Slack, Discord, GitHub og andre profiler. Baggrunden fylder hele kvadratet, og logoet sidder et godt stykke inde i cirklen, så det klarer en rund beskæring.",
      items: { dark: { name: "Mørkt" }, light: { name: "Lyst" } },
    },
    colors: {
      title: "Farver",
      body: "Logoet og ordmærket bruger én farve i tre opaciteter, med en lysere farve til mørke baggrunde. Værdierne nedenfor er farven på hvid eller #0B0B0B, som standardfilerne viser den. Klik på en værdi for at kopiere den.",
      palettes: {
        light: {
          name: "Lyst",
          swatches: {
            ink: { name: "Farve", use: "Logoets kontur og bogstaverne i »code«." },
            "ink-70": { name: "Farve 70%", use: "Bogstaverne i »open«.", ink: "Farven med 70% opacitet." },
            "ink-20": { name: "Farve 20%", use: "Logoets indre skygge.", ink: "Farven med 20% opacitet." },
          },
        },
        dark: {
          name: "Mørkt",
          swatches: {
            ink: { name: "Farve", use: "Logoets kontur og bogstaverne i »code«." },
            "ink-72": { name: "Farve 72%", use: "Bogstaverne i »open«.", ink: "Farven med 72% opacitet." },
            "ink-28": { name: "Farve 28%", use: "Logoets indre skygge.", ink: "Farven med 28% opacitet." },
          },
        },
      },
    },
    variants: {
      title: "Varianter",
      body: "Vælg den version, der holder logoet tydeligt på din baggrund, altså mørk på lyse baggrunde og lys på mørke. Logoet og ordmærket er separate filer. Brug det ene eller det andet.",
      groups: {
        default: {
          name: "Standard",
          body: "Logoet, du bruger næsten overalt. Den indre skygge er gennemsigtig. På hvid eller sort ligner det præcis de tofarvede gråtoner, og på fotos, gradienter og farver skinner baggrunden igennem.",
          rows: {
            logo: { title: "Logo", tiles: { dark: { name: "Mørkt" }, light: { name: "Lyst" } } },
            wordmark: { title: "Ordmærke", tiles: { dark: { name: "Mørkt" }, light: { name: "Lyst" } } },
          },
        },
        simple: {
          name: "Simpel",
          body: "Én farve med åbne punktsere og uden indre skygge. Brug den på ensfarvede baggrunde, til tryk i én farve og overalt, hvor du ikke kan bruge gråtonerne, simpel mørk på lyse farver og simpel lys på mørke farver.",
          rows: { wordmark: { title: "Ordmærke", tiles: { dark: { name: "Mørkt" }, light: { name: "Lyst" } } } },
        },
      },
    },
    usage: {
      title: "Brug",
      body: "Brug de lyse versioner på lyse baggrunde og de mørke versioner på mørke baggrunde. Logoet og ordmærket er separate. Brug det ene eller det andet, ikke begge sammen.",
      stroke: {
        title: "Én streg",
        body: "Afstandsreglerne på denne side måles i streger. Én streg er tykkelsen af logoets kontur, altså en fjerdedel af dets bredde, så logoet er 4 streger bredt og 5 streger højt.",
      },
      clearSpace: {
        title: "Frirum",
        body: "Hold mindst to stregers afstand på alle sider af logoet og ordmærket. For logoet er en streg tykkelsen af dets kontur, en fjerdedel af bredden. For ordmærket er det tykkelsen af bogstaverne, en syvendedel af højden.",
      },
      pixels: {
        title: "Hele pixels",
        body: "Logoets proportioner er låst til 4:5, og én streg er en fjerdedel af dets bredde. Skaler det i trin på 4 × 5px, så hver kant og hver streg lander på en hel pixel.",
        do: "at hver kant og stregen på 4px lander på hele pixels.",
        dont: "at give logoet andre proportioner end 4:5, ellers falder kanterne mellem pixels og bliver slørede.",
        sizes: { logo: { title: "Logo" }, wordmark: { title: "Ordmærke" } },
      },
      minimumTitle: "Minimumsstørrelser",
      minimum: {
        logo: { title: "Logo", body: "Mindst 16 × 20px med en streg på 4px. Mindre end det bliver det sløret." },
        wordmark: {
          title: "Ordmærke",
          body: "Mindst 117 × 21px med en streg på 3px. Mindre end det bliver det sløret.",
        },
      },
    },
    donts: {
      title: "Undgå",
      body: "Almindelige fejl, du skal undgå, når du bruger logoet og ordmærket.",
      examples: {
        "two-tone": { caption: "at farve logoet i nye farver." },
        bright: { caption: "at bruge én skarp farve." },
        gradient: { caption: "at fylde logoet med en gradient." },
        inverted: { caption: "at bytte om på tonerne." },
        stretch: { caption: "at strække eller klemme logoet." },
        shadow: { caption: "at tilføje skygger." },
        glow: { caption: "at tilføje glød eller konturer." },
        lockup: { caption: "at sætte andre ord ved siden af logoet." },
        "low-contrast": { caption: "at bruge grå på grå med lav kontrast." },
        color: { caption: "at sætte det grå tofarvede logo på en farvet baggrund, hvor gråtonerne bliver mudrede." },
      },
    },
    integrations: {
      title: "Integrationer",
      body: "Plugins, udbydere og værktøjer, der virker med OpenCode, og projekter bygget med det, må gerne sige det. Brug et badge eller et partner-lockup, og navngiv dit projekt, så det er tydeligt, at det er dit.",
      badges: {
        body: "Sæt et badge i din README, dokumentation eller på dit website, og link det til opencode.ai. Vælg den lyse eller mørke fil til din baggrund (HTML'en skifter selv), og ændr ikke farverne eller teksten.",
        sizes: "Alle stilarter findes i 20, 32 og 44px (Shields kun i 20px), som SVG og som PNG i 2×.",
        mono: "Hver fil findes også med tekst i OpenTUI Mono. Tilføj -mono før filtypen, som i opencode-works-with-a-light-20-mono.svg, eller -mono-caps for OpenTUI Mono med versaler.",
        groups: {
          "works-with": {
            title: "Virker med",
            alt: "Virker med OpenCode",
            body: "Til plugins, udbydere og værktøjer, der kører med OpenCode.",
          },
          "built-with": { title: "Bygget med", alt: "Bygget med OpenCode", body: "Til projekter lavet med OpenCode." },
        },
        styles: { a: { name: "Ramme" }, c: { name: "Celler" }, f: { name: "Massiv" }, g: { name: "Shields" } },
      },
      lockup: {
        title: "Partner-lockup",
        body: "Placer OpenCode-logoet og partnerlogoet side om side med et × imellem. Hold 3 stregers afstand på hver side af ×, skaler partnerlogoet, så det ser lige så højt ud som OpenCode-logoet, og hold frirum rundt om hele lockuppet.",
      },
      naming: {
        title: "Navngiv dit projekt",
        body: "Start med dit eget navn, så det er tydeligt, at projektet er dit.",
        rule: "Skriv `Linear for OpenCode`, eller kald pakken `opencode-linear`. Skriv ikke `OpenCode Linear` eller `Linear by OpenCode`.",
      },
    },
    trademarks: {
      title: "Varemærker",
      body: "OpenCode og OpenCode-logoet er varemærker tilhørende Anomaly. Brug dem ikke til at antyde, at Anomaly støtter eller sponsorerer dig, i dit produkt- eller firmanavn eller på merchandise uden tilladelse.",
      contact: { before: "Spørgsmål kan sendes til " },
    },
  },
  press: {
    title: "OpenCode | Pressekit med fakta om firmaet og brand-assets",
    description:
      "OpenCodes pressekit med fakta om OpenCode og Anomaly, firmaet bag, plus logoer og ordmærker til download og en kontakt til spørgsmål fra pressen.",
    hero: { title: "Presse", body: "Fakta, brand-assets og kontakter til at skrive om OpenCode og Anomaly." },
    company: {
      title: "Om Anomaly",
      lead: "Anomaly er firmaet bag OpenCode. Det bygger open source-værktøjer til udviklere.",
      more: "Andre projekter er bl.a. SST og OpenTUI, alle open source på [GitHub](github).",
      learnMore: "Læs mere på [anoma.ly](site).",
      projects: {
        opencode: {
          body: "Open source-kodningsagenten med apps til desktop, terminal og mobil og et SDK. MIT-licenseret, over 220.000 GitHub-stjerner.",
        },
        sst: {
          body: "Et framework til at bygge full-stack-apps på din egen infrastruktur. MIT-licenseret, åbent siden 2020, med over 26.000 GitHub-stjerner.",
        },
        opentui: {
          name: "OpenTUI",
          body: "Et bibliotek til terminalbrugerflader i TypeScript, React eller Solid med en kerne i Zig. OpenCode bruger det i produktion. Over 13.000 GitHub-stjerner.",
        },
        "models-dev": {
          body: "En open source-database med specifikationer, priser og egenskaber for AI-modeller og et offentligt API. Den indeholder over 8.900 modeller fra over 200 udbydere.",
        },
        hex: {
          body: "Diktering til Mac, Windows og Linux. Hex transskriberer på din enhed og indsætter i enhver app, så lyden aldrig forlader den.",
        },
        opentunnel: {
          body: "En CLI og et SDK, der giver apps på din maskine en offentlig HTTPS-URL. TLS ender på din maskine, så relayet aldrig ser klartekst.",
        },
      },
    },
    about: {
      title: "Om OpenCode",
      boilerplate: {
        long: "OpenCode er en open source-kodningsagent. Den findes som desktopapp, terminal-UI, mobilapp og SDK og virker med modeller fra enhver udbyder, bl.a. Claude, GPT og Gemini. OpenCode er MIT-licenseret og lavet af Anomaly. Den har over 220.000 GitHub-stjerner og mere end 1.000 bidragydere, og over 22 millioner udviklere bruger den hver måned.",
        short:
          "OpenCode er en open source-kodningsagent fra Anomaly med apps til desktop, terminal og mobil og et SDK.",
      },
      products: {
        "opencode-console": {
          name: "OpenCode Console",
          long: "OpenCode Console er webappen, hvor udviklere og teams køber og administrerer adgang til AI-modeller til OpenCode og andre kodningsagenter. Den tilbyder pay-as-you-go-inferens til frontier- og open weight-modeller, afregnet pr. request fra forudbetalt kredit, og OpenCode Go-abonnementer. Teams får workspaces med rollerne Member, Admin og Owner, forbrugsgrænser for workspace og pr. bruger, single sign-on med Okta, Microsoft Entra ID eller Google Workspace og SCIM. Console understøtter mere end 30 udbydere, så teams kan forbinde udbyderkonti, de allerede har, og den egen inferens er valgfri. Den findes på opencode.ai/console.",
          short:
            "OpenCode Console er Anomalys webapp til pay-as-you-go-adgang til AI-modeller, OpenCode Go-abonnementer og teamkontrol som budgetter og single sign-on.",
        },
        "opencode-go": {
          long: "OpenCode Go er et abonnement til udviklere, der vil have en fast månedspris for kodningsmodeller. Go koster $10/md., Go Plus koster $40/md. med højere grænser, og Go Teams koster $20/md. pr. medlem. Hvert abonnement indeholder et udvalg af modeller, der er testet til agentisk kodning. Forbrugsgrænserne er månedlige dollarbeløb for hver model med løbende kvoter for 5 timer og en uge på 20% og 50% af månedsgrænsen. Abonnenter kan fylde kredit på, falde tilbage på en pay-as-you-go-saldo og opsige når som helst. Go virker med OpenCode og andre agenter. Det findes på opencode.ai/console/go.",
          short:
            "OpenCode Go er et månedligt abonnement fra Anomaly, der giver udviklere månedlige forbrugsgrænser på et udvalg af kodningsmodeller, fra $10/md.",
        },
        "opencode-data": {
          name: "OpenCode Data",
          long: "OpenCode Data er et offentligt dashboard, der viser, hvilke AI-modeller udviklere bruger i OpenCode, og hvordan fordelingen ændrer sig over tid. Det udgiver en rangliste over de mest brugte modeller, tokenforbrug, omkostninger pr. session og token, cache-andele, markedsandele og en opdeling efter land. Tallene samles hver time med dage og uger i UTC. Antal brugere og sessioner er omtrentlige, og omkostninger bruger listepriser fra OpenCodes modelkatalog. Journalister kan citere det som OpenCode Data (opencode.ai/data) med det opdateringstidspunkt, siden viser.",
          short:
            "OpenCode Data er et offentligt dashboard på opencode.ai/data, der rangerer AI-modeller efter reelt forbrug i OpenCode med tokens, omkostninger og markedsandele, opdateret hver time.",
        },
      },
    },
    facts: {
      title: "Kort fortalt",
      items: {
        license: { label: "Licens" },
        "first-release": { label: "Første version" },
        "made-by": { label: "Lavet af" },
      },
    },
    milestones: {
      title: "Milepæle",
      items: {
        "first-release-v0-0-1": { date: "apr. 2025", text: "Første version, v0.0.1" },
        "1-million-downloads": { date: "okt. 2025", text: "Over 1 million downloads" },
        "opencode-1-0": { date: "okt. 2025", text: "OpenCode 1.0" },
        "desktop-app-ships": { date: "dec. 2025", text: "Desktopappen udkommer" },
        "10-million-downloads": { date: "jan. 2026", text: "Over 10 millioner downloads" },
        "opencode-2-0": { date: "sep. 2026", text: "OpenCode 2.0" },
        "220-000-github-stars": { date: "nov. 2026", text: "Over 220.000 GitHub-stjerner" },
      },
    },
    news: {
      title: "Seneste versioner",
      intro: "OpenCode udkommer ofte. Her er de nyeste versioner med nye funktioner.",
      changelog: { text: "Fuld changelog" },
      feed: { text: "RSS-feed" },
    },
    media: {
      title: "Medier",
      intro:
        "Stillbilleder og korte videoer af hver app, optaget fra det rigtige produkt. Du kan bruge dem, når du skriver om OpenCode.",
      note: "Alle optagelser bruger det mørke tema. Stillbilleder og plakater er JPG'er op til 1920 × 1080, eller 1080 × 1350 i portræt. Videoer er MP4-klip uden lyd.",
      products: {
        desktop: {
          name: "Desktop",
          items: {
            "locked-landscape": { title: "Desktop-film" },
            "frame-1": { title: "Desktop-billede 1" },
            "frame-2": { title: "Desktop-billede 2" },
            "frame-3": { title: "Desktop-billede 3" },
            "frame-4": { title: "Desktop-billede 4" },
            "feature-1": { title: "Sessioner i faner" },
            "feature-2": { title: "Gennemgå og kommenter" },
            "feature-3": { title: "Se det i browseren" },
            "locked-portrait": { title: "Desktop-film, portræt" },
          },
        },
        mobile: {
          name: "Mobile",
          items: {
            "locked-landscape": { title: "Mobile-film" },
            "frame-1": { title: "Mobile-billede 1" },
            "frame-2": { title: "Mobile-billede 2" },
            "frame-3": { title: "Mobile-billede 3" },
            "feature-1": { title: "Stemme" },
            "feature-2": { title: "Godkendelser" },
            "feature-3": { title: "Sessioner" },
            "locked-portrait": { title: "Mobile-film, portræt" },
          },
        },
        terminal: {
          name: "Terminal",
          items: {
            "locked-landscape": { title: "Terminal-film" },
            "frame-1": { title: "Terminal-billede 1" },
            "frame-2": { title: "Terminal-billede 2" },
            "frame-3": { title: "Terminal-billede 3" },
            "frame-4": { title: "Terminal-billede 4" },
            "feature-1": { title: "Spørg med egne ord" },
            "feature-2": { title: "Godkend det, der kører" },
            "feature-3": { title: "Gør den til din" },
            "locked-portrait": { title: "Terminal-film, portræt" },
          },
        },
        sdk: {
          items: {
            "locked-landscape": { title: "SDK-film" },
            "frame-1": { title: "SDK-billede 1" },
            "frame-2": { title: "SDK-billede 2" },
            "frame-3": { title: "SDK-billede 3" },
            "frame-4": { title: "SDK-billede 4" },
            "feature-1": { title: "Ret CI fra kode" },
            "feature-2": { title: "Følg hvert trin" },
            "feature-3": { title: "Byg egne værktøjer" },
            "locked-portrait": { title: "SDK-film, portræt" },
          },
        },
      },
    },
    people: { title: "Personer" },
    anomalyLogo: {
      title: "Anomaly-logo",
      body: "Anomaly-mærket og ordmærket i sort og hvid. PNG'er er 2048 px brede.",
      assets: {
        "mark-black": { name: "Mærke, sort" },
        "mark-white": { name: "Mærke, hvid" },
        "wordmark-black": { name: "Ordmærke, sort" },
        "wordmark-white": { name: "Ordmærke, hvid" },
      },
      all: { text: "Download alt" },
    },
    coverage: { title: "Omtale" },
    brand: {
      title: "Brand",
      before:
        "Download OpenCode-logoerne og -ordmærkerne i én ZIP-fil. Enkelte filer, varianter og regler for brug finder du på ",
      link: { text: "brandsiden" },
      usage:
        "Du kan bruge filerne, når du skriver om OpenCode. Ændr dem ikke, og antyd ikke, at OpenCode støtter dit arbejde.",
    },
    product: {
      title: "Produkt",
      items: {
        desktop: {
          name: "Desktop",
          body: "Kør flere agenter på én gang, hver i sin egen fane, på macOS, Windows og Linux. Gennemgå hver ændring som et diff, og se den.",
        },
        mobile: {
          name: "Mobile",
          body: "Den nyeste OpenCode-app. Ring til en session for at tale med agenten, og gennemgå og godkend dens ændringer fra din telefon, hvor som helst.",
        },
        terminal: {
          name: "Terminal",
          body: "En terminalbrugerflade, der virker i enhver shell, editor eller fjernserver. Se hver ændring som et diff, og vælg, hvilke kommandoer der kører af sig selv.",
        },
        sdk: {
          body: "En typet TypeScript-klient til scripts, CI-jobs og dine egne værktøjer. Opret sessioner, send prompts, og stream alle events, mens de sker.",
        },
      },
    },
    contact: {
      title: "Kontakt",
      items: {
        press: { title: "Presse", body: "Til journalister og analytikere. Vi svarer kun på henvendelser fra medier." },
        support: {
          title: "Support",
          body: "Få hjælp til OpenCode ved at oprette et issue eller spørge fællesskabet. Skriv til os om konto og betaling.",
          links: { "github-issues": { text: "GitHub-issues" }, "help-anoma-ly": { text: "help@anoma.ly" } },
        },
        security: {
          title: "Sikkerhed",
          body: "Rapporter en sårbarhed via GitHub. Skriv til os, hvis ingen svarer inden for 6 hverdage.",
          links: {
            "report-a-vulnerability": { text: "Rapporter en sårbarhed" },
            "security-anoma-ly": { text: "security@anoma.ly" },
          },
        },
      },
    },
  },
  download: {
    desktop: { title: "Desktop" },
    mobile: { title: "Mobile", stores: { "google-play": { label: "Google Play" } } },
    terminal: { title: "Terminal", installs: { curl: { name: "Script" } } },
    extensions: {
      title: "Udvidelser",
      items: {
        cursor: { label: "Cursor" },
        zed: { label: "Zed" },
        windsurf: { label: "Windsurf" },
        vscodium: { label: "VSCodium" },
      },
    },
  },
  productDownloads: {
    terminal: { commands: { curl: { name: "Script" } } },
    sdk: { more: { label: "Læs SDK-dokumentationen" } },
    ide: {
      lead: "Kør opencode i din editors indbyggede terminal, så installerer udvidelsen sig selv. Du kan også installere den selv.",
      links: {
        "vs-code-marketplace": { label: "VS Code Marketplace" },
        "open-vsx-cursor-windsurf-vscodium": { label: "Open VSX (Cursor, Windsurf, VSCodium)" },
      },
      more: { label: "Opsæt Zed, JetBrains-IDE'er og andre ACP-editorer" },
    },
    mini: {
      commands: { curl: { name: "Script" } },
      lead: "Mini følger med OpenCode CLI. Installer den på en af disse måder, og kør så opencode mini.",
    },
  },
  pair: {
    title: "Forbind din telefon",
    cardTitle: "Par din telefon med én kommando",
    intro:
      "OpenCode Mobile er en fjernbetjening til OpenCode på din computer. Dine sessioner kører videre der, og appen viser dem og lader dig styre dem.",
    steps: {
      "get-the-app": {
        title: "Hent appen",
        body: "Installer OpenCode-betaen på din iPhone fra TestFlight. Android-appen kommer snart.",
      },
      "run-this-on-your-computer": {
        title: "Kør dette på din computer",
        body: "Den udskriver et engangslink og en QR-kode. De virker én gang og udløber efter 5 minutter.",
      },
      "scan-the-code": {
        title: "Scan koden",
        body: "Scan QR-koden med appen, eller indsæt linket. Din computers seneste sessioner åbner på telefonen.",
      },
    },
    note: "--remote forbinder via en OpenTunnel-adresse, så det virker fra ethvert netværk. På samme Wi-Fi kører du opencode service set hostname 0.0.0.0 én gang og derefter opencode pair.",
    facts: [
      "Parringen virker fra ethvert netværk, fordi --remote forbinder via en OpenTunnel-adresse.",
      "Linket og koden virker én gang og udløber efter 5 minutter.",
      "Lad computeren være tændt, for agenten kører der og ikke på telefonen.",
      "På samme Wi-Fi kører du opencode service set hostname 0.0.0.0 én gang og derefter opencode pair.",
    ],
  },
  announcements: {
    "create-install-and-share-desktop-plugins": {
      text: "Opret, installer og del desktop-plugins.",
      link: "Se nyt i 2.2",
    },
    "desktop-terminals-now-survive-restarts": { text: "Desktop-terminaler overlever nu genstart.", link: "Se v2.2.4" },
    "agents-can-now-generate-images": { text: "Agenter kan nu generere billeder.", link: "Se v2.2.1" },
    "steer-your-sessions-from-your-phone": {
      text: "Styr dine sessioner fra din telefon.",
      link: "Mød OpenCode Mobile",
    },
    "a-refreshed-desktop-app": { text: "En fornyet desktopapp.", link: "Se nyt i 2.2" },
  },
} satisfies ContentOverlay
