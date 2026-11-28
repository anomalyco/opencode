import type { ContentOverlay } from "./source"

export const content = {
  announcements: {
    "create-install-and-share-desktop-plugins": {
      text: "Twórz, instaluj i udostępniaj pluginy desktopowe.",
      link: "Zobacz nowości w 2.2",
    },
    "desktop-terminals-now-survive-restarts": {
      text: "Terminale w Desktop działają dalej po restarcie.",
      link: "Zobacz v2.2.4",
    },
    "agents-can-now-generate-images": {
      text: "Agenci mogą teraz generować obrazy.",
      link: "Zobacz v2.2.1",
    },
    "steer-your-sessions-from-your-phone": {
      text: "Steruj sesjami z telefonu.",
      link: "Poznaj OpenCode Mobile",
    },
    "a-refreshed-desktop-app": {
      text: "Odświeżona aplikacja desktopowa.",
      link: "Zobacz nowości w 2.2",
    },
  },
  products: {
    desktop: {
      name: "Desktop",
      body: "Sesje, karty, diffy, wbudowana przeglądarka i rozszerzenia na macOS, Windows i Linux.",
      action: "Pobierz",
    },
    mobile: {
      name: "Mobile",
      body: "Uruchamiaj sesje, steruj nimi i zatwierdzaj działania z telefonu, gdziekolwiek jesteś.",
      action: "Pobierz",
    },
    terminal: {
      name: "Terminal",
      body: "Szybki interfejs terminalowy, który działa w każdej powłoce, edytorze i na zdalnym serwerze.",
      action: "Zainstaluj",
    },
    sdk: {
      name: "SDK",
      body: "Steruj OpenCode z własnych skryptów, zadań CI i narzędzi.",
      action: "Dokumentacja",
    },
    mini: {
      name: "Mini",
      body: "Minimalistyczny interfejs terminalowy. Odpowiedzi trafiają do historii przewijania, a pod nimi jest jedno pole na prompt.",
      action: "Zainstaluj",
    },
  },
  productDetails: {
    desktop: {
      title: "OpenCode | Aplikacja desktopowa na macOS, Windows i Linux",
      description:
        "Uruchamiaj dowolną liczbę agentów OpenCode równolegle, sprawdzaj każdą zmianę w przeglądarce obok sesji i wracaj do pracy na dowolnym urządzeniu. Na macOS, Windows i Linux.",
      intro:
        "Uruchamiaj kilku agentów naraz, każdą sesję w osobnej karcie. Przeglądaj każdą zmianę jako diff, komentuj dowolną linię i sprawdzaj wynik we wbudowanej przeglądarce. Na macOS, Windows i Linux.",
      showcase: {
        "parallel-agents": {
          title: "Równoległa praca agentów",
          body: "Uruchom tylu agentów, ilu chcesz, i pozwól im pracować równolegle. Przełączaj się między nimi, gdy kończą.",
        },
        "see-it-in-the-browser": {
          title: "Zobacz w przeglądarce",
          body: "Twoja aplikacja otwiera się w przeglądarce obok sesji. Ty i agent widzicie każdą zmianę na bieżąco.",
        },
        "on-every-device": {
          title: "Na każdym urządzeniu",
          body: "Uruchamiaj agentów na wszystkich swoich urządzeniach i kontynuuj w aplikacji desktopowej, terminalu lub na telefonie.",
        },
        "extend-it": {
          title: "Rozszerzaj OpenCode",
          body: "Podłącz swoje narzędzia i usługi, by agent mógł z nich korzystać. Możesz też zlecić OpenCode napisanie pluginów do samego OpenCode, z własnym interfejsem na pasku bocznym.",
        },
      },
    },
    mobile: {
      title: "OpenCode | Mobile – sesje programowania na telefonie",
      description:
        "Uruchamiaj sesje OpenCode i steruj nimi z telefonu. Rozmawiaj z agentem, który pracuje na Twoim komputerze.",
      intro:
        "Uruchamiaj sesje i steruj nimi z telefonu, gdziekolwiek jesteś. Połącz się głosowo z agentem albo otwórz dowolną sesję i wróć do pracy. Wszystko nadal działa w OpenCode na Twoim komputerze.",
      showcase: {
        voice: {
          title: "Głos",
          body: "Połącz się głosowo z sesją i powiedz, czego potrzebujesz. Agent odpowie na głos.",
        },
        sessions: {
          title: "Sesje",
          body: "Otwórz dowolną sesję, sprawdź postępy i wróć do pracy.",
        },
        results: {
          title: "Wyniki",
          body: "Gdy zlecona praca jest gotowa, w rozmowie usłyszysz, co się zmieniło.",
        },
      },
    },
    terminal: {
      title: "OpenCode | Interfejs terminalowy agenta open source do programowania",
      description:
        "Szybki interfejs terminalowy OpenCode działa w każdej powłoce, w edytorze lub na zdalnym serwerze. Opisz zadanie, przeglądaj zmiany w widoku Diff i zatwierdzaj polecenia.",
      intro:
        "Szybki interfejs terminalowy działa w każdej powłoce, w edytorze lub na zdalnym serwerze. Opisz zadanie własnymi słowami, śledź zmiany w widoku Diff i wybierz, które polecenia mają się uruchamiać automatycznie.",
      features: {
        "any-terminal": {
          title: "Każdy terminal",
          body: "Działa w każdej powłoce, w terminalu edytora i na zdalnym serwerze.",
        },
        "diffs-in-the-timeline": {
          title: "Zmiany na osi czasu",
          body: "Gdy agent wprowadza zmianę, od razu zobaczysz jej diff na osi czasu.",
        },
        "pick-up-later": {
          title: "Wróć później",
          body: "Wznów ostatnią sesję za pomocą -c lub wybierz dowolną sesję za pomocą -s.",
        },
        "one-off-runs": {
          title: "Jednorazowe uruchomienia",
          body: "opencode run wysyła jedną wiadomość i wypisuje odpowiedź.",
        },
        "agents-and-commands": {
          title: "Agenci i polecenia",
          body: "Przełączaj agentów skrótem shift+tab i otwieraj listę poleceń skrótem ctrl+p.",
        },
        "auto-approve": {
          title: "Autozatwierdzanie",
          body: "Uruchom z flagą --auto, aby zezwolić na wszystkie niezablokowane działania.",
        },
        "any-server": {
          title: "Każdy serwer",
          body: "Podaj URL serwera OpenCode z flagą --server, aby się z nim połączyć.",
        },
        "usage-stats": {
          title: "Statystyki użycia",
          body: "Polecenie opencode stats pokazuje statystyki użycia, które możesz udostępnić.",
        },
      },
      showcase: {
        "ask-in-plain-words": {
          title: "Pisz zwykłymi słowami",
          body: "Wpisz, czego chcesz, a agent pokaże plan w trakcie pracy.",
        },
        "approve-what-runs": {
          title: "Zatwierdzaj polecenia",
          body: "Zmiany widać w widoku Diff, a polecenia czekają na Twoją zgodę.",
        },
        "make-it-yours": {
          title: "Po swojemu",
          body: "Zmieniaj motyw jednym klawiszem, od domyślnego po tokyonight i inne.",
        },
        mini: {
          title: "Mini",
          body: "Uruchom opencode mini, a odpowiedzi trafią do historii przewijania terminala.",
        },
      },
    },
    sdk: {
      title: "OpenCode | SDK TypeScript dla skryptów, zadań CI i narzędzi",
      description:
        "Steruj OpenCode z własnych skryptów, zadań CI i narzędzi. Typowany klient TypeScript tworzy sesje, wysyła prompty i strumieniuje każde zdarzenie na bieżąco.",
      intro:
        "Steruj OpenCode z własnych skryptów, zadań CI i narzędzi. SDK uruchamia OpenCode w Twoim procesie, z Twoją konfiguracją i modelami, a typowany klient tworzy sesje, wysyła prompty i strumieniuje każde zdarzenie.",
      features: {
        "typescript-client": {
          title: "Klient TypeScript",
          body: "Typowane żądania i zdarzenia, z tymi samymi wartościami co @opencode/client.",
        },
        "sessions-from-code": {
          title: "Sesje z kodu",
          body: "Twórz sesje i wysyłaj prompty z dowolnego skryptu.",
        },
        "any-model": {
          title: "Każdy model",
          body: "Używa modeli skonfigurowanych w Twoim OpenCode.",
        },
        "npm-or-bun": {
          title: "npm lub Bun",
          body: "Zainstaluj przez npm i @opencode/sdk lub bun add @opencode/sdk.",
        },
        "in-process-host": {
          title: "Host w procesie",
          body: "Uruchamia OpenCode w pamięci, bez ruchu sieciowego.",
        },
        "your-plugins": {
          title: "Twoje pluginy",
          body: "Przekaż własne pluginy przy tworzeniu hosta w procesie.",
        },
        "promise-or-effect": {
          title: "Promise lub Effect",
          body: "API Promise i API Effect z tymi samymi wartościami.",
        },
        "cloudflare-workers": {
          title: "Cloudflare Workers",
          body: "Uruchamiaj OpenCode w Durable Object Cloudflare na Workers.",
        },
      },
      showcase: {
        "fix-ci-from-code": {
          title: "Napraw CI z kodu",
          body: "Krótki skrypt zleca OpenCode naprawę testów, które nie przeszły, i uruchamia je ponownie.",
        },
        "follow-every-step": {
          title: "Śledź każdy krok",
          body: "Odbieraj strumień zdarzeń, aby na bieżąco widzieć każde wywołanie narzędzia przez agenta.",
        },
        "build-your-own-tools": {
          title: "Twórz własne narzędzia",
          body: "Wystarczy kilka linii kodu, by podłączyć OpenCode do botów, paneli i procesów.",
        },
        "in-your-process": {
          title: "W Twoim procesie",
          body: "Uruchamia OpenCode w Twoim procesie, z Twoją konfiguracją i modelami.",
        },
      },
    },
    mini: {
      title: "OpenCode | Mini, minimalny interfejs terminalowy dla agenta",
      description:
        "Mini uruchamia OpenCode w minimalistycznym interfejsie terminalowym. Odpowiedzi trafiają do historii przewijania, a na dole zostają tylko pole na prompt i wiersz stanu.",
      intro:
        "Minimalistyczny interfejs terminalowy OpenCode. Uruchom opencode mini, a odpowiedzi trafią wprost do historii przewijania terminala. Przewijaj, wyszukuj i kopiuj je jak każdy inny wynik. Na dole zostają tylko pole na prompt i wiersz stanu.",
      features: {
        "your-scrollback": {
          title: "Historia przewijania",
          body: "Odpowiedzi trafiają do zwykłej historii przewijania terminala.",
        },
        "one-prompt": {
          title: "Jeden prompt",
          body: "Agent, model, kontekst i koszt w jednym wierszu stanu.",
        },
        permissions: {
          title: "Uprawnienia",
          body: "Zatwierdzaj zmiany i polecenia z pola na prompt.",
        },
        "how-much-shows": {
          title: "Zakres wyświetlania",
          body: "Myślenie i wyniki narzędzi w trybie cichym, domyślnym lub pełnym.",
        },
        "pick-up-later": {
          title: "Wróć później",
          body: "Wznów ostatnią sesję za pomocą -c lub wybierz dowolną sesję za pomocą -s.",
        },
        "same-opencode": {
          title: "Ten sam OpenCode",
          body: "Ten sam serwer, agenci i modele co w innych aplikacjach.",
        },
        agents: {
          title: "Agenci",
          body: "Zmieniaj agentów prosto z promptu.",
        },
        compact: {
          title: "Kompaktowanie",
          body: "Skróć długą sesję poleceniem /compact.",
        },
      },
    },
  },
  extensionCard: {
    name: "Rozszerzenia",
    body: "Używaj OpenCode w VS Code lub przez ACP w Zed i innych edytorach.",
    action: "Zainstaluj",
  },
  extensions: {
    browse: {
      name: "Browse",
      body: "Pozwól agentom korzystać z Twojej przeglądarki.",
      title: "OpenCode | Browse – Twoja przeglądarka dla agentów kodujących",
      description:
        "Browse pozwala OpenCode i innym klientom MCP korzystać z Twojej przeglądarki. Agenci czytają strony, klikają, wpisują tekst, robią zrzuty ekranu i nagrywają karty. Gdy trzeba się zalogować lub przejść 2FA, przekazują Ci kartę.",
      intro:
        "Serwer MCP i rozszerzenie Chromium pozwalają agentom korzystać z Twojej własnej przeglądarki, wraz z kartami, aktywnymi logowaniami i rozszerzeniami. Agenci otwierają karty w grupach w tle, czytają strony, klikają, wpisują tekst, robią zrzuty ekranu i nagrywają karty. Gdy trzeba się zalogować, przejść 2FA lub zapłacić, przekazują Ci kartę i wznawiają pracę po kliknięciu Continue.",
      features: {
        "your-real-browser": {
          title: "Twoja przeglądarka",
          body: "Chrome, Edge, Brave, Arc, Helium, Vivaldi, Opera i Chromium.",
        },
        "out-of-your-way": {
          title: "Karty w tle",
          body: "Karty agentów otwierają się w tle, w zwiniętych grupach.",
        },
        handoffs: {
          title: "Przejmij kartę",
          body: "Zaloguj się lub przejdź weryfikację 2FA, a potem kliknij Continue.",
        },
        "lend-a-tab": {
          title: "Udostępnij kartę",
          body: "Kliknij przycisk na pasku, aby przekazać agentowi otwartą kartę.",
        },
        "record-and-capture": {
          title: "Nagrania i zrzuty",
          body: "Zrzuty ekranu, nagrania kart i ruch sieciowy.",
        },
        "any-mcp-client": {
          title: "Każdy klient MCP",
          body: "OpenCode, Claude Code, Cursor, Codex, Zed i wiele innych.",
        },
        "all-your-logins": {
          title: "Twoje aktywne logowania",
          body: "Agenci korzystają ze stron, na których masz już aktywne logowanie. Bez kluczy i konfiguracji.",
        },
        "allowed-sites": {
          title: "Dozwolone strony",
          body: "Ogranicz dostęp agenta w karcie do wskazanych stron.",
        },
      },
      install:
        "Najpierw zainstaluj [rozszerzenie Chrome]. Przeprowadzi Cię przez kolejne kroki. Jeśli mimo wszystko musisz zainstalować CLI bezpośrednio, użyj jednego z tych poleceń.",
    },
  },
  apps: {
    browse: {
      category: "Sterowanie przeglądarką dla agentów",
      body: "Pozwól agentowi korzystać z Twojej przeglądarki, aktywnych logowań i kart.",
    },
    hex: {
      category: "Dyktowanie głosowe",
      body: "Dyktowanie głosowe na urządzeniu w każdej aplikacji.",
    },
    opentunnel: {
      category: "Tunele lokalne",
      body: "Publiczne adresy HTTPS dla lokalnych aplikacji.",
    },
    opentui: {
      category: "Biblioteka",
      body: "Biblioteka do interfejsów terminalowych.",
    },
  },
  getStarted: {
    title: "Zacznij",
    lead: "Najłatwiej zacząć od pobrania OpenCode i użycia darmowych modeli. Nie potrzebujesz konta. Jeśli chcesz więcej, skorzystaj z własnej subskrypcji lub wybierz OpenCode Go.",
    phrases: {
      "download-opencode": {
        text: "pobrania OpenCode",
      },
      "free-models": {
        text: "darmowych modeli",
      },
      "your-own-subscription": {
        text: "własnej subskrypcji",
      },
      "a-subscription-you-already-have": {
        text: "subskrypcji, którą już masz",
      },
      "opencode-go": {
        text: "OpenCode Go",
      },
    },
    subscriptions: {
      "chatgpt-plus-pro": {
        name: "ChatGPT Plus/Pro",
      },
      "github-copilot": {
        name: "GitHub Copilot",
      },
    },
    plans: {
      "opencode-go": {
        name: "OpenCode Go",
      },
      "opencode-go-plus": {
        name: "OpenCode Go Plus",
      },
    },
    steps: {
      download: {
        title: "Pobierz",
        line: "Desktop, terminal lub telefon.",
      },
      "use-free-models": {
        title: "Używaj darmowych modeli",
        line: "OpenCode ma zestaw darmowych modeli. Konto nie jest potrzebne.",
      },
      "add-more-models": {
        title: "Więcej modeli",
        line: "Skorzystaj z własnej subskrypcji lub z wybranych modeli OpenCode Go od $10 miesięcznie.",
      },
    },
    sentence:
      "Pobierz OpenCode, zacznij od darmowych modeli, a gdy zechcesz więcej, użyj własnej subskrypcji lub OpenCode Go.",
  },
  byos: {
    title: "Twoja subskrypcja",
    headline: "Korzystaj z subskrypcji, które już masz.",
    line: "Zaloguj się przez ChatGPT Plus lub Pro albo GitHub Copilot. Możesz też wybrać subskrypcję OpenCode.",
    yours: {
      label: "Twoja subskrypcja",
      items: {
        "chatgpt-plus-pro": {
          name: "ChatGPT Plus/Pro",
        },
        "github-copilot": {
          name: "GitHub Copilot",
        },
      },
    },
    planLinks: ["subskrypcję OpenCode", "OpenCode Go"],
    ours: {
      label: "Plany OpenCode",
    },
  },
  brand: {
    hero: {
      copy: {
        text: "Zasady dla agenta",
        copied: "Skopiowano",
      },
    },
    naming: {
      title: "Nazwa",
      body: "Pisz OpenCode jako jedno słowo, z wielkim O i wielkim C. Nie pisz Opencode, Open Code, OpenCode AI ani Open-Code.",
      code: "Zapisu `opencode` małymi literami używaj tylko w kodzie i nazwach pakietów, takich jak `opencode-figma` czy `@acme/opencode-plugin`.",
    },
    families: {
      logo: {
        title: "Logo",
        body: "Samo logo sprawdzi się w ikonach aplikacji, awatarach i wszędzie tam, gdzie jest mało miejsca. Wersje kwadratowe mają margines na wypadek kadrowania do kwadratu.",
        assets: {
          light: {
            name: "Jasne",
          },
          dark: {
            name: "Ciemne",
          },
          "square-light": {
            name: "Jasne, kwadratowe",
          },
          "square-dark": {
            name: "Ciemne, kwadratowe",
          },
        },
      },
      wordmark: {
        title: "Logotyp",
        body: "Pełna nazwa zapisana charakterystycznymi literami OpenCode. Używaj logotypu, gdy masz miejsce na całą nazwę.",
        assets: {
          light: {
            name: "Jasny",
          },
          dark: {
            name: "Ciemny",
          },
        },
      },
      "simple-wordmark": {
        title: "Prosty logotyp",
        body: "Jednokolorowy logotyp do druku, haftu i wszędzie tam, gdzie można użyć tylko jednego koloru.",
        assets: {
          light: {
            name: "Jasny",
          },
          dark: {
            name: "Ciemny",
          },
        },
      },
    },
    icons: {
      title: "Awatary",
      body: "Kwadratowe awatary 1024 px do profili w Slack, Discord, GitHub i innych serwisach. Tło wypełnia cały kwadrat, a logo mieści się z zapasem w okręgu, więc kadrowanie do koła go nie przytnie.",
      items: {
        dark: {
          name: "Ciemny",
        },
        light: {
          name: "Jasny",
        },
      },
    },
    colors: {
      title: "Kolory",
      body: "Logo i logotyp używają jednego koloru w trzech stopniach krycia, z jaśniejszym kolorem na ciemne tła. Wartości poniżej to kolory użyte w standardowych plikach. Używaj ich wyłącznie w logo i logotypie, nie w innych tekstach ani tłach. Kliknij wartość, aby ją skopiować.",
      palettes: {
        light: {
          name: "Jasna",
          swatches: {
            ink: {
              name: "Kolor",
              use: "Obrys logo i litery „code”.",
            },
            "ink-70": {
              name: "Kolor 70%",
              use: "Litery „open”.",
              ink: "Kolor przy 70% krycia.",
            },
            "ink-20": {
              name: "Kolor 20%",
              use: "Wewnętrzny odcień logo.",
              ink: "Kolor przy 20% krycia.",
            },
          },
        },
        dark: {
          name: "Ciemna",
          swatches: {
            ink: {
              name: "Kolor",
              use: "Obrys logo i litery „code”.",
            },
            "ink-72": {
              name: "Kolor 72%",
              use: "Litery „open”.",
              ink: "Kolor przy 72% krycia.",
            },
            "ink-28": {
              name: "Kolor 28%",
              use: "Wewnętrzny odcień logo.",
              ink: "Kolor przy 28% krycia.",
            },
          },
        },
      },
    },
    variants: {
      title: "Warianty",
      body: "Wybierz wersję, przy której logo jest wyraźne na Twoim tle, ciemną na jasnych tłach i jasną na ciemnych. Logo i logotyp to osobne pliki, więc używaj jednego albo drugiego.",
      groups: {
        default: {
          name: "Domyślny",
          body: "Logo do użycia prawie wszędzie. Jego wewnętrzny odcień jest przezroczysty. Na bieli i czerni wygląda dokładnie jak dwutonowe szarości, a na zdjęciach, gradientach i kolorach prześwituje tło.",
          rows: {
            logo: {
              title: "Logo",
              tiles: {
                dark: {
                  name: "Ciemne",
                },
                light: {
                  name: "Jasne",
                },
              },
            },
            wordmark: {
              title: "Logotyp",
              tiles: {
                dark: {
                  name: "Ciemny",
                },
                light: {
                  name: "Jasny",
                },
              },
            },
          },
        },
        simple: {
          name: "Prosty",
          body: "Jeden kolor, z otwartymi światłami liter i bez wewnętrznego odcienia. Używaj tego wariantu na jednolitych kolorowych tłach, w druku jednokolorowym i wszędzie tam, gdzie szarości się nie sprawdzą. Na jasnym tle wybierz ciemny wariant, a na ciemnym jasny.",
          rows: {
            wordmark: {
              title: "Logotyp",
              tiles: {
                dark: {
                  name: "Ciemny",
                },
                light: {
                  name: "Jasny",
                },
              },
            },
          },
        },
      },
    },
    usage: {
      title: "Zasady użycia",
      body: "Używaj jasnych wersji na jasnych tłach i ciemnych wersji na ciemnych tłach. Logo i logotyp są osobne. Używaj jednego albo drugiego, nigdy obu razem.",
      stroke: {
        title: "Jedna kreska",
        body: "Odstępy na tej stronie mierzymy w kreskach. Jedna kreska to grubość obrysu logo, czyli jedna czwarta jego szerokości, więc logo ma 4 kreski szerokości i 5 kresek wysokości.",
      },
      clearSpace: {
        title: "Pole ochronne",
        body: "Zostaw co najmniej dwie kreski odstępu z każdej strony logo i logotypu. W logo kreska to grubość obrysu, jedna czwarta szerokości. W logotypie to grubość liter, jedna siódma wysokości.",
      },
      pixels: {
        title: "Siatka pikseli",
        body: "Logo ma stałe proporcje 4:5, a jedna kreska to jedna czwarta jego szerokości. Skaluj je co 4 × 5 px, tak aby każda krawędź i kreska pokrywała się z siatką pikseli.",
        do: "wyrównuj każdą krawędź i kreskę o grubości 4 px do siatki pikseli.",
        dont: "zmieniaj proporcji 4:5, bo krawędzie wypadną między pikselami i się rozmyją.",
        sizes: {
          logo: {
            title: "Logo",
          },
          wordmark: {
            title: "Logotyp",
          },
        },
      },
      minimumTitle: "Minimalne rozmiary",
      minimum: {
        logo: {
          title: "Logo",
          body: "Co najmniej 16 × 20px, z kreską 4px. Mniejsze się rozmywa.",
        },
        wordmark: {
          title: "Logotyp",
          body: "Co najmniej 117 × 21px, z kreską 3px. Mniejszy się rozmywa.",
        },
      },
    },
    donts: {
      title: "Nie",
      body: "Częste błędy, których warto unikać przy używaniu logo i logotypu.",
      examples: {
        "two-tone": {
          caption: "zmieniaj kolorów logo.",
        },
        bright: {
          caption: "używaj jednego jaskrawego koloru.",
        },
        gradient: {
          caption: "wypełniaj logo gradientem.",
        },
        inverted: {
          caption: "zamieniaj odcieni miejscami.",
        },
        stretch: {
          caption: "rozciągaj ani spłaszczaj logo.",
        },
        shadow: {
          caption: "dodawaj cieni.",
        },
        glow: {
          caption: "dodawaj poświaty ani obrysów.",
        },
        lockup: {
          caption: "stawiaj innych słów obok logo.",
        },
        "low-contrast": {
          caption: "używaj szarego na szarym przy niskim kontraście.",
        },
        color: {
          caption: "umieszczaj dwutonowego szarego logo na kolorowym tle, bo odcienie szarości tracą na wyrazistości.",
        },
      },
    },
    integrations: {
      title: "Integracje",
      body: "Za pomocą odznaki lub zestawienia logotypów pokaż, że Twój plugin, narzędzie lub usługa współpracują z OpenCode albo że Twój projekt z niego korzysta. Nazwij projekt tak, by było jasne, że jest Twój.",
      badges: {
        body: "Umieść odznakę w README, dokumentacji lub na stronie i ustaw odsyłacz do opencode.ai. Dobierz jasny lub ciemny plik do tła (HTML przełącza wersje automatycznie). Nie zmieniaj kolorów ani tekstu.",
        sizes: "Każdy styl jest dostępny w rozmiarach 20, 32 i 44 px (Shields tylko 20 px), w formacie SVG i jako PNG w skali 2×.",
        mono: "Każdy plik ma też wersję z napisem krojem OpenMono. Dodaj -mono przed rozszerzeniem, np. opencode-works-with-a-light-20-mono.svg, lub -mono-caps, jeśli chcesz napis wielkimi literami.",
        groups: {
          "works-with": {
            title: "Działa z",
            alt: "Działa z OpenCode",
            body: "Dla pluginów, dostawców i narzędzi, które działają z OpenCode.",
          },
          "built-with": {
            title: "Zbudowane z",
            alt: "Zbudowane z OpenCode",
            body: "Dla projektów stworzonych z OpenCode.",
          },
        },
        styles: {
          a: {
            name: "Ramka",
          },
          c: {
            name: "Komórki",
          },
          f: {
            name: "Pełny",
          },
          g: {
            name: "Shields",
          },
        },
      },
      lockup: {
        title: "Zestawienie logo partnerów",
        body: "Umieść logo OpenCode obok logo partnera i oddziel je znakiem ×. Zostaw po 3 kreski odstępu z obu stron znaku. Dobierz rozmiar logo partnera tak, by optycznie miało tę samą wysokość co logo OpenCode. Zachowaj pole ochronne wokół całości.",
        partners: {
          github: {
            name: "GitHub",
          },
        },
      },
      naming: {
        title: "Nazwa projektu",
        body: "Zacznij od własnej nazwy, aby było jasne, że projekt jest Twój.",
        rule: "Pisz `Linear for OpenCode` albo nazwij pakiet `opencode-linear`. Nie pisz `OpenCode Linear` ani `Linear by OpenCode`.",
      },
    },
    trademarks: {
      title: "Znaki towarowe",
      body: "OpenCode i logo OpenCode są znakami towarowymi Anomaly. Nie używaj ich, aby sugerować, że Anomaly Cię popiera lub sponsoruje, w nazwie produktu czy firmy ani na gadżetach bez zgody.",
      contact: {
        before: "W razie pytań napisz na ",
        after: ".",
      },
    },
  },
  press: {
    title: "OpenCode | Materiały prasowe, informacje o firmie i zasoby marki",
    description:
      "Materiały prasowe OpenCode: informacje o OpenCode i firmie Anomaly, logo i logotypy do pobrania oraz kontakt dla prasy.",
    hero: {
      title: "Prasa",
      body: "Informacje, zasoby marki i kontakty dla osób piszących o OpenCode i Anomaly.",
    },
    company: {
      title: "O Anomaly",
      lead: "Anomaly to firma, która stoi za OpenCode. Tworzy narzędzia open source dla programistów.",
      more: "Pozostałe projekty, m.in. SST i OpenTUI, mają otwarty kod dostępny na [GitHub](github).",
      learnMore: "Więcej informacji znajdziesz na [anoma.ly](site).",
      projects: {
        opencode: {
          name: "OpenCode",
          body: "Agent do programowania z otwartym kodem źródłowym, dostępny jako aplikacja desktopowa, terminalowa i mobilna oraz SDK. Licencja MIT i ponad 220 000 gwiazdek na GitHubie.",
        },
        sst: {
          name: "SST",
          body: "Framework do budowania aplikacji full-stack na własnej infrastrukturze. Otwarty kod od 2020 r., licencja MIT i ponad 26 000 gwiazdek na GitHubie.",
        },
        opentui: {
          name: "OpenTUI",
          body: "Biblioteka do interfejsów terminalowych w TypeScript, React lub Solid, z rdzeniem w Zig. OpenCode używa jej produkcyjnie. Ponad 13 000 gwiazdek na GitHubie.",
        },
        "models-dev": {
          name: "Models.dev",
          body: "Baza open source ze specyfikacjami, cenami i możliwościami modeli AI, dostępna przez publiczne API. Zawiera ponad 8900 modeli od ponad 200 dostawców.",
        },
        hex: {
          name: "Hex",
          body: "Dyktowanie głosowe na Mac, Windows i Linux. Hex zamienia mowę na tekst na Twoim urządzeniu i wkleja go do dowolnej aplikacji. Dźwięk nigdy nie opuszcza urządzenia.",
        },
        opentunnel: {
          name: "OpenTunnel",
          body: "CLI i SDK, które nadają aplikacjom na Twoim komputerze publiczny URL HTTPS. Połączenie TLS kończy się na Twoim komputerze, więc serwer pośredniczący nigdy nie widzi danych w postaci jawnej.",
        },
      },
    },
    about: {
      title: "O OpenCode",
      body: "Opisy OpenCode i jego produktów w wersji długiej i krótkiej, gotowe do skopiowania.",
      boilerplate: {
        long: "OpenCode to agent do programowania z otwartym kodem źródłowym. Jest dostępny jako aplikacja desktopowa, interfejs terminalowy, aplikacja mobilna i SDK. Działa z modelami dowolnego dostawcy, w tym Claude, GPT i Gemini. Anomaly rozwija OpenCode na licencji MIT. Projekt ma ponad 220 000 gwiazdek na GitHubie i ponad 1000 współtwórców. Co miesiąc korzysta z niego ponad 22 mln programistów.",
        short:
          "OpenCode to agent do programowania z otwartym kodem źródłowym od Anomaly. Jest dostępny w aplikacji desktopowej, terminalu, na telefonie i przez SDK.",
      },
      products: {
        "opencode-console": {
          name: "OpenCode Console",
          long: "OpenCode Console to aplikacja webowa, w której programiści i zespoły kupują dostęp do modeli AI dla OpenCode i innych agentów kodujących oraz nim zarządzają. Oferuje subskrypcje OpenCode Go oraz inferencję z najnowocześniejszymi modelami i modelami z otwartymi wagami. W rozliczeniu za użycie opłata za każde żądanie jest pobierana z wcześniej doładowanego salda. Zespoły mają do dyspozycji obszary robocze z rolami Member, Admin i Owner, limity wydatków dla obszaru roboczego i poszczególnych użytkowników, logowanie jednokrotne przez Okta, Microsoft Entra ID lub Google Workspace oraz SCIM. Console obsługuje ponad 30 dostawców, więc zespoły mogą podłączyć swoje dotychczasowe konta. Inferencja OpenCode jest opcjonalna. Adres: opencode.ai/console.",
          short:
            "OpenCode Console to aplikacja webowa Anomaly. Oferuje dostęp do modeli AI z rozliczeniem za użycie, subskrypcje OpenCode Go i funkcje dla zespołów, takie jak budżety i logowanie jednokrotne.",
        },
        "opencode-go": {
          name: "OpenCode Go",
          long: "OpenCode Go to subskrypcja dla programistów, którzy wolą stałą miesięczną opłatę za dostęp do modeli do programowania. Go kosztuje $10 miesięcznie, Go Plus z wyższymi limitami kosztuje $40 miesięcznie, a Go Teams $20 miesięcznie za członka. Każdy plan obejmuje wybrane modele przetestowane z myślą o agentach kodujących. Limit miesięczny dla każdego modelu jest wyrażony w dolarach. W oknach kroczących limit wynosi 20% miesięcznej kwoty na 5 godzin i 50% na tydzień. Subskrybenci mogą doładować saldo, z którego pobierane są opłaty za użycie poza limitem, i zrezygnować w każdej chwili. Go działa z OpenCode i innymi agentami. Adres: opencode.ai/console/go.",
          short:
            "OpenCode Go to miesięczna subskrypcja Anomaly dla programistów. Obejmuje wybrane modele do programowania z miesięcznymi limitami użycia. Cena od $10 miesięcznie.",
        },
        "opencode-data": {
          name: "OpenCode Data",
          long: "OpenCode Data to publiczny dashboard, który pokazuje, jakich modeli AI programiści używają w OpenCode i jak ta struktura zmienia się w czasie. Publikuje ranking najpopularniejszych modeli, zużycie tokenów, koszty sesji i tokenów, współczynniki cache, udziały w rynku i podział na kraje. Dane są agregowane co godzinę, z dniami i tygodniami w UTC. Liczby użytkowników i sesji są przybliżone, a koszty opierają się na cenach katalogowych z katalogu modeli OpenCode. Dziennikarze mogą cytować go jako OpenCode Data (opencode.ai/data) z godziną aktualizacji podaną na stronie.",
          short:
            "OpenCode Data to publiczny dashboard pod adresem opencode.ai/data, który szereguje modele AI według rzeczywistego użycia w OpenCode, z tokenami, kosztami i udziałami w rynku aktualizowanymi co godzinę.",
        },
      },
    },
    facts: {
      title: "W skrócie",
      items: {
        license: {
          label: "Licencja",
        },
        "first-release": {
          label: "Pierwsze wydanie",
        },
        "made-by": {
          label: "Twórca",
        },
      },
    },
    milestones: {
      title: "Kamienie milowe",
      items: {
        "first-release-v0-0-1": {
          date: "Kwi 2025",
          text: "Pierwsze wydanie, v0.0.1",
        },
        "1-million-downloads": {
          date: "Paź 2025",
          text: "1 mln+ pobrań",
        },
        "opencode-1-0": {
          date: "Paź 2025",
          text: "OpenCode 1.0",
        },
        "desktop-app-ships": {
          date: "Gru 2025",
          text: "Premiera aplikacji Desktop",
        },
        "10-million-downloads": {
          date: "Sty 2026",
          text: "10 mln+ pobrań",
        },
        "opencode-2-0": {
          date: "Wrz 2026",
          text: "OpenCode 2.0",
        },
        "220-000-github-stars": {
          date: "Lis 2026",
          text: "220 000+ gwiazdek na GitHubie",
        },
      },
    },
    news: {
      title: "Najnowsze wydania",
      intro: "Często wydajemy nowe wersje OpenCode. Oto najnowsze wydania, które wprowadzają nowe funkcje.",
      changelog: {
        text: "Dziennik zmian",
      },
      feed: {
        text: "Kanał RSS",
      },
    },
    media: {
      title: "Media",
      intro:
        "Zrzuty i krótkie filmy każdej aplikacji, nagrane z prawdziwego produktu. Możesz ich używać, pisząc o OpenCode.",
      note: "Wszystkie nagrania używają ciemnego motywu. Zrzuty i okładki to pliki JPG do 1920 × 1080 lub 1080 × 1350 w pionie. Filmy to klipy MP4 bez dźwięku.",
      products: {
        desktop: {
          name: "Desktop",
          items: {
            "locked-landscape": {
              title: "Film Desktop",
            },
            "frame-1": {
              title: "Zrzut Desktop 1",
            },
            "frame-2": {
              title: "Zrzut Desktop 2",
            },
            "frame-3": {
              title: "Zrzut Desktop 3",
            },
            "frame-4": {
              title: "Zrzut Desktop 4",
            },
            "feature-1": {
              title: "Równoległa praca agentów",
            },
            "feature-2": {
              title: "Zobacz w przeglądarce",
            },
            "feature-3": {
              title: "Na każdym urządzeniu",
            },
            "locked-portrait": {
              title: "Film Desktop, pion",
            },
          },
        },
        mobile: {
          name: "Mobile",
          items: {
            "locked-landscape": {
              title: "Film Mobile",
            },
            "frame-1": {
              title: "Zrzut Mobile 1",
            },
            "frame-2": {
              title: "Zrzut Mobile 2",
            },
            "frame-3": {
              title: "Zrzut Mobile 3",
            },
            "feature-1": {
              title: "Głos",
            },
            "feature-2": {
              title: "Sesje",
            },
            "feature-3": {
              title: "Wyniki",
            },
            "locked-portrait": {
              title: "Film Mobile, pion",
            },
          },
        },
        terminal: {
          name: "Terminal",
          items: {
            "locked-landscape": {
              title: "Film Terminal",
            },
            "frame-1": {
              title: "Zrzut Terminal 1",
            },
            "frame-2": {
              title: "Zrzut Terminal 2",
            },
            "frame-3": {
              title: "Zrzut Terminal 3",
            },
            "frame-4": {
              title: "Zrzut Terminal 4",
            },
            "feature-1": {
              title: "Pisz zwykłymi słowami",
            },
            "feature-2": {
              title: "Zatwierdzaj polecenia",
            },
            "feature-3": {
              title: "Po swojemu",
            },
            "locked-portrait": {
              title: "Film Terminal, pion",
            },
          },
        },
        sdk: {
          name: "SDK",
          items: {
            "locked-landscape": {
              title: "Film SDK",
            },
            "frame-1": {
              title: "Zrzut SDK 1",
            },
            "frame-2": {
              title: "Zrzut SDK 2",
            },
            "frame-3": {
              title: "Zrzut SDK 3",
            },
            "frame-4": {
              title: "Zrzut SDK 4",
            },
            "feature-1": {
              title: "Napraw CI z kodu",
            },
            "feature-2": {
              title: "Śledź każdy krok",
            },
            "feature-3": {
              title: "Twórz własne narzędzia",
            },
            "locked-portrait": {
              title: "Film SDK, pion",
            },
          },
        },
      },
    },
    people: {
      title: "Ludzie",
    },
    anomalyLogo: {
      title: "Logo Anomaly",
      body: "Znak i logotyp Anomaly, w czerni i bieli. Pliki PNG mają 2048 px szerokości.",
      assets: {
        "mark-black": {
          name: "Znak, czarny",
        },
        "mark-white": {
          name: "Znak, biały",
        },
        "wordmark-black": {
          name: "Logotyp, czarny",
        },
        "wordmark-white": {
          name: "Logotyp, biały",
        },
      },
      avatars: {
        body: "Kwadratowe awatary dla X, GitHuba, Slacka, LinkedIna i innych profili. Znak leży głęboko w okręgu, więc przetrwa okrągłe przycięcie. Pliki PNG mają 1024 i 400 px szerokości.",
        items: {
          "avatar-dark": { name: "Awatar, ciemny" },
          "avatar-light": { name: "Awatar, jasny" },
        },
      },
      all: {
        text: "Pobierz wszystko",
      },
    },
    coverage: {
      title: "W mediach",
    },
    brand: {
      title: "Marka",
      before:
        "Pobierz logo i logotypy OpenCode w jednym pliku ZIP. Pojedyncze pliki, warianty i zasady użycia znajdziesz na ",
      link: {
        text: "stronie marki",
      },
      after: ".",
      usage:
        "Możesz używać tych plików, pisząc o OpenCode. Nie zmieniaj ich i nie sugeruj, że OpenCode popiera Twoją pracę.",
    },
    product: {
      title: "Produkt",
      items: {
        desktop: {
          name: "Desktop",
          body: "Uruchamiaj kilku agentów naraz, każdego w osobnej karcie, na macOS, Windows i Linux. Przeglądaj każdą zmianę jako diff i oglądaj podgląd.",
        },
        mobile: {
          name: "Mobile",
          body: "Najnowsza aplikacja OpenCode. Połącz się głosowo z agentem w sesji, a potem przeglądaj i zatwierdzaj jego zmiany z telefonu, gdziekolwiek jesteś.",
        },
        terminal: {
          name: "Terminal",
          body: "Interfejs terminalowy, który działa w każdej powłoce, edytorze i na zdalnym serwerze. Oglądaj każdą edycję jako diff i wybieraj, które polecenia uruchamiają się same.",
        },
        sdk: {
          name: "SDK",
          body: "Typowany klient TypeScript dla skryptów, zadań CI i Twoich narzędzi. Twórz sesje, wysyłaj prompty i strumieniuj każde zdarzenie na bieżąco.",
        },
      },
    },
    contact: {
      title: "Kontakt",
      items: {
        press: {
          title: "Prasa",
          body: "Dla dziennikarzy i analityków. Odpowiadamy tylko na zapytania mediów.",
        },
        support: {
          title: "Pomoc",
          body: "Aby uzyskać pomoc z OpenCode, dodaj zgłoszenie lub zapytaj społeczność. W sprawie konta i rozliczeń napisz do nas.",
          links: {
            "github-issues": {
              text: "Zgłoszenia na GitHubie",
            },
            "help-anoma-ly": {
              text: "help@anoma.ly",
            },
          },
        },
        security: {
          title: "Bezpieczeństwo",
          body: "Zgłoś podatność przez GitHub. Jeśli nikt nie odpowie w ciągu 6 dni roboczych, napisz do nas.",
          links: {
            "report-a-vulnerability": {
              text: "Zgłoś podatność",
            },
            "security-anoma-ly": {
              text: "security@anoma.ly",
            },
          },
        },
      },
    },
  },
  download: {
    desktop: {
      title: "Desktop",
    },
    mobile: {
      title: "Mobile",
      stores: {
        "google-play": {
          label: "Google Play",
          device: "Android",
        },
      },
    },
    terminal: {
      title: "Terminal",
      installs: {
        curl: {
          name: "Skrypt",
        },
      },
    },
    extensions: {
      title: "Rozszerzenia",
      items: {
        "vs-code": {
          label: "VS Code",
        },
        cursor: {
          label: "Cursor",
        },
        zed: {
          label: "Zed",
        },
        windsurf: {
          label: "Windsurf",
        },
        vscodium: {
          label: "VSCodium",
        },
      },
    },
    faq: {
      items: {},
    },
  },
  productDownloads: {
    sdk: {
      more: {
        label: "Czytaj dokumentację SDK",
      },
    },
    mini: {
      lead: "Mini jest częścią OpenCode CLI. Zainstaluj go dowolnym z tych sposobów, a potem uruchom opencode mini.",
      commands: {
        curl: {
          name: "Skrypt",
        },
      },
    },
    terminal: {
      commands: {
        curl: {
          name: "Skrypt",
        },
      },
    },
  },
  pair: {
    title: "Połącz telefon",
    cardTitle: "Sparuj telefon jednym poleceniem",
    intro:
      "OpenCode Mobile pozwala zdalnie sterować OpenCode na Twoim komputerze. Sesje nadal działają na komputerze. W aplikacji możesz je przeglądać i nimi sterować.",
    steps: {
      "get-the-app": {
        title: "Pobierz aplikację",
        body: "Zainstaluj OpenCode na iPhonie z App Store lub na telefonie z systemem Android z Google Play.",
      },
      "run-this-on-your-computer": {
        title: "Uruchom polecenie na komputerze",
        body: "Polecenie wyświetli jednorazowy link i kod QR. Możesz użyć ich tylko raz, w ciągu 5 minut.",
      },
      "scan-the-code": {
        title: "Zeskanuj kod",
        body: "Zeskanuj kod QR w aplikacji albo wklej link. Ostatnie sesje z komputera otworzą się na telefonie.",
      },
    },
    note: "--remote łączy się przez adres OpenTunnel, więc działa z każdej sieci. W tej samej sieci Wi-Fi uruchom raz opencode service set hostname 0.0.0.0, a potem opencode pair.",
    facts: [
      "Parowanie działa z każdej sieci, bo --remote łączy się przez adres OpenTunnel.",
      "Link i kod działają raz i wygasają po 5 minutach.",
      "Komputer musi być włączony, bo agent działa na nim, a nie na telefonie.",
      "W tej samej sieci Wi-Fi uruchom raz opencode service set hostname 0.0.0.0, a potem opencode pair.",
    ],
  },
} satisfies ContentOverlay
