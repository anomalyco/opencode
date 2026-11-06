import type { ContentOverlay } from "./source"

export const content = {
  products: {
    desktop: {
      name: "Desktop",
      body: "Sesiones, pestañas, diffs, navegador integrado y extensiones en macOS, Windows y Linux.",
      action: "Descargar",
    },
    mobile: {
      name: "Mobile",
      body: "Inicia, guía y aprueba sesiones desde el móvil, estés donde estés.",
      action: "Descargar",
    },
    terminal: {
      name: "Terminal",
      body: "Una interfaz de terminal rápida que funciona en cualquier shell, editor o servidor remoto.",
      action: "Instalar",
    },
    sdk: {
      body: "Controla OpenCode desde tus scripts, jobs de CI y herramientas.",
      action: "Ver docs",
    },
    ide: {
      name: "Extensiones IDE",
      body: "Abre OpenCode en VS Code, Cursor y Windsurf, o en Zed y los IDE de JetBrains mediante ACP.",
      action: "Instalar",
    },
    mini: {
      body: "Una interfaz de terminal mínima. Las respuestas se imprimen en tu historial, con un solo prompt debajo.",
      action: "Instalar",
    },
  },
  productDetails: {
    desktop: {
      title: "OpenCode | App de escritorio para macOS, Windows y Linux",
      description:
        "Ejecuta varios agentes de OpenCode a la vez, cada uno en su pestaña. Revisa cada cambio como diff, comenta cualquier línea y previsualiza el resultado en el navegador integrado.",
      intro:
        "Ejecuta varios agentes a la vez, cada sesión en su propia pestaña. Revisa cada cambio como diff, comenta cualquier línea y comprueba el resultado en el navegador integrado. Para macOS, Windows y Linux.",
      features: {
        "built-in-terminal": {
          title: "Terminal integrada",
          body: "Ejecuta comandos en una pestaña de terminal junto a la sesión.",
        },
        "ssh-servers": {
          title: "Servidores SSH",
          body: "Conéctate a otra máquina por SSH y trabaja en sus proyectos.",
        },
        extensions: {
          title: "Extensiones",
          body: "Gestiona servidores MCP, plugins y skills en un solo menú.",
        },
        wsl: {
          title: "WSL",
          body: "En Windows, ejecuta las sesiones en una distro de WSL 2 en lugar de en nativo.",
        },
        "office-files": {
          title: "Archivos Office",
          body: "Abre archivos de Word, Excel y PowerPoint junto a la sesión.",
        },
        "keyboard-shortcuts": {
          title: "Atajos de teclado",
          body: "Cada acción tiene un atajo de teclado, y puedes cambiar cualquiera.",
        },
        "updates-itself": {
          title: "Se actualiza sola",
          body: "Las nuevas versiones se descargan e instalan desde la app.",
        },
        "all-your-projects": {
          title: "Todos tus proyectos",
          body: "Cambia entre proyectos y sus sesiones en una sola ventana.",
        },
      },
      showcase: {
        "sessions-in-tabs": {
          title: "Sesiones en pestañas",
          body: "Pon a trabajar varios agentes a la vez, cada sesión en su pestaña.",
        },
        "review-and-comment": {
          title: "Revisa y comenta",
          body: "Lee cada cambio como diff, comenta una línea y devuélvelo.",
        },
        "see-it-in-the-browser": {
          title: "Míralo en el navegador",
          body: "El trabajo del agente se abre en un navegador junto a la sesión según llega.",
        },
        "pair-your-phone": {
          title: "Vincula el móvil",
          body: "Escanea un código QR en OpenCode Mobile para guiar sesiones desde tu iPhone.",
        },
      },
    },
    mobile: {
      title: "OpenCode | Mobile, tus sesiones de programación en el móvil",
      description:
        "Inicia y dirige sesiones de OpenCode desde el móvil. Habla con el agente mientras se ejecuta en tu ordenador.",
      intro:
        "Inicia y dirige sesiones desde el móvil, estés donde estés. Llama a una sesión y habla con el agente, o abre cualquier sesión para continuar donde lo dejaste, todo con OpenCode en tu propio ordenador.",
      features: {
        "notify-when-done": {
          title: "Aviso al terminar",
          body: "Recibe un breve resumen cuando termina una sesión que iniciaste.",
        },
        "pair-from-anywhere": {
          title: "Vincula desde donde sea",
          body: "Conéctate desde cualquier red con opencode pair --remote.",
        },
        "every-computer": {
          title: "Cada ordenador",
          body: "Cambia entre los ordenadores vinculados con un toque.",
        },
        "siri-and-shortcuts": {
          title: "Siri y Atajos",
          body: "Inicia una llamada o una sesión desde Siri o el Centro de control.",
        },
        "follow-along": {
          title: "Síguelo en vivo",
          body: "Mira cómo se actualiza la línea de tiempo mientras el agente trabaja.",
        },
        "your-computer": {
          title: "Tu ordenador",
          body: "Se conecta a OpenCode en tu propia máquina.",
        },
        "share-sheet": {
          title: "Compartir",
          body: "Comparte lo que sea con una sesión sin abrir la app.",
        },
        "mute-sessions": {
          title: "Silenciar sesiones",
          body: "Mantén una sesión en tu lista sin recibir sus notificaciones.",
        },
      },
      showcase: {
        voice: {
          title: "Voz",
          body: "Llama a una sesión y di lo que necesitas. El agente responde en voz alta.",
        },
        sessions: {
          title: "Sesiones",
          body: "Abre cualquier sesión para ver cómo va y retómala donde la dejaste.",
        },
        steer: {
          title: "Guía",
          body: "Envía un mensaje para cambiar de rumbo a mitad de sesión.",
        },
        results: {
          title: "Resultados",
          body: "La llamada te cuenta qué ha cambiado cuando termina el trabajo que pediste.",
        },
      },
    },
    terminal: {
      title: "OpenCode | Interfaz de terminal del agente de código abierto",
      description:
        "Una interfaz de terminal rápida para OpenCode que funciona en cualquier shell, editor o servidor remoto. Describe lo que quieres, mira cada edición como diff y aprueba los comandos.",
      intro:
        "Una interfaz de terminal rápida que funciona en cualquier shell, editor o servidor remoto. Describe lo que quieres con tus palabras, mira cómo llega cada edición como diff y elige qué comandos se ejecutan solos.",
      features: {
        "any-terminal": {
          title: "Toda terminal",
          body: "Funciona en cualquier shell, en la terminal de tu editor o en un servidor remoto.",
        },
        "diffs-in-the-timeline": {
          title: "Diffs en la línea",
          body: "Mira cada edición como diff en la línea de tiempo, a medida que el agente la hace.",
        },
        "pick-up-later": {
          title: "Retoma luego",
          body: "Continúa la última sesión con -c, o cualquiera con -s.",
        },
        "one-off-runs": {
          title: "Ejecución única",
          body: "opencode run envía un mensaje e imprime la respuesta.",
        },
        "agents-and-commands": {
          title: "Agentes y comandos",
          body: "Cambia de agente con shift+tab y abre todos los comandos con ctrl+p.",
        },
        "auto-approve": {
          title: "Autoaprobar",
          body: "Ejecuta con --auto para permitir cualquier acción que no hayas denegado.",
        },
        "any-server": {
          title: "Todo servidor",
          body: "Conéctate a un servidor de OpenCode por URL con --server.",
        },
        "usage-stats": {
          title: "Estadísticas",
          body: "opencode stats muestra estadísticas de uso para compartir.",
        },
      },
      showcase: {
        "ask-in-plain-words": {
          title: "Pide con tus palabras",
          body: "Escribe lo que quieres y el agente muestra su plan mientras trabaja.",
        },
        "approve-what-runs": {
          title: "Aprueba lo que corre",
          body: "Las ediciones se muestran como diffs y los comandos esperan tu permiso.",
        },
        "make-it-yours": {
          title: "Hazlo tuyo",
          body: "Cambia de tema con una tecla, del predeterminado a tokyonight y más.",
        },
        mini: {
          title: "Mini",
          body: "Con opencode mini, las respuestas van a tu propio historial.",
        },
      },
    },
    sdk: {
      title: "OpenCode | SDK de TypeScript para scripts, jobs de CI y herramientas",
      description:
        "Controla OpenCode desde tus scripts, jobs de CI y herramientas. El cliente tipado de TypeScript crea sesiones, envía prompts y transmite cada evento al momento.",
      intro:
        "Controla OpenCode desde tus scripts, jobs de CI y herramientas. El SDK ejecuta OpenCode dentro de tu proceso, con tu configuración y tus modelos, y su cliente tipado crea sesiones, envía prompts y transmite cada evento.",
      features: {
        "typescript-client": {
          title: "Cliente TypeScript",
          body: "Peticiones y eventos tipados, con los mismos valores que @opencode/client.",
        },
        "sessions-from-code": {
          title: "Sesiones con código",
          body: "Crea sesiones y envía prompts desde cualquier script.",
        },
        "any-model": {
          title: "Todo modelo",
          body: "Usa los modelos que tenga configurados tu OpenCode.",
        },
        "npm-or-bun": {
          title: "npm o bun",
          body: "Instálalo con npm i @opencode/sdk o bun add @opencode/sdk.",
        },
        "in-process-host": {
          title: "Host en proceso",
          body: "Ejecuta OpenCode en memoria, sin pasar por la red.",
        },
        "your-plugins": {
          title: "Tus plugins",
          body: "Pasa tus propios plugins al crear el host en proceso.",
        },
        "promise-or-effect": {
          title: "Promise o Effect",
          body: "Una API de Promise y una API de Effect con los mismos valores.",
        },
        "cloudflare-workers": {
          title: "Cloudflare Workers",
          body: "Ejecuta OpenCode dentro de un Durable Object de Cloudflare en Workers.",
        },
      },
      showcase: {
        "fix-ci-from-code": {
          title: "Arregla la CI",
          body: "Un script corto pide a OpenCode corregir los tests fallidos y los repite.",
        },
        "follow-every-step": {
          title: "Sigue cada paso",
          body: "Transmite eventos para ver cada herramienta que llama el agente, al momento.",
        },
        "build-your-own-tools": {
          title: "Crea tus herramientas",
          body: "Integra OpenCode en bots, paneles y flujos de trabajo con unas pocas líneas.",
        },
        "in-your-process": {
          title: "En tu proceso",
          body: "Ejecuta OpenCode dentro de tu proceso, con tu configuración y modelos.",
        },
      },
    },
    ide: {
      title: "OpenCode | Integraciones de editor para VS Code, Cursor y Zed",
      description:
        "Usa OpenCode dentro de tu editor, con la extensión para VS Code, Cursor, Windsurf y VSCodium, y opencode acp para Zed, los IDE de JetBrains y otros editores ACP.",
      intro:
        "Usa OpenCode dentro de tu editor. En VS Code, Cursor, Windsurf y VSCodium, ejecuta opencode en la terminal integrada y la extensión se instala sola. Zed, los IDE de JetBrains y otros editores compatibles con el Agent Client Protocol ejecutan OpenCode con opencode acp.",
      features: {
        "quick-launch": {
          title: "Inicio rápido",
          body: "Cmd+Esc o Ctrl+Esc abre OpenCode en una terminal dividida.",
        },
        "new-session": {
          title: "Nueva sesión",
          body: "Cmd+Shift+Esc o Ctrl+Shift+Esc inicia otra sesión.",
        },
        context: {
          title: "Contexto",
          body: "Comparte tu selección o pestaña actual con OpenCode.",
        },
        "file-references": {
          title: "Citar archivos",
          body: "Cmd+Option+K o Alt+Ctrl+K inserta @File#L37-42.",
        },
        "installs-itself": {
          title: "Se instala sola",
          body: "Ejecuta opencode en la terminal integrada para añadirla.",
        },
        "acp-editors": {
          title: "Editores ACP",
          body: "Zed, IDE de JetBrains, Avante.nvim y CodeCompanion.nvim.",
        },
        "open-vsx": {
          title: "Open VSX",
          body: "También en Open VSX para Cursor, Windsurf y VSCodium.",
        },
        "same-agent": {
          title: "Mismo agente",
          body: "El OpenCode que usas en la terminal, junto a tu código.",
        },
      },
    },
    mini: {
      title: "OpenCode | Mini, una interfaz de terminal mínima para el agente",
      description:
        "Mini ejecuta OpenCode en una interfaz de terminal mínima. Las respuestas se imprimen en el historial de tu terminal, y abajo solo quedan un prompt y una línea de estado.",
      intro:
        "Una interfaz de terminal mínima para OpenCode. Ejecuta opencode mini y las respuestas se imprimen directamente en el historial de tu terminal, para desplazarte, buscar y copiarlas como cualquier otra salida. Abajo solo quedan el prompt y una línea de estado.",
      features: {
        "your-scrollback": {
          title: "Tu historial",
          body: "Las respuestas pasan a ser historial normal de la terminal.",
        },
        "one-prompt": {
          title: "Un solo prompt",
          body: "Agente, modelo, contexto y coste en una línea de estado.",
        },
        permissions: {
          title: "Permisos",
          body: "Permite ediciones y comandos desde la zona del prompt.",
        },
        "how-much-shows": {
          title: "Cuánto se ve",
          body: "Discreto, predeterminado o todo, para el razonamiento y la salida de herramientas.",
        },
        "pick-up-later": {
          title: "Retoma luego",
          body: "Continúa la última sesión con -c, o cualquiera con -s.",
        },
        "same-opencode": {
          title: "El mismo OpenCode",
          body: "El mismo servidor, agentes y modelos que las otras apps.",
        },
        agents: {
          title: "Agentes",
          body: "Cambia de agente directamente desde el prompt.",
        },
        compact: {
          title: "Compactar",
          body: "Reduce una sesión larga con /compact.",
        },
      },
    },
  },
  extensionCard: {
    name: "Extensiones",
    body: "Usa OpenCode dentro de VS Code, o en Zed y otros editores mediante ACP.",
    action: "Instalar",
  },
  extensions: {
    browse: {
      body: "Deja que los agentes usen tu navegador real.",
      title: "OpenCode | Browse, tu navegador real para agentes de programación",
      description:
        "Browse permite a OpenCode y otros clientes MCP usar tu navegador real. Los agentes controlan pestañas en segundo plano con Playwright y te devuelven los inicios de sesión y el 2FA.",
      intro:
        "Un servidor MCP y una extensión de Chromium que permiten a tus agentes usar tu navegador real, con tus pestañas, tus sesiones iniciadas y tus extensiones. Abren y controlan pestañas con Playwright, hacen capturas y graban la pantalla, en pestañas en segundo plano agrupadas para no molestarte. Cuando te toca a ti, para iniciar sesión, un código 2FA o un pago, te devuelven la pestaña y siguen en cuanto haces clic en Continuar.",
      features: {
        "your-real-browser": {
          title: "Tu navegador real",
          body: "Chrome, Edge, Brave, Arc, Helium, Vivaldi, Opera y Chromium.",
        },
        "out-of-your-way": {
          title: "Sin molestar",
          body: "Las pestañas de los agentes se abren en segundo plano, en grupos contraídos.",
        },
        handoffs: {
          title: "Relevos",
          body: "Inicia sesión o haz el paso de 2FA tú mismo y luego haz clic en Continuar.",
        },
        "lend-a-tab": {
          title: "Cede pestañas",
          body: "Haz clic en el botón de la barra para pasarle a un agente una pestaña abierta.",
        },
        "record-and-capture": {
          title: "Graba y captura",
          body: "Capturas de pantalla, grabaciones de pantalla y tráfico de red en formato HAR.",
        },
        "any-mcp-client": {
          title: "Todo cliente MCP",
          body: "OpenCode, Claude Code, Cursor, Codex, Zed y muchos más.",
        },
        "named-sessions": {
          title: "Sesiones con nombre",
          body: "Cada sesión conserva sus pestañas, incluso tras reiniciar.",
        },
        allowlists: {
          title: "Lista blanca",
          body: "Limita las pestañas de una sesión a los sitios que indiques.",
        },
      },
      install:
        "Una línea instala Browse, lo añade a los agentes que encuentra y vincula la extensión. En Windows, ejecuta irm https://opencode.ai/browse/install.ps1 | iex. O pide a tu agente que lo configure.",
    },
  },
  apps: {
    opentunnel: {
      category: "Túneles locales",
      body: "URL HTTPS públicas para apps locales.",
    },
    opentui: {
      category: "Librería",
      body: "Una librería para interfaces de usuario de terminal.",
    },
    hex: {
      category: "Dictado por voz",
      body: "Dictado por voz en el dispositivo para cualquier app.",
    },
  },
  getStarted: {
    title: "Empieza",
    lead: "La forma más fácil de empezar es descargar OpenCode y usar los modelos gratuitos. No necesitas cuenta. Para más, usa tu propia suscripción u OpenCode Go.",
    phrases: {
      "download-opencode": {
        text: "descargar OpenCode",
      },
      "free-models": {
        text: "modelos gratuitos",
      },
      "your-own-subscription": {
        text: "tu propia suscripción",
      },
      "a-subscription-you-already-have": {
        text: "una suscripción que ya tienes",
      },
    },
    subscriptions: {
      "chatgpt-plus-pro": {
        name: "ChatGPT Plus/Pro",
      },
    },
    steps: {
      download: {
        title: "Descarga",
        line: "Escritorio, móvil o terminal.",
      },
      "use-free-models": {
        title: "Modelos gratis",
        line: "OpenCode incluye un conjunto de modelos gratuitos. No necesitas cuenta.",
      },
      "add-more-models": {
        title: "Más modelos",
        line: "Usa tu propia suscripción o los modelos seleccionados de OpenCode Go desde 10 $/mes.",
      },
    },
    sentence:
      "Descarga OpenCode, empieza con modelos gratuitos y añade tu propia suscripción u OpenCode Go cuando quieras más.",
  },
  byos: {
    title: "Trae tu suscripción",
    headline: "Usa las suscripciones que ya tienes.",
    line: "Inicia sesión con ChatGPT Plus o Pro, o con GitHub Copilot. O usa una suscripción de OpenCode.",
    yours: {
      label: "Tu suscripción",
      items: {
        "chatgpt-plus-pro": {
          name: "ChatGPT Plus/Pro",
        },
      },
    },
    planLinks: ["suscripción de OpenCode"],
    ours: {
      label: "Planes de OpenCode",
    },
  },
  brand: {
    hero: {
      copy: {
        text: "Reglas para agente",
        copied: "Reglas copiadas",
      },
    },
    naming: {
      title: "Nombre",
      body: "Escribe OpenCode en una sola palabra, con O y C mayúsculas. No escribas Opencode, Open Code, OpenCode AI ni Open-Code.",
      code: "Usa `opencode` en minúsculas solo en el código y en nombres de paquetes, como `opencode-figma` o `@acme/opencode-plugin`.",
    },
    families: {
      logo: {
        title: "Logo",
        body: "El logo solo, para iconos de apps, avatares y otros espacios pequeños. Las versiones cuadradas añaden margen para sitios que recortan en cuadrado.",
        assets: {
          light: {
            name: "Claro",
          },
          dark: {
            name: "Oscuro",
          },
          "square-light": {
            name: "Cuadrado, claro",
          },
          "square-dark": {
            name: "Cuadrado, oscuro",
          },
        },
      },
      wordmark: {
        title: "Logotipo",
        body: "El nombre completo con las letras de OpenCode. Úsalo siempre que haya espacio para escribir el nombre entero.",
        assets: {
          light: {
            name: "Claro",
          },
          dark: {
            name: "Oscuro",
          },
        },
      },
      "simple-wordmark": {
        title: "Logotipo simple",
        body: "Una versión monocolor del logotipo, para impresión, bordado y sitios que solo admiten un color.",
        assets: {
          light: {
            name: "Claro",
          },
          dark: {
            name: "Oscuro",
          },
        },
      },
    },
    icons: {
      title: "Avatares",
      body: "Avatares cuadrados de 1024px para Slack, Discord, GitHub y otros perfiles. El fondo llena todo el cuadrado y el logo queda bien dentro del círculo, así que aguantan un recorte redondo.",
      items: {
        dark: {
          name: "Oscuro",
        },
        light: {
          name: "Claro",
        },
      },
    },
    colors: {
      title: "Colores",
      body: "El logo y el logotipo usan una sola tinta con tres opacidades, y una tinta más clara para fondos oscuros. Los valores de abajo son esa tinta sobre blanco o sobre #0B0B0B, como en los archivos estándar. Haz clic en un valor para copiarlo.",
      palettes: {
        light: {
          name: "Claro",
          swatches: {
            ink: {
              name: "Tinta",
              use: "El contorno del logo y las letras de «code».",
            },
            "ink-70": {
              name: "Tinta 70%",
              use: "Las letras de «open».",
              ink: "La tinta al 70% de opacidad.",
            },
            "ink-20": {
              name: "Tinta 20%",
              use: "La sombra interior del logo.",
              ink: "La tinta al 20% de opacidad.",
            },
          },
        },
        dark: {
          name: "Oscuro",
          swatches: {
            ink: {
              name: "Tinta",
              use: "El contorno del logo y las letras de «code».",
            },
            "ink-72": {
              name: "Tinta 72%",
              use: "Las letras de «open».",
              ink: "La tinta al 72% de opacidad.",
            },
            "ink-28": {
              name: "Tinta 28%",
              use: "La sombra interior del logo.",
              ink: "La tinta al 28% de opacidad.",
            },
          },
        },
      },
    },
    variants: {
      title: "Variantes",
      body: "Elige la versión que mantiene el logo nítido sobre tu fondo, oscura sobre fondos claros y clara sobre fondos oscuros. El logo y el logotipo son archivos distintos, así que usa uno u otro.",
      groups: {
        default: {
          name: "Predeterminado",
          body: "El logo que debes usar casi siempre. Su sombra interior es transparente. Sobre blanco o negro se ve igual que la versión bicolor gris, y sobre fotos, degradados y colores deja ver el fondo.",
          rows: {
            logo: {
              title: "Logo",
              tiles: {
                dark: {
                  name: "Oscuro",
                },
                light: {
                  name: "Claro",
                },
              },
            },
            wordmark: {
              title: "Logotipo",
              tiles: {
                dark: {
                  name: "Oscuro",
                },
                light: {
                  name: "Claro",
                },
              },
            },
          },
        },
        simple: {
          name: "Simple",
          body: "Un solo color, con contraformas abiertas y sin sombra interior. Úsalo sobre fondos de color plano, para impresión a una tinta y donde no puedas usar los grises, simple oscuro sobre colores claros y simple claro sobre colores oscuros.",
          rows: {
            wordmark: {
              title: "Logotipo",
              tiles: {
                dark: {
                  name: "Oscuro",
                },
                light: {
                  name: "Claro",
                },
              },
            },
          },
        },
      },
    },
    usage: {
      title: "Uso",
      body: "Usa las versiones claras sobre fondos claros y las oscuras sobre fondos oscuros. El logo y el logotipo son independientes, así que usa uno u otro, nunca los dos juntos.",
      stroke: {
        title: "Un trazo",
        body: "Las reglas de espaciado de esta página se miden en trazos. Un trazo es el grosor del contorno del logo, una cuarta parte de su anchura, así que el logo mide 4 trazos de ancho y 5 de alto.",
      },
      clearSpace: {
        title: "Espacio libre",
        body: "Deja al menos dos trazos de espacio en cada lado del logo y del logotipo. En el logo, un trazo es el grosor de su contorno, una cuarta parte de su anchura. En el logotipo, es el grosor de sus letras, una séptima parte de su altura.",
      },
      pixels: {
        title: "Píxeles enteros",
        body: "Las proporciones del logo son fijas, 4:5, y un trazo es una cuarta parte de su anchura. Escálalo en pasos de 4 × 5px, para que cada borde y cada trazo caigan en un píxel entero.",
        do: "mantener cada borde y el trazo de 4px en píxeles enteros.",
        dont: "dimensionar el logo fuera de 4:5, o sus bordes caerán entre píxeles y se verán borrosos.",
        sizes: {
          logo: {
            title: "Logo",
          },
          wordmark: {
            title: "Logotipo",
          },
        },
      },
      minimumTitle: "Tamaños mínimos",
      minimum: {
        logo: {
          title: "Logo",
          body: "Al menos 16 × 20px, con un trazo de 4px. Más pequeño se ve borroso.",
        },
        wordmark: {
          title: "Logotipo",
          body: "Al menos 117 × 21px, con un trazo de 3px. Más pequeño se ve borroso.",
        },
      },
    },
    donts: {
      title: "Evita",
      body: "Errores habituales que debes evitar al usar el logo y el logotipo.",
      examples: {
        "two-tone": {
          caption: "cambiar el logo a otros colores.",
        },
        bright: {
          caption: "usar un solo color llamativo.",
        },
        gradient: {
          caption: "rellenar el logo con un degradado.",
        },
        inverted: {
          caption: "intercambiar los tonos.",
        },
        stretch: {
          caption: "estirar o aplastar el logo.",
        },
        shadow: {
          caption: "añadir sombras paralelas.",
        },
        glow: {
          caption: "añadir resplandores o contornos.",
        },
        lockup: {
          caption: "poner otras palabras junto al logo.",
        },
        "low-contrast": {
          caption: "usar gris sobre gris con poco contraste.",
        },
        color: {
          caption: "poner el logo bicolor gris sobre un fondo de color, donde sus grises quedan apagados.",
        },
      },
    },
    integrations: {
      title: "Integraciones",
      body: "Los plugins, proveedores y herramientas que funcionan con OpenCode, y los proyectos creados con él, pueden decirlo. Usa una insignia o un lockup de partner, y pon a tu proyecto un nombre que deje claro que es tuyo.",
      badges: {
        body: "Pon una insignia en tu README, tu documentación o tu web y enlázala a opencode.ai. Elige el archivo claro u oscuro según tu fondo (el HTML cambia solo), y no cambies los colores ni el texto.",
        sizes: "Cada estilo está disponible en 20, 32 y 44px (Shields solo en 20px), en SVG y en PNG a 2×.",
        mono: "Cada archivo también existe con texto en OpenTUI Mono. Añade -mono antes de la extensión, como en opencode-works-with-a-light-20-mono.svg, o -mono-caps para OpenTUI Mono en mayúsculas.",
        groups: {
          "works-with": {
            title: "Funciona con",
            alt: "Funciona con OpenCode",
            body: "Para plugins, proveedores y herramientas que funcionan con OpenCode.",
          },
          "built-with": {
            title: "Hecho con",
            alt: "Hecho con OpenCode",
            body: "Para proyectos hechos con OpenCode.",
          },
        },
        styles: {
          a: {
            name: "Marco",
          },
          c: {
            name: "Celdas",
          },
          f: {
            name: "Sólido",
          },
          g: {
            name: "Shields",
          },
        },
      },
      lockup: {
        title: "Lockup de partner",
        body: "Pon el logo de OpenCode y el del partner uno al lado del otro, con una × entre ambos. Deja 3 trazos de espacio a cada lado de la ×, ajusta el logo del partner para que parezca tan alto como el de OpenCode y deja espacio libre alrededor de todo el conjunto.",
      },
      naming: {
        title: "Nombra tu proyecto",
        body: "Empieza por tu propio nombre, para que quede claro que el proyecto es tuyo.",
        rule: "Escribe `Linear for OpenCode` o llama al paquete `opencode-linear`. No escribas `OpenCode Linear` ni `Linear by OpenCode`.",
      },
    },
    trademarks: {
      title: "Marcas",
      body: "OpenCode y el logo de OpenCode son marcas de Anomaly. No las uses para dar a entender que Anomaly te respalda o patrocina, ni en el nombre de tu producto o empresa, ni en merchandising sin permiso.",
      contact: {
        before: "Si tienes preguntas, escribe a ",
      },
    },
  },
  press: {
    title: "OpenCode | Kit de prensa con datos de la empresa y recursos",
    description:
      "El kit de prensa de OpenCode, con datos sobre OpenCode y Anomaly, la empresa que lo crea, además de logos y logotipos para descargar y un contacto para prensa.",
    hero: {
      title: "Prensa",
      body: "Datos, recursos de marca y contactos para escribir sobre OpenCode y Anomaly.",
    },
    company: {
      title: "Sobre Anomaly",
      lead: "Anomaly es la empresa detrás de OpenCode. Crea herramientas de código abierto para desarrolladores.",
      more: "Otros proyectos son SST y OpenTUI, todos de código abierto en [GitHub](github).",
      projects: {
        opencode: {
          body: "El agente de programación de código abierto, con apps para escritorio, móvil y terminal, y un SDK. Licencia MIT, más de 220.000 estrellas en GitHub.",
        },
        sst: {
          body: "Un framework para crear apps full-stack en tu propia infraestructura. Licencia MIT, abierto desde 2020, con más de 26.000 estrellas en GitHub.",
        },
        opentui: {
          name: "OpenTUI",
          body: "Una librería para interfaces de terminal en TypeScript, React o Solid, con un núcleo en Zig. OpenCode la usa en producción. Más de 13.000 estrellas en GitHub.",
        },
        "models-dev": {
          body: "Una base de datos de código abierto con especificaciones, precios y capacidades de modelos de IA, con una API pública. Incluye más de 8.900 modelos de más de 200 proveedores.",
        },
        hex: {
          body: "Dictado por voz para Mac, Windows y Linux. Hex transcribe en tu dispositivo y pega en cualquier app, así que el audio nunca sale de él.",
        },
        opentunnel: {
          body: "Una CLI y un SDK que dan una URL HTTPS pública a las apps de tu máquina. El TLS termina en tu máquina, así que el relay nunca ve texto en claro.",
        },
      },
      learnMore: "Para saber más, visita [anoma.ly](site).",
    },
    about: {
      title: "Sobre OpenCode",
      boilerplate: {
        long: "OpenCode es un agente de programación de código abierto. Está disponible como app de escritorio, app móvil, interfaz de terminal y SDK, y funciona con modelos de cualquier proveedor, incluidos Claude, GPT y Gemini. OpenCode tiene licencia MIT y lo crea Anomaly. Tiene más de 220.000 estrellas en GitHub y más de 1.000 colaboradores, y más de 22 millones de desarrolladores lo usan cada mes.",
        short:
          "OpenCode es un agente de programación de código abierto de Anomaly, con apps para escritorio, móvil y terminal, y un SDK.",
      },
      products: {
        "opencode-console": {
          name: "OpenCode Console",
          long: "OpenCode Console es la app web donde desarrolladores y equipos compran y gestionan el acceso a modelos de IA para OpenCode y otros agentes de programación. Ofrece inferencia de pago por uso para modelos frontier y de pesos abiertos, cobrada por petición con créditos prepago, y suscripciones a OpenCode Go. Los equipos tienen espacios de trabajo con los roles Member, Admin y Owner, límites de gasto por espacio y por usuario, inicio de sesión único con Okta, Microsoft Entra ID o Google Workspace, y SCIM. Console admite más de 30 proveedores, así que los equipos pueden conectar las cuentas que ya tienen, y su propia inferencia es opcional. Está en opencode.ai/console.",
          short:
            "OpenCode Console es la app web de Anomaly para acceder a modelos de IA con pago por uso, suscripciones a OpenCode Go y controles de equipo como presupuestos e inicio de sesión único.",
        },
        "opencode-go": {
          long: "OpenCode Go es una suscripción para desarrolladores que quieren un precio mensual fijo para modelos de programación. Go cuesta 10 $/mes, Go Plus 40 $/mes con límites más altos y Go Teams 20 $/mes por miembro. Cada plan incluye una selección de modelos probados para programación agéntica. Los límites de uso son importes mensuales en dólares por modelo, con cupos móviles de 5 horas y semanales del 20% y el 50% del límite mensual. Los suscriptores pueden recargar crédito, pasar a un saldo de pago por uso y cancelar cuando quieran. Go funciona con OpenCode y otros agentes. Está en opencode.ai/console/go.",
          short:
            "OpenCode Go es una suscripción mensual de Anomaly que da a los desarrolladores límites de uso mensuales en una selección de modelos de programación, desde 10 $/mes.",
        },
        "opencode-data": {
          name: "OpenCode Data",
          long: "OpenCode Data es un panel público que muestra qué modelos de IA usan los desarrolladores en OpenCode y cómo cambia esa combinación con el tiempo. Publica una clasificación de los mejores modelos, el uso de tokens, los costes por sesión y por token, las tasas de caché, la cuota de mercado y un desglose por país. Las cifras se agregan cada hora, con días y semanas en UTC. Los recuentos de usuarios y sesiones son aproximados, y los costes usan los precios de lista del catálogo de modelos de OpenCode. Los periodistas pueden citarlo como OpenCode Data (opencode.ai/data), con la hora de actualización que muestra la página.",
          short:
            "OpenCode Data es un panel público en opencode.ai/data que clasifica los modelos de IA por su uso real en OpenCode, con tokens, costes y cuota de mercado actualizados cada hora.",
        },
      },
    },
    facts: {
      title: "De un vistazo",
      items: {
        license: {
          label: "Licencia",
        },
        "first-release": {
          label: "Primera versión",
        },
        "made-by": {
          label: "Creador",
        },
      },
    },
    milestones: {
      title: "Hitos",
      items: {
        "first-release-v0-0-1": {
          date: "Abr 2025",
          text: "Primera versión, v0.0.1",
        },
        "1-million-downloads": {
          date: "Oct 2025",
          text: "1 millón+ de descargas",
        },
        "opencode-1-0": {
          date: "Oct 2025",
          text: "OpenCode 1.0",
        },
        "desktop-app-ships": {
          date: "Dic 2025",
          text: "Llega la app Desktop",
        },
        "10-million-downloads": {
          date: "Ene 2026",
          text: "10 millones+ de descargas",
        },
        "opencode-2-0": {
          date: "Sep 2026",
          text: "OpenCode 2.0",
        },
        "220-000-github-stars": {
          date: "Nov 2026",
          text: "220.000+ estrellas en GitHub",
        },
      },
    },
    news: {
      title: "Últimas versiones",
      intro: "OpenCode publica a menudo. Estas son las versiones más recientes con funciones nuevas.",
      changelog: {
        text: "Todas las novedades",
      },
      feed: {
        text: "Feed RSS",
      },
    },
    media: {
      title: "Medios",
      intro:
        "Imágenes y vídeos cortos de cada app, grabados del producto real. Puedes usarlos para escribir sobre OpenCode.",
      note: "Todas las capturas usan el tema oscuro. Las imágenes y pósteres son JPG de hasta 1920 × 1080, o 1080 × 1350 en vertical. Los vídeos son clips MP4 sin sonido.",
      products: {
        desktop: {
          name: "Desktop",
          items: {
            "locked-landscape": {
              title: "Vídeo de Desktop",
            },
            "frame-1": {
              title: "Imagen de Desktop 1",
            },
            "frame-2": {
              title: "Imagen de Desktop 2",
            },
            "frame-3": {
              title: "Imagen de Desktop 3",
            },
            "frame-4": {
              title: "Imagen de Desktop 4",
            },
            "feature-1": {
              title: "Sesiones en pestañas",
            },
            "feature-2": {
              title: "Revisa y comenta",
            },
            "feature-3": {
              title: "Míralo en el navegador",
            },
            "locked-portrait": {
              title: "Vídeo de Desktop, vertical",
            },
          },
        },
        mobile: {
          name: "Mobile",
          items: {
            "locked-landscape": {
              title: "Vídeo de Mobile",
            },
            "frame-1": {
              title: "Imagen de Mobile 1",
            },
            "frame-2": {
              title: "Imagen de Mobile 2",
            },
            "frame-3": {
              title: "Imagen de Mobile 3",
            },
            "feature-1": {
              title: "Voz",
            },
            "feature-2": {
              title: "Aprobaciones",
            },
            "feature-3": {
              title: "Sesiones",
            },
            "locked-portrait": {
              title: "Vídeo de Mobile, vertical",
            },
          },
        },
        terminal: {
          name: "Terminal",
          items: {
            "locked-landscape": {
              title: "Vídeo de Terminal",
            },
            "frame-1": {
              title: "Imagen de Terminal 1",
            },
            "frame-2": {
              title: "Imagen de Terminal 2",
            },
            "frame-3": {
              title: "Imagen de Terminal 3",
            },
            "frame-4": {
              title: "Imagen de Terminal 4",
            },
            "feature-1": {
              title: "Pide con tus palabras",
            },
            "feature-2": {
              title: "Aprueba lo que corre",
            },
            "feature-3": {
              title: "Hazlo tuyo",
            },
            "locked-portrait": {
              title: "Vídeo de Terminal, vertical",
            },
          },
        },
        sdk: {
          items: {
            "locked-landscape": {
              title: "Vídeo SDK",
            },
            "frame-1": {
              title: "Imagen SDK 1",
            },
            "frame-2": {
              title: "Imagen SDK 2",
            },
            "frame-3": {
              title: "Imagen SDK 3",
            },
            "frame-4": {
              title: "Imagen SDK 4",
            },
            "feature-1": {
              title: "Arregla la CI",
            },
            "feature-2": {
              title: "Sigue cada paso",
            },
            "feature-3": {
              title: "Crea tus herramientas",
            },
            "locked-portrait": {
              title: "Vídeo SDK, vertical",
            },
          },
        },
      },
    },
    people: {
      title: "Equipo",
    },
    anomalyLogo: {
      title: "Logo de Anomaly",
      body: "El símbolo y el logotipo de Anomaly, en negro y en blanco. Los PNG miden 2048 px de ancho.",
      assets: {
        "mark-black": {
          name: "Símbolo, negro",
        },
        "mark-white": {
          name: "Símbolo, blanco",
        },
        "wordmark-black": {
          name: "Logotipo, negro",
        },
        "wordmark-white": {
          name: "Logotipo, blanco",
        },
      },
      all: {
        text: "Descargar todo",
      },
    },
    coverage: {
      title: "En prensa",
    },
    brand: {
      title: "Marca",
      before:
        "Descarga los logos y logotipos de OpenCode en un solo archivo ZIP. Para archivos sueltos, variantes y reglas de uso, ve a la ",
      link: {
        text: "página Marca",
      },
      usage:
        "Puedes usar estos archivos para escribir sobre OpenCode. No los modifiques ni des a entender que OpenCode respalda tu trabajo.",
    },
    product: {
      title: "Producto",
      items: {
        desktop: {
          name: "Desktop",
          body: "Ejecuta varios agentes a la vez, cada uno en su pestaña, en macOS, Windows y Linux. Revisa cada cambio como diff y previsualízalo.",
        },
        mobile: {
          name: "Mobile",
          body: "La app más reciente de OpenCode. Llama a una sesión para hablar con el agente y luego revisa y aprueba sus cambios desde el móvil, estés donde estés.",
        },
        terminal: {
          name: "Terminal",
          body: "Una interfaz de terminal que funciona en cualquier shell, editor o servidor remoto. Mira cada edición como diff y elige qué comandos se ejecutan solos.",
        },
        sdk: {
          body: "Un cliente tipado de TypeScript para scripts, jobs de CI y tus propias herramientas. Crea sesiones, envía prompts y transmite cada evento según llega.",
        },
      },
    },
    contact: {
      title: "Contacto",
      items: {
        press: {
          title: "Prensa",
          body: "Para periodistas y analistas. Solo respondemos a solicitudes de medios.",
        },
        support: {
          title: "Soporte",
          body: "Para ayuda con OpenCode, abre una issue o pregunta a la comunidad. Para cuestiones de cuenta y facturación, escríbenos.",
          links: {
            "github-issues": {
              text: "Issues de GitHub",
            },
            "help-anoma-ly": {
              text: "help@anoma.ly",
            },
          },
        },
        security: {
          title: "Seguridad",
          body: "Informa de una vulnerabilidad a través de GitHub. Si nadie responde en 6 días laborables, escríbenos.",
          links: {
            "report-a-vulnerability": {
              text: "Informar de una vulnerabilidad",
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
        },
      },
    },
    terminal: {
      title: "Terminal",
      installs: {
        curl: {
          name: "Script",
        },
      },
    },
    extensions: {
      title: "Extensiones",
      items: {
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
        label: "Lee la documentación del SDK",
      },
    },
    ide: {
      lead: "Ejecuta opencode en la terminal integrada de tu editor y la extensión se instala sola, o instálala tú.",
      more: {
        label: "Configura Zed, los IDE de JetBrains y otros editores ACP",
      },
      links: {
        "vs-code-marketplace": {
          label: "VS Code Marketplace",
        },
        "open-vsx-cursor-windsurf-vscodium": {
          label: "Open VSX (Cursor, Windsurf, VSCodium)",
        },
      },
    },
    mini: {
      lead: "Mini viene con la CLI de OpenCode. Instálala con cualquiera de estos comandos y luego ejecuta opencode mini.",
      commands: {
        curl: {
          name: "Script",
        },
      },
    },
    terminal: {
      commands: {
        curl: {
          name: "Script",
        },
      },
    },
  },
  pair: {
    title: "Conecta tu móvil",
    cardTitle: "Vincula tu móvil con un comando",
    intro:
      "OpenCode Mobile es un mando a distancia para OpenCode en tu ordenador. Tus sesiones siguen ejecutándose allí, y la app te las muestra y te permite guiarlas.",
    steps: {
      "get-the-app": {
        title: "Consigue la app",
        body: "Instala la beta de OpenCode en tu iPhone desde TestFlight. La app de Android llegará pronto.",
      },
      "run-this-on-your-computer": {
        title: "Ejecuta esto en tu ordenador",
        body: "Imprime un enlace de un solo uso y un código QR. Funcionan una vez y caducan en 5 minutos.",
      },
      "scan-the-code": {
        title: "Escanea el código",
        body: "Escanea el código QR con la app o pega el enlace. Las sesiones recientes de tu ordenador se abren en el móvil.",
      },
    },
    note: "--remote se conecta a través de una dirección de OpenTunnel, así que funciona desde cualquier red. En la misma Wi-Fi, ejecuta una vez opencode service set hostname 0.0.0.0 y luego opencode pair.",
    facts: [
      "La vinculación funciona desde cualquier red, porque --remote se conecta a través de una dirección de OpenTunnel.",
      "El enlace y el código funcionan una vez y caducan en 5 minutos.",
      "Deja el ordenador encendido, porque el agente se ejecuta allí y no en el móvil.",
      "En la misma Wi-Fi, ejecuta una vez opencode service set hostname 0.0.0.0 y luego opencode pair.",
    ],
  },
  announcements: {
    "create-install-and-share-desktop-plugins": {
      text: "Crea, instala y comparte plugins de escritorio.",
      link: "Novedades de la 2.2",
    },
    "desktop-terminals-now-survive-restarts": {
      text: "Las terminales de escritorio ya sobreviven a los reinicios.",
      link: "Ver v2.2.4",
    },
    "agents-can-now-generate-images": {
      text: "Los agentes ya pueden generar imágenes.",
      link: "Ver v2.2.1",
    },
    "steer-your-sessions-from-your-phone": {
      text: "Guía tus sesiones desde el móvil.",
      link: "Conoce OpenCode Mobile",
    },
    "a-refreshed-desktop-app": {
      text: "Una app de escritorio renovada.",
      link: "Novedades de la 2.2",
    },
  },
} satisfies ContentOverlay
