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
      body: "Inicia, dirige y aprueba sesiones desde tu móvil, estés donde estés.",
      action: "Descargar",
    },
    terminal: {
      name: "Terminal",
      body: "Una interfaz de terminal rápida que funciona en cualquier shell, editor o servidor remoto.",
      action: "Instalar",
    },
    sdk: {
      body: "Controla OpenCode desde tus scripts, tareas de CI y herramientas.",
      action: "Ver docs",
    },
    mini: {
      body: "Una interfaz de terminal minimalista. Las respuestas quedan en el historial y solo hay un prompt debajo.",
      action: "Instalar",
    },
  },
  productDetails: {
    desktop: {
      title: "OpenCode | App de escritorio para macOS, Windows y Linux",
      description:
        "Ejecuta en paralelo tantos agentes de OpenCode como quieras, revisa cada cambio en el navegador junto al agente y retoma el trabajo en cualquier dispositivo. Para macOS, Windows y Linux.",
      intro:
        "Ejecuta varios agentes a la vez, cada sesión en su propia pestaña. Revisa los diffs, comenta cualquier línea y comprueba el resultado en el navegador integrado. Para macOS, Windows y Linux.",
      showcase: {
        "parallel-agents": {
          title: "Agentes en paralelo",
          body: "Inicia tantos agentes como quieras y deja que trabajen en paralelo. Cambia de uno a otro a medida que terminen.",
        },
        "see-it-in-the-browser": {
          title: "Míralo en el navegador",
          body: "Tu app se abre en un navegador junto al agente. Así, tú y el agente pueden ver los cambios a medida que se aplican.",
        },
        "on-every-device": {
          title: "En todos tus dispositivos",
          body: "Inicia agentes en cualquiera de tus dispositivos y retoma su trabajo desde la app de escritorio, la terminal o el móvil.",
        },
        "extend-it": {
          title: "Amplía OpenCode",
          body: "Conecta tus herramientas y servicios para que el agente pueda trabajar con lo que necesites. También puedes pedirle a OpenCode que cree sus propios plugins, con interfaz en la barra lateral.",
        },
      },
    },
    mobile: {
      title: "OpenCode | Mobile, tus sesiones de programación en el móvil",
      description:
        "Inicia y dirige sesiones de OpenCode desde el móvil. Habla con el agente mientras trabaja en tu equipo.",
      intro:
        "Inicia y dirige sesiones desde el móvil, estés donde estés. Llama a una sesión para hablar con el agente o abre cualquier sesión para retomar el trabajo donde lo dejaste. OpenCode sigue ejecutándose en tu propio equipo.",
      features: {
        "notify-when-done": {
          title: "Aviso al terminar",
          body: "Recibe un breve resumen cuando termina una sesión que iniciaste.",
        },
        "pair-from-anywhere": {
          title: "Vincula desde cualquier lugar",
          body: "Conéctate desde cualquier red con opencode pair --remote.",
        },
        "every-computer": {
          title: "Todos tus equipos",
          body: "Cambia de equipo vinculado con un toque.",
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
          title: "Tu equipo",
          body: "Se conecta a OpenCode en tu propio equipo.",
        },
        "share-sheet": {
          title: "Compartir",
          body: "Comparte cualquier contenido con una sesión sin abrir la app.",
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
        results: {
          title: "Resultados",
          body: "Cuando termina el trabajo que pediste, la llamada te informa de los cambios.",
        },
      },
    },
    terminal: {
      title: "OpenCode | Interfaz de terminal del agente de programación de código abierto",
      description:
        "Una interfaz de terminal rápida para OpenCode que funciona en cualquier shell, editor o servidor remoto. Describe lo que quieres, revisa cada cambio en el diff y aprueba los comandos.",
      intro:
        "Una interfaz de terminal rápida que funciona en cualquier shell, editor o servidor remoto. Describe lo que quieres con tus propias palabras, revisa los diffs a medida que aparecen y elige qué comandos se ejecutan automáticamente.",
      features: {
        "any-terminal": {
          title: "Cualquier terminal",
          body: "Funciona en cualquier shell, en la terminal de tu editor o en un servidor remoto.",
        },
        "diffs-in-the-timeline": {
          title: "Diffs en la línea de tiempo",
          body: "Consulta el diff de cada cambio en la línea de tiempo a medida que el agente trabaja.",
        },
        "pick-up-later": {
          title: "Retoma más tarde",
          body: "Reanuda la última sesión con -c o elige otra con -s.",
        },
        "one-off-runs": {
          title: "Ejecuciones puntuales",
          body: "opencode run envía un mensaje e imprime la respuesta.",
        },
        "agents-and-commands": {
          title: "Agentes y comandos",
          body: "Cambia de agente con shift+tab y abre todos los comandos con ctrl+p.",
        },
        "auto-approve": {
          title: "Aprobación automática",
          body: "Ejecuta con --auto para permitir cualquier acción que no hayas denegado.",
        },
        "any-server": {
          title: "Cualquier servidor",
          body: "Conéctate a un servidor de OpenCode por URL con --server.",
        },
        "usage-stats": {
          title: "Estadísticas de uso",
          body: "opencode stats muestra estadísticas de uso para compartir.",
        },
      },
      showcase: {
        "ask-in-plain-words": {
          title: "Pídelo con tus palabras",
          body: "Escribe lo que quieres y el agente muestra su plan mientras trabaja.",
        },
        "approve-what-runs": {
          title: "Aprueba la ejecución",
          body: "Las ediciones se muestran como diffs y los comandos esperan tu permiso.",
        },
        "make-it-yours": {
          title: "Hazlo tuyo",
          body: "Cambia de tema con una tecla. Elige el predeterminado, tokyonight u otro.",
        },
        mini: {
          title: "Mini",
          body: "Con opencode mini, las respuestas van a tu propio historial.",
        },
      },
    },
    sdk: {
      title: "OpenCode | SDK de TypeScript para scripts, tareas de CI y herramientas",
      description:
        "Controla OpenCode desde tus scripts, tareas de CI y herramientas. El cliente tipado de TypeScript crea sesiones, envía prompts y transmite cada evento al momento.",
      intro:
        "Controla OpenCode desde tus scripts, tareas de CI y herramientas. El SDK ejecuta OpenCode dentro de tu proceso con tu configuración y tus modelos. Su cliente tipado crea sesiones, envía prompts y transmite cada evento.",
      features: {
        "typescript-client": {
          title: "Cliente TypeScript",
          body: "Solicitudes y eventos tipados, con los mismos valores que @opencode/client.",
        },
        "sessions-from-code": {
          title: "Sesiones desde tu código",
          body: "Crea sesiones y envía prompts desde cualquier script.",
        },
        "any-model": {
          title: "Cualquier modelo",
          body: "Usa cualquier modelo que tengas configurado en OpenCode.",
        },
        "npm-or-bun": {
          title: "npm o bun",
          body: "Instálalo con npm i @opencode/sdk o bun add @opencode/sdk.",
        },
        "in-process-host": {
          title: "Host en el mismo proceso",
          body: "Ejecuta OpenCode en memoria, sin pasar por la red.",
        },
        "your-plugins": {
          title: "Tus plugins",
          body: "Pasa tus propios plugins al crear el host dentro del proceso.",
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
          title: "Corrige la CI desde tu código",
          body: "Un script breve le pide a OpenCode que corrija las pruebas que fallaron y luego vuelve a ejecutarlas.",
        },
        "follow-every-step": {
          title: "Sigue cada paso",
          body: "Recibe eventos en tiempo real para ver cada llamada a herramienta del agente.",
        },
        "build-your-own-tools": {
          title: "Crea tus propias herramientas",
          body: "Integra OpenCode en bots, paneles y flujos de trabajo con unas pocas líneas.",
        },
        "in-your-process": {
          title: "En tu proceso",
          body: "Ejecuta OpenCode dentro de tu proceso, con tu configuración y modelos.",
        },
      },
    },
    mini: {
      title: "OpenCode | Mini, una interfaz de terminal mínima para el agente",
      description:
        "Mini ejecuta OpenCode en una interfaz de terminal minimalista. Las respuestas quedan en el historial de la terminal. Abajo solo hay un prompt y una línea de estado.",
      intro:
        "Una interfaz de terminal minimalista para OpenCode. Ejecuta opencode mini para enviar las respuestas directamente al historial de tu terminal. Puedes recorrerlas, buscar en ellas y copiarlas como cualquier otra salida. Abajo solo quedan el prompt y una línea de estado.",
      features: {
        "your-scrollback": {
          title: "Tu historial",
          body: "Las respuestas se guardan en el historial de la terminal como cualquier otra salida.",
        },
        "one-prompt": {
          title: "Un solo prompt",
          body: "Agente, modelo, contexto y costo en una línea de estado.",
        },
        permissions: {
          title: "Permisos",
          body: "Permite ediciones y comandos desde la zona del prompt.",
        },
        "how-much-shows": {
          title: "Nivel de detalle",
          body: "Elige entre vista reducida, predeterminada o completa para el razonamiento y la salida de las herramientas.",
        },
        "pick-up-later": {
          title: "Retoma más tarde",
          body: "Reanuda la última sesión con -c o elige otra con -s.",
        },
        "same-opencode": {
          title: "El mismo OpenCode",
          body: "El mismo servidor y los mismos agentes y modelos que en las otras apps.",
        },
        agents: {
          title: "Agentes",
          body: "Cambia de agente directamente desde el prompt.",
        },
        compact: {
          title: "Compactar",
          body: "Compacta una sesión larga con /compact.",
        },
      },
    },
  },
  extensionCard: {
    name: "Extensiones",
    body: "Usa OpenCode en VS Code o conéctalo a Zed y otros editores mediante ACP.",
    action: "Instalar",
  },
  extensions: {
    browse: {
      body: "Deja que los agentes usen tu navegador real.",
      title: "OpenCode | Browse, tu navegador real para agentes de programación",
      description:
        "Browse permite a OpenCode y a otros clientes MCP usar tu navegador real. Los agentes pueden leer, hacer clic, escribir, hacer capturas y grabar pestañas. Te devuelven el control para iniciar sesión o completar el 2FA.",
      intro:
        "Un servidor MCP y una extensión de Chromium para que tus agentes usen tu navegador real, con tus pestañas, tus sesiones abiertas y tus extensiones. Abren pestañas agrupadas en segundo plano para no interrumpirte. Pueden leer páginas, hacer clic, escribir, hacer capturas y grabar pestañas. Si necesitas iniciar sesión, completar el 2FA o confirmar un pago, te ceden la pestaña y retoman el trabajo cuando haces clic en Continuar.",
      features: {
        "your-real-browser": {
          title: "Tu navegador real",
          body: "Chrome, Edge, Brave, Arc, Helium, Vivaldi, Opera y Chromium.",
        },
        "out-of-your-way": {
          title: "Sin interrumpirte",
          body: "Las pestañas de los agentes se abren en segundo plano, en grupos contraídos.",
        },
        handoffs: {
          title: "Cuando necesites intervenir",
          body: "Inicia sesión o completa el paso de 2FA y luego haz clic en Continuar.",
        },
        "lend-a-tab": {
          title: "Comparte una pestaña",
          body: "Haz clic en el botón de la barra para cederle al agente una pestaña que ya tienes abierta.",
        },
        "record-and-capture": {
          title: "Graba y captura",
          body: "Capturas de pantalla, grabaciones de pestañas y tráfico de red.",
        },
        "any-mcp-client": {
          title: "Cualquier cliente MCP",
          body: "OpenCode, Claude Code, Cursor, Codex, Zed y muchos más.",
        },
        "all-your-logins": {
          title: "Todas tus sesiones iniciadas",
          body: "Los agentes usan los sitios donde ya tienes una sesión abierta. Sin claves ni configuración.",
        },
        "allowed-sites": {
          title: "Sitios permitidos",
          body: "Limita la pestaña de un agente a los sitios que indiques.",
        },
      },
      install:
        "Instala primero la [extensión de Chrome] y sigue sus instrucciones. Para instalar la CLI directamente (normalmente no hace falta), usa cualquiera de estos comandos.",
    },
  },
  apps: {
    browse: {
      category: "Control del navegador para agentes",
      body: "Deja que tu agente use tu navegador real, con tus sesiones iniciadas y tus pestañas.",
    },
    opentunnel: {
      category: "Túneles locales",
      body: "URL HTTPS públicas para apps locales.",
    },
    opentui: {
      category: "Biblioteca",
      body: "Una biblioteca para crear interfaces de terminal.",
    },
    hex: {
      category: "Dictado por voz",
      body: "Dictado por voz en el dispositivo para cualquier app.",
    },
  },
  getStarted: {
    title: "Empieza",
    lead: "Para empezar, solo tienes que descargar OpenCode y usar los modelos gratuitos. No necesitas cuenta. Para acceder a más modelos, usa tu propia suscripción u OpenCode Go.",
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
        line: "Desktop, terminal o móvil.",
      },
      "use-free-models": {
        title: "Usa modelos gratis",
        line: "OpenCode incluye modelos gratuitos. No necesitas cuenta.",
      },
      "add-more-models": {
        title: "Agrega más modelos",
        line: "Usa tu propia suscripción o la selección de modelos de OpenCode Go desde $10 al mes.",
      },
    },
    sentence:
      "Descarga OpenCode, empieza con modelos gratuitos y, si quieres más, conecta tu suscripción o usa OpenCode Go.",
  },
  byos: {
    title: "Usa tu suscripción",
    headline: "Usa las suscripciones que ya tienes.",
    line: "Inicia sesión con ChatGPT Plus o Pro o con GitHub Copilot. También puedes usar una suscripción de OpenCode.",
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
        text: "Reglas para tu agente",
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
        body: "El logo por sí solo, para iconos de apps, avatares y otros espacios pequeños. Las versiones cuadradas incluyen margen para las plataformas que recortan las imágenes en cuadrado.",
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
        body: "El nombre completo con la tipografía de OpenCode. Úsalo siempre que haya espacio para mostrar el nombre entero.",
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
        body: "Una versión del logotipo para impresión, bordado y otros usos que solo admiten un color.",
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
      body: "Avatares cuadrados de 1024px para perfiles de Slack, Discord, GitHub y otras plataformas. El fondo ocupa todo el cuadrado y el logo queda dentro del círculo para que no se corte.",
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
      body: "El logo y el logotipo usan una tinta con tres niveles de opacidad. En fondos oscuros, la tinta es más clara. Estos son los colores de los archivos estándar. Úsalos solo para el logo y el logotipo, no para otros textos ni fondos. Haz clic en un valor para copiarlo.",
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
      body: "Elige la versión que destaque sobre el fondo. Usa la oscura sobre fondos claros y la clara sobre fondos oscuros. El logo y el logotipo son archivos distintos. Usa solo uno.",
      groups: {
        default: {
          name: "Predeterminado",
          body: "Usa este logo en casi todos los casos. Su sombra interior es transparente. Sobre blanco o negro se ve igual que la versión con dos tonos de gris. Sobre fotos, degradados y colores, deja ver el fondo.",
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
          body: "Un solo color, con contraformas abiertas y sin sombra interior. Úsalo sobre fondos de color uniforme, para imprimir a una tinta o cuando no puedas usar tonos grises. Elige la versión simple oscura sobre colores claros y la clara sobre colores oscuros.",
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
        body: "El espacio se mide en trazos. Un trazo equivale al grosor del contorno del logo, un cuarto de su ancho. El logo mide 4 trazos de ancho y 5 de alto.",
      },
      clearSpace: {
        title: "Espacio libre",
        body: "Deja al menos dos trazos de espacio a cada lado del logo o el logotipo. En el logo, un trazo equivale al grosor del contorno, un cuarto de su ancho. En el logotipo, equivale al grosor de las letras, un séptimo de su altura.",
      },
      pixels: {
        title: "Píxeles enteros",
        body: "El logo tiene una proporción fija de 4:5 y un trazo equivale a un cuarto de su ancho. Cambia su tamaño en múltiplos de 4 × 5px para alinear cada borde y cada trazo con píxeles enteros.",
        do: "alinear cada borde y el trazo de 4px con píxeles enteros.",
        dont: "cambiar la proporción de 4:5. Los bordes quedarán entre píxeles y se verán borrosos.",
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
          caption: "cambiar los colores del logo.",
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
          caption: "agregar sombras paralelas.",
        },
        glow: {
          caption: "agregar resplandores o contornos.",
        },
        lockup: {
          caption: "poner otras palabras junto al logo.",
        },
        "low-contrast": {
          caption: "usar gris sobre gris con poco contraste.",
        },
        color: {
          caption: "poner el logo con dos tonos de gris sobre fondos de color, que apagan los grises.",
        },
      },
    },
    integrations: {
      title: "Integraciones",
      body: "Si tu plugin, proveedor o herramienta funciona con OpenCode, o creaste un proyecto con él, puedes indicarlo. Usa una insignia o una composición de logos y elige un nombre que deje claro que el proyecto es tuyo.",
      badges: {
        body: "Agrega una insignia a tu README, tus docs o tu sitio web y enlázala a opencode.ai. Elige la versión clara u oscura según el fondo (el HTML cambia automáticamente). No modifiques los colores ni el texto.",
        sizes: "Cada estilo está disponible en 20, 32 y 44px (Shields solo en 20px), en SVG y en PNG a 2×.",
        mono: "Todos los archivos tienen una versión con texto en OpenMono. Agrega -mono antes de la extensión, como en opencode-works-with-a-light-20-mono.svg, o usa -mono-caps si lo quieres en mayúsculas.",
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
        title: "Composición de logos",
        body: "Coloca el logo de OpenCode junto al del socio, con una × entre ambos. Deja 3 trazos de espacio a cada lado de la × y ajusta el logo del socio para que se vea igual de alto que el de OpenCode. Deja espacio libre alrededor de toda la composición.",
      },
      naming: {
        title: "Nombra tu proyecto",
        body: "Empieza por tu propio nombre, para que quede claro que el proyecto es tuyo.",
        rule: "Escribe `Linear for OpenCode` o llama al paquete `opencode-linear`. No escribas `OpenCode Linear` ni `Linear by OpenCode`.",
      },
    },
    trademarks: {
      title: "Marcas",
      body: "OpenCode y el logo de OpenCode son marcas de Anomaly. No las uses para insinuar que Anomaly te respalda o patrocina, ni en el nombre de tu producto o empresa, ni en artículos promocionales sin permiso.",
      contact: {
        before: "Si tienes preguntas, escribe a ",
      },
    },
  },
  press: {
    title: "OpenCode | Kit de prensa con datos de la empresa y recursos de marca",
    description:
      "El kit de prensa de OpenCode reúne datos sobre el producto y Anomaly, la empresa que lo desarrolla, además de logos y logotipos descargables y un contacto para prensa.",
    hero: {
      title: "Prensa",
      body: "Datos, recursos de marca y contactos para escribir sobre OpenCode y Anomaly.",
    },
    company: {
      title: "Sobre Anomaly",
      lead: "Anomaly, la empresa que desarrolla OpenCode, crea herramientas de código abierto para desarrolladores.",
      more: "Otros proyectos son SST y OpenTUI, todos de código abierto en [GitHub](github).",
      projects: {
        opencode: {
          body: "El agente de programación de código abierto, con apps de escritorio, terminal y móvil, además de un SDK. Licencia MIT y más de 220.000 estrellas en GitHub.",
        },
        sst: {
          body: "Un framework para crear apps full-stack en tu propia infraestructura. Licencia MIT, abierto desde 2020, con más de 26.000 estrellas en GitHub.",
        },
        opentui: {
          name: "OpenTUI",
          body: "Una biblioteca para interfaces de terminal en TypeScript, React o Solid, con un núcleo en Zig. OpenCode la usa en producción. Más de 13.000 estrellas en GitHub.",
        },
        "models-dev": {
          body: "Una base de datos de código abierto con especificaciones, precios y capacidades de modelos de IA, con una API pública. Incluye más de 8.900 modelos de más de 200 proveedores.",
        },
        hex: {
          body: "Dictado por voz para Mac, Windows y Linux. Hex transcribe en tu dispositivo y pega el texto en cualquier app. El audio nunca sale del dispositivo.",
        },
        opentunnel: {
          body: "Una CLI y un SDK que asignan una URL HTTPS pública a las apps de tu equipo. TLS termina en tu equipo, así que el relay nunca ve texto sin cifrar.",
        },
      },
      learnMore: "Para saber más, visita [anoma.ly](site).",
    },
    about: {
      title: "Sobre OpenCode",
      body: "Descripciones de OpenCode y sus productos en versión larga y corta, listas para copiar.",
      boilerplate: {
        long: "OpenCode es un agente de programación de código abierto. Está disponible como app de escritorio, interfaz de terminal, app móvil y SDK. Funciona con modelos de cualquier proveedor, incluidos Claude, GPT y Gemini. Lo desarrolla Anomaly y tiene licencia MIT. Cuenta con más de 220.000 estrellas en GitHub y más de 1.000 colaboradores. Más de 22 millones de desarrolladores lo usan cada mes.",
        short:
          "OpenCode es un agente de programación de código abierto de Anomaly, con apps para escritorio, terminal y móvil, y un SDK.",
      },
      products: {
        "opencode-console": {
          name: "OpenCode Console",
          long: "OpenCode Console es la app web donde desarrolladores y equipos compran y gestionan el acceso a modelos de IA para OpenCode y otros agentes de programación. Ofrece inferencia de pago por uso para modelos frontera y de pesos abiertos, con cobro por solicitud mediante créditos prepagados, además de suscripciones a OpenCode Go. Los equipos cuentan con espacios de trabajo con roles Member, Admin y Owner, límites de gasto por equipo y por usuario, inicio de sesión único con Okta, Microsoft Entra ID o Google Workspace y SCIM. Console admite más de 30 proveedores. Los equipos pueden conectar las cuentas que ya tienen y usar la inferencia de Console solo si quieren. Está en opencode.ai/console.",
          short:
            "OpenCode Console es la app web de Anomaly para acceder a modelos de IA con pago por uso, suscripciones a OpenCode Go y controles de equipo como presupuestos e inicio de sesión único.",
        },
        "opencode-go": {
          long: "OpenCode Go es una suscripción para desarrolladores que quieren una tarifa mensual fija para acceder a modelos de programación. Go cuesta $10 al mes; Go Plus, $40 al mes con límites más altos; y Go Teams, $20 al mes por miembro. Cada plan incluye una selección de modelos probados para programar con agentes. Cada modelo tiene un límite de uso mensual en dólares. Las cuotas en periodos móviles de 5 horas y una semana son del 20% y del 50% del límite mensual, respectivamente. Puedes recargar saldo, recurrir al pago por uso con cargo a ese saldo y cancelar cuando quieras. Go funciona con OpenCode y otros agentes. Está en opencode.ai/console/go.",
          short:
            "OpenCode Go es la suscripción de Anomaly que ofrece a los desarrolladores una selección de modelos de programación con límites de uso mensuales, desde $10 al mes.",
        },
        "opencode-data": {
          name: "OpenCode Data",
          long: "OpenCode Data es un panel público que muestra qué modelos de IA usan los desarrolladores en OpenCode y cómo cambia su uso con el tiempo. Publica una clasificación de los modelos más usados, el uso de tokens, los costos por sesión y por token, las tasas de caché, la cuota de mercado y un desglose por país. Las cifras se agregan cada hora, con días y semanas en UTC. El número de usuarios y sesiones es aproximado. Para calcular los costos, se usan los precios de lista del catálogo de modelos de OpenCode. Los periodistas pueden citar OpenCode Data (opencode.ai/data) e indicar la hora de actualización que muestra la página.",
          short:
            "OpenCode Data es un panel público en opencode.ai/data que clasifica los modelos de IA por su uso real en OpenCode. Actualiza cada hora el uso de tokens, los costos y la cuota de mercado.",
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
          date: "abr. 2025",
          text: "Primera versión, v0.0.1",
        },
        "1-million-downloads": {
          date: "oct. 2025",
          text: "Más de 1 millón de descargas",
        },
        "opencode-1-0": {
          date: "oct. 2025",
          text: "OpenCode 1.0",
        },
        "desktop-app-ships": {
          date: "dic. 2025",
          text: "Lanzamiento de Desktop",
        },
        "10-million-downloads": {
          date: "ene. 2026",
          text: "Más de 10 millones de descargas",
        },
        "opencode-2-0": {
          date: "sep. 2026",
          text: "OpenCode 2.0",
        },
        "220-000-github-stars": {
          date: "nov. 2026",
          text: "Más de 220.000 estrellas en GitHub",
        },
      },
    },
    news: {
      title: "Últimas versiones",
      intro: "Publicamos nuevas versiones de OpenCode con frecuencia. Estas son las últimas que incorporan funciones nuevas.",
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
        "Capturas y videos breves de cada app, tomados del producto real. Puedes usarlos para escribir sobre OpenCode.",
      note: "Todas las capturas usan el tema oscuro. Las capturas y las portadas son JPG de hasta 1920 × 1080, o 1080 × 1350 en vertical. Los videos son clips MP4 sin sonido.",
      products: {
        desktop: {
          name: "Desktop",
          items: {
            "locked-landscape": {
              title: "Video de Desktop",
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
              title: "Agentes en paralelo",
            },
            "feature-2": {
              title: "Míralo en el navegador",
            },
            "feature-3": {
              title: "En todos tus dispositivos",
            },
            "locked-portrait": {
              title: "Video de Desktop, vertical",
            },
          },
        },
        mobile: {
          name: "Mobile",
          items: {
            "locked-landscape": {
              title: "Video de Mobile",
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
              title: "Sesiones",
            },
            "feature-3": {
              title: "Resultados",
            },
            "locked-portrait": {
              title: "Video de Mobile, vertical",
            },
          },
        },
        terminal: {
          name: "Terminal",
          items: {
            "locked-landscape": {
              title: "Video de Terminal",
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
              title: "Pídelo con tus palabras",
            },
            "feature-2": {
              title: "Aprueba la ejecución",
            },
            "feature-3": {
              title: "Hazlo tuyo",
            },
            "locked-portrait": {
              title: "Video de Terminal, vertical",
            },
          },
        },
        sdk: {
          items: {
            "locked-landscape": {
              title: "Video del SDK",
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
              title: "Corrige la CI desde tu código",
            },
            "feature-2": {
              title: "Sigue cada paso",
            },
            "feature-3": {
              title: "Crea tus propias herramientas",
            },
            "locked-portrait": {
              title: "Video del SDK, vertical",
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
      avatars: {
        body: "Avatares cuadrados para X, GitHub, Slack, LinkedIn y otros perfiles. El símbolo queda bien dentro del círculo, así que aguanta un recorte redondo. Los PNG miden 1024 y 400 px de ancho.",
        items: {
          "avatar-dark": { name: "Avatar, oscuro" },
          "avatar-light": { name: "Avatar, claro" },
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
        "Descarga los logos y logotipos de OpenCode en un solo archivo ZIP. Para ver los archivos por separado, sus variantes y las reglas de uso, consulta la ",
      link: {
        text: "página de marca",
      },
      usage:
        "Puedes usar estos archivos para escribir sobre OpenCode. No los modifiques ni des a entender que OpenCode respalda tu trabajo.",
    },
    product: {
      title: "Producto",
      items: {
        desktop: {
          name: "Desktop",
          body: "Ejecuta varios agentes a la vez, cada uno en su pestaña, en macOS, Windows y Linux. Revisa el diff de cada cambio y consulta su vista previa.",
        },
        mobile: {
          name: "Mobile",
          body: "La app más reciente de OpenCode. Llama a una sesión para hablar con el agente y luego revisa y aprueba sus cambios desde el móvil, estés donde estés.",
        },
        terminal: {
          name: "Terminal",
          body: "Una interfaz de terminal que funciona en cualquier shell, editor o servidor remoto. Revisa el diff de cada edición y elige qué comandos se ejecutan automáticamente.",
        },
        sdk: {
          body: "Un cliente tipado de TypeScript para scripts, tareas de CI y tus propias herramientas. Crea sesiones, envía prompts y transmite eventos en tiempo real.",
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
          body: "Si necesitas ayuda con OpenCode, abre un issue o pregunta a la comunidad. Si tienes dudas sobre tu cuenta o la facturación, escríbenos.",
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
          body: "Reporta vulnerabilidades en GitHub. Si no recibes respuesta en 6 días hábiles, escríbenos.",
          links: {
            "report-a-vulnerability": {
              text: "Reportar una vulnerabilidad",
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
    mini: {
      lead: "Mini viene con OpenCode CLI. Instálala con cualquiera de estos comandos y luego ejecuta opencode mini.",
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
      "Con OpenCode Mobile puedes controlar OpenCode a distancia. Las sesiones siguen ejecutándose en tu equipo y puedes verlas y dirigirlas desde la app.",
    steps: {
      "get-the-app": {
        title: "Consigue la app",
        body: "Instala la beta de OpenCode en tu iPhone desde TestFlight o instala la app en tu teléfono Android.",
      },
      "run-this-on-your-computer": {
        title: "Ejecuta esto en tu equipo",
        body: "El comando muestra un enlace y un código QR de un solo uso. Ambos caducan en 5 minutos.",
      },
      "scan-the-code": {
        title: "Escanea el código",
        body: "Escanea el código QR con la app o pega el enlace. Las sesiones recientes de tu equipo se abrirán en el móvil.",
      },
    },
    note: "--remote se conecta a través de una dirección de OpenTunnel, así que funciona desde cualquier red. En la misma Wi-Fi, ejecuta una vez opencode service set hostname 0.0.0.0 y luego opencode pair.",
    facts: [
      "Puedes vincular tu móvil desde cualquier red, porque --remote se conecta a través de una dirección de OpenTunnel.",
      "El enlace y el código son de un solo uso y caducan en 5 minutos.",
      "Deja tu equipo encendido: el agente se ejecuta ahí, no en el móvil.",
      "En la misma Wi-Fi, ejecuta una vez opencode service set hostname 0.0.0.0 y luego opencode pair.",
    ],
  },
  announcements: {
    "create-install-and-share-desktop-plugins": {
      text: "Crea, instala y comparte plugins de escritorio.",
      link: "Novedades de la 2.2",
    },
    "desktop-terminals-now-survive-restarts": {
      text: "Las terminales de Desktop se conservan tras reiniciar.",
      link: "Ver v2.2.4",
    },
    "agents-can-now-generate-images": {
      text: "Los agentes ya pueden generar imágenes.",
      link: "Ver v2.2.1",
    },
    "steer-your-sessions-from-your-phone": {
      text: "Dirige tus sesiones desde el móvil.",
      link: "Conoce OpenCode Mobile",
    },
    "a-refreshed-desktop-app": {
      text: "Una app de escritorio renovada.",
      link: "Novedades de la 2.2",
    },
  },
} satisfies ContentOverlay
