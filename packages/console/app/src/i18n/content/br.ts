import type { ContentOverlay } from "./source"

export const content = {
  announcements: {
    "create-install-and-share-desktop-plugins": {
      text: "Crie, instale e compartilhe plugins no desktop.",
      link: "Veja as novidades da 2.2",
    },
    "use-your-claude-code-login-in-opencode": {
      text: "Use seu login do Claude Code no OpenCode.",
      link: "Ver v2.2.3",
    },
    "desktop-terminals-now-survive-restarts": {
      text: "Os terminais do desktop agora sobrevivem a reinícios.",
      link: "Ver v2.2.4",
    },
    "agents-can-now-generate-images": {
      text: "Agentes agora podem gerar imagens.",
      link: "Ver v2.2.1",
    },
    "steer-your-sessions-from-your-phone": {
      text: "Conduza suas sessões pelo celular.",
      link: "Conheça o OpenCode Mobile",
    },
    "a-refreshed-desktop-app": {
      text: "Um app desktop renovado.",
      link: "Veja as novidades da 2.2",
    },
  },
  products: {
    desktop: {
      name: "Desktop",
      body: "Sessões, abas, diffs, navegador integrado e extensões no macOS, Windows e Linux.",
      action: "Baixar",
    },
    mobile: {
      name: "Mobile",
      body: "Inicie, conduza e aprove sessões pelo celular, onde você estiver.",
      action: "Baixar",
    },
    terminal: {
      name: "Terminal",
      body: "Uma interface de terminal rápida que funciona em qualquer shell, editor ou servidor remoto.",
      action: "Instalar",
    },
    sdk: {
      name: "SDK",
      body: "Controle o OpenCode pelos seus scripts, jobs de CI e ferramentas.",
      action: "Ver docs",
    },
    ide: {
      name: "Extensões de IDE",
      body: "Abra o OpenCode no VS Code, Cursor e Windsurf, ou no Zed e em IDEs JetBrains via ACP.",
      action: "Instalar",
    },
    mini: {
      name: "Mini",
      body: "Uma interface de terminal mínima. As respostas vão para o seu histórico, com um prompt embaixo.",
      action: "Instalar",
    },
  },
  productDetails: {
    desktop: {
      title: "OpenCode | App desktop para macOS, Windows e Linux",
      description:
        "Rode vários agentes do OpenCode ao mesmo tempo, cada um na sua aba. Revise cada mudança como diff, comente qualquer linha e veja o resultado no navegador integrado.",
      intro:
        "Rode vários agentes ao mesmo tempo, cada sessão na sua própria aba. Revise cada mudança como diff, comente qualquer linha e confira o resultado no navegador integrado. Para macOS, Windows e Linux.",
      features: {
        "built-in-terminal": {
          title: "Terminal integrado",
          body: "Rode comandos em uma aba de terminal ao lado da sessão.",
        },
        "ssh-servers": {
          title: "Servidores SSH",
          body: "Conecte-se a outra máquina por SSH e trabalhe nos projetos dela.",
        },
        extensions: {
          title: "Extensões",
          body: "Gerencie servidores MCP, plugins e skills em um só menu.",
        },
        wsl: {
          title: "WSL",
          body: "No Windows, rode sessões em uma distro WSL 2 em vez de nativamente.",
        },
        "office-files": {
          title: "Arquivos Office",
          body: "Abra arquivos do Word, Excel e PowerPoint ao lado da sessão.",
        },
        "keyboard-shortcuts": {
          title: "Atalhos de teclado",
          body: "Toda ação tem um atalho de teclado, e você pode mudar qualquer um.",
        },
        "updates-itself": {
          title: "Autoatualização",
          body: "Novas versões são baixadas e instaladas pelo próprio app.",
        },
        "all-your-projects": {
          title: "Todos os projetos",
          body: "Alterne entre projetos e suas sessões em uma só janela.",
        },
      },
      showcase: {
        "sessions-in-tabs": {
          title: "Sessões em abas",
          body: "Vários agentes trabalhando ao mesmo tempo, cada sessão na sua aba.",
        },
        "review-and-comment": {
          title: "Revise e comente",
          body: "Leia cada mudança como diff, comente uma linha e envie de volta.",
        },
        "see-it-in-the-browser": {
          title: "Veja no navegador",
          body: "O trabalho do agente abre num navegador ao lado da sessão.",
        },
        "pair-your-phone": {
          title: "Pareie o celular",
          body: "Leia um QR code no OpenCode Mobile para conduzir sessões pelo iPhone.",
        },
      },
    },
    mobile: {
      title: "OpenCode | Mobile, suas sessões de código no seu celular",
      description:
        "Inicie, conduza e aprove sessões do OpenCode pelo celular. Fale com o agente, revise as mudanças e permita o que ele precisa, enquanto ele roda no seu computador.",
      intro:
        "Inicie, conduza e aprove sessões pelo celular, onde você estiver. Ligue para uma sessão e fale com o agente, revise as mudanças e permita o que ele precisa, tudo no OpenCode rodando no seu próprio computador.",
      features: {
        "notify-when-done": {
          title: "Aviso ao terminar",
          body: "Receba um resumo curto quando uma sessão que você iniciou terminar.",
        },
        "pair-from-anywhere": {
          title: "Pareie de qualquer lugar",
          body: "Conecte-se de qualquer rede com opencode pair --remote.",
        },
        "every-computer": {
          title: "Cada computador",
          body: "Alterne entre os computadores pareados com um toque.",
        },
        "siri-and-shortcuts": {
          title: "Siri e Atalhos",
          body: "Inicie uma chamada ou sessão pela Siri ou pela Central de Controle.",
        },
        "follow-along": {
          title: "Acompanhe",
          body: "Veja a linha do tempo se atualizar enquanto o agente trabalha.",
        },
        "your-computer": {
          title: "Seu computador",
          body: "Conecta ao OpenCode rodando na sua própria máquina.",
        },
        "share-sheet": {
          title: "Compartilhar",
          body: "Compartilhe qualquer coisa com uma sessão sem abrir o app.",
        },
        "mute-sessions": {
          title: "Silenciar sessões",
          body: "Mantenha uma sessão na lista sem receber as notificações dela.",
        },
      },
      showcase: {
        voice: {
          title: "Voz",
          body: "Ligue e diga o que precisa. O agente responde em voz alta.",
        },
        approvals: {
          title: "Aprovações",
          body: "Revise a mudança e aprove pelo celular quando o agente pedir.",
        },
        sessions: {
          title: "Sessões",
          body: "Abra qualquer sessão para ver onde ela está e continue de onde parou.",
        },
        steer: {
          title: "Conduza",
          body: "Envie uma nova mensagem para mudar o rumo no meio da sessão.",
        },
        results: {
          title: "Resultados",
          body: "Quando o trabalho que você pediu termina, a chamada conta o que mudou.",
        },
      },
    },
    terminal: {
      title: "OpenCode | Interface de terminal do agente de código aberto",
      description:
        "Uma interface de terminal rápida para o OpenCode que funciona em qualquer shell, editor ou servidor remoto. Descreva o que quer, veja cada edição como diff e aprove comandos.",
      intro:
        "Uma interface de terminal rápida que funciona em qualquer shell, editor ou servidor remoto. Descreva o que quer em palavras simples, veja cada edição chegar como diff e escolha quais comandos rodam sozinhos.",
      features: {
        "any-terminal": {
          title: "Todo terminal",
          body: "Funciona em qualquer shell, no terminal do seu editor ou em um servidor remoto.",
        },
        "diffs-in-the-timeline": {
          title: "Diffs na linha do tempo",
          body: "Veja cada edição como diff na linha do tempo, conforme o agente a faz.",
        },
        "pick-up-later": {
          title: "Continue depois",
          body: "Retome a última sessão com -c, ou qualquer uma com -s.",
        },
        "one-off-runs": {
          title: "Uso avulso",
          body: "opencode run envia uma mensagem e imprime a resposta.",
        },
        "agents-and-commands": {
          title: "Agentes e comandos",
          body: "Troque de agente com shift+tab e abra todos os comandos com ctrl+p.",
        },
        "auto-approve": {
          title: "Autoaprovação",
          body: "Rode com --auto para permitir toda ação que você não negou.",
        },
        "any-server": {
          title: "Todo servidor",
          body: "Conecte-se a um servidor OpenCode pela URL com --server.",
        },
        "usage-stats": {
          title: "Estatísticas",
          body: "opencode stats mostra estatísticas de uso para compartilhar.",
        },
      },
      showcase: {
        "ask-in-plain-words": {
          title: "Peça em palavras simples",
          body: "Digite o que quer, e o agente mostra o plano enquanto trabalha.",
        },
        "approve-what-runs": {
          title: "Aprove o que roda",
          body: "Edições aparecem como diffs, e comandos esperam sua permissão.",
        },
        "make-it-yours": {
          title: "Do seu jeito",
          body: "Troque de tema com uma tecla, do padrão ao tokyonight e outros.",
        },
        mini: {
          title: "Mini",
          body: "Rode opencode mini e as respostas vão para o seu histórico.",
        },
      },
    },
    sdk: {
      title: "OpenCode | SDK TypeScript para scripts, jobs de CI e ferramentas",
      description:
        "Controle o OpenCode pelos seus scripts, jobs de CI e ferramentas. O cliente TypeScript tipado cria sessões, envia prompts e transmite cada evento em tempo real.",
      intro:
        "Controle o OpenCode pelos seus scripts, jobs de CI e ferramentas. O SDK roda o OpenCode dentro do seu processo, com sua configuração e seus modelos, e o cliente tipado cria sessões, envia prompts e transmite cada evento.",
      features: {
        "typescript-client": {
          title: "Cliente TypeScript",
          body: "Requisições e eventos tipados, com os mesmos valores de @opencode/client.",
        },
        "sessions-from-code": {
          title: "Sessões pelo código",
          body: "Crie sessões e envie prompts de qualquer script.",
        },
        "any-model": {
          title: "Todo modelo",
          body: "Usa os modelos que o seu OpenCode tiver configurados.",
        },
        "npm-or-bun": {
          title: "npm ou bun",
          body: "Instale com npm i @opencode/sdk ou bun add @opencode/sdk.",
        },
        "in-process-host": {
          title: "Host no processo",
          body: "Roda o OpenCode na memória, sem passar pela rede.",
        },
        "your-plugins": {
          title: "Seus plugins",
          body: "Passe seus próprios plugins ao criar o host no processo.",
        },
        "promise-or-effect": {
          title: "Promise ou Effect",
          body: "Uma API Promise e uma API Effect com os mesmos valores.",
        },
        "cloudflare-workers": {
          title: "Cloudflare Workers",
          body: "Rode o OpenCode em um Durable Object da Cloudflare no Workers.",
        },
      },
      showcase: {
        "fix-ci-from-code": {
          title: "Corrija o CI",
          body: "Um script pede ao OpenCode para corrigir testes com falha e os roda de novo.",
        },
        "follow-every-step": {
          title: "Acompanhe cada passo",
          body: "Transmita eventos para ver cada ferramenta que o agente chama, em tempo real.",
        },
        "build-your-own-tools": {
          title: "Crie suas ferramentas",
          body: "Integre o OpenCode a bots, dashboards e fluxos de trabalho com poucas linhas.",
        },
        "in-your-process": {
          title: "No seu processo",
          body: "Roda o OpenCode no seu processo, com sua configuração e seus modelos.",
        },
      },
    },
    ide: {
      title: "OpenCode | Integrações com editores como VS Code, Cursor e Zed",
      description:
        "Use o OpenCode no seu editor, com a extensão para VS Code, Cursor, Windsurf e VSCodium, e opencode acp para Zed, IDEs JetBrains e outros editores ACP.",
      intro:
        "Use o OpenCode no seu editor. No VS Code, Cursor, Windsurf e VSCodium, rode opencode no terminal integrado e a extensão se instala sozinha. Zed, IDEs JetBrains e outros editores compatíveis com o Agent Client Protocol rodam o OpenCode com opencode acp.",
      features: {
        "quick-launch": {
          title: "Abertura rápida",
          body: "Cmd+Esc ou Ctrl+Esc abre o OpenCode em um terminal dividido.",
        },
        "new-session": {
          title: "Nova sessão",
          body: "Cmd+Shift+Esc ou Ctrl+Shift+Esc inicia outra sessão.",
        },
        context: {
          title: "Contexto",
          body: "Compartilha sua seleção ou aba atual com o OpenCode.",
        },
        "file-references": {
          title: "Citar arquivos",
          body: "Cmd+Option+K ou Alt+Ctrl+K insere @File#L37-42.",
        },
        "installs-itself": {
          title: "Instala sozinha",
          body: "Rode opencode no terminal integrado para adicioná-la.",
        },
        "acp-editors": {
          title: "Editores ACP",
          body: "Zed, IDEs JetBrains, Avante.nvim e CodeCompanion.nvim.",
        },
        "open-vsx": {
          title: "Open VSX",
          body: "Também no Open VSX para Cursor, Windsurf e VSCodium.",
        },
        "same-agent": {
          title: "Mesmo agente",
          body: "O OpenCode que você roda no terminal, ao lado do seu código.",
        },
      },
    },
    mini: {
      title: "OpenCode | Mini, uma interface de terminal mínima para o agente",
      description:
        "O Mini roda o OpenCode em uma interface de terminal mínima. As respostas vão para o histórico do próprio terminal, e só um prompt e uma linha de status ficam embaixo.",
      intro:
        "Uma interface de terminal mínima para o OpenCode. Rode opencode mini e as respostas vão direto para o histórico do seu terminal, para você rolar, buscar e copiar como qualquer outra saída. Só o prompt e uma linha de status ficam embaixo.",
      features: {
        "your-scrollback": {
          title: "Seu histórico",
          body: "As respostas viram histórico comum do terminal.",
        },
        "one-prompt": {
          title: "Um prompt",
          body: "Agente, modelo, contexto e custo em uma linha de status.",
        },
        permissions: {
          title: "Permissões",
          body: "Permita edições e comandos na área do prompt.",
        },
        "how-much-shows": {
          title: "Quanto aparece",
          body: "Discreto, padrão ou tudo, para raciocínio e saída de ferramentas.",
        },
        "pick-up-later": {
          title: "Continue depois",
          body: "Retome a última sessão com -c, ou qualquer uma com -s.",
        },
        "same-opencode": {
          title: "Mesmo OpenCode",
          body: "O mesmo servidor, agentes e modelos dos outros apps.",
        },
        agents: {
          title: "Agentes",
          body: "Troque de agente direto no prompt.",
        },
        compact: {
          title: "Compactar",
          body: "Encolha uma sessão longa com /compact.",
        },
      },
    },
  },
  extensionCard: {
    name: "Extensões",
    body: "Use o OpenCode no VS Code, ou no Zed e em outros editores via ACP.",
    action: "Instalar",
  },
  extensions: {
    browse: {
      name: "Browse",
      body: "Deixe agentes usarem seu navegador de verdade.",
      title: "OpenCode | Browse, seu navegador real para agentes de programação",
      description:
        "Browse deixa o OpenCode e outros clientes MCP usarem seu navegador de verdade. Agentes controlam abas em segundo plano com Playwright e devolvem logins e 2FA a você.",
      intro:
        "Um servidor MCP e uma extensão do Chromium que deixam seus agentes usarem seu navegador de verdade, com suas abas, seus logins e suas extensões. Eles abrem e controlam abas com Playwright, tiram capturas de tela e gravam a tela, em abas de segundo plano agrupadas fora do seu caminho. Quando é a sua vez, para um login, um código 2FA ou um pagamento, eles devolvem a aba a você e continuam quando você clica em Continue.",
      features: {
        "your-real-browser": {
          title: "Seu navegador real",
          body: "Chrome, Edge, Brave, Arc, Helium, Vivaldi, Opera e Chromium.",
        },
        "out-of-your-way": {
          title: "Fora do caminho",
          body: "As abas dos agentes abrem em segundo plano, em grupos recolhidos.",
        },
        handoffs: {
          title: "Sua vez",
          body: "Faça você mesmo o login ou o 2FA e clique em Continue.",
        },
        "lend-a-tab": {
          title: "Ceda uma aba",
          body: "Clique no botão da barra para passar a um agente uma aba aberta.",
        },
        "record-and-capture": {
          title: "Grave e capture",
          body: "Capturas de tela, gravações de tela e tráfego de rede em HAR.",
        },
        "any-mcp-client": {
          title: "Todo cliente MCP",
          body: "OpenCode, Claude Code, Cursor, Codex, Zed e muitos outros.",
        },
        "named-sessions": {
          title: "Sessões nomeadas",
          body: "Cada sessão mantém suas abas, mesmo após reiniciar.",
        },
        allowlists: {
          title: "Lista de sites",
          body: "Limite as abas de uma sessão aos sites que você escolher.",
        },
      },
      install:
        "Rode isto uma vez. Adiciona o servidor MCP browse aos agentes que você escolher e pareia a extensão da Chrome Web Store. Requer Node.js 22.19 ou mais recente.",
    },
  },
  apps: {
    hex: {
      category: "Ditado por voz",
      body: "Ditado por voz no aparelho para qualquer app.",
    },
    opentunnel: {
      category: "Túneis locais",
      body: "URLs HTTPS públicas para apps locais.",
    },
    opentui: {
      category: "Biblioteca",
      body: "Uma biblioteca para interfaces de terminal.",
    },
  },
  getStarted: {
    title: "Comece agora",
    lead: "O jeito mais fácil de começar é baixar o OpenCode e usar os modelos grátis. Não precisa de conta. Para mais, traga sua própria assinatura ou use o OpenCode Go.",
    phrases: {
      "download-opencode": {
        text: "baixar o OpenCode",
      },
      "free-models": {
        text: "modelos grátis",
      },
      "your-own-subscription": {
        text: "sua própria assinatura",
      },
      "a-subscription-you-already-have": {
        text: "uma assinatura que você já tem",
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
      "claude-code": {
        name: "Claude Code",
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
        title: "Baixe",
        line: "Desktop, mobile ou terminal.",
      },
      "use-free-models": {
        title: "Use modelos grátis",
        line: "O OpenCode vem com um conjunto de modelos grátis. Não precisa de conta.",
      },
      "add-more-models": {
        title: "Adicione modelos",
        line: "Traga sua própria assinatura ou use os modelos selecionados do OpenCode Go a partir de US$ 10/mês.",
      },
    },
    sentence:
      "Baixe o OpenCode, comece com modelos grátis e traga sua própria assinatura ou o OpenCode Go quando quiser mais.",
  },
  byos: {
    title: "Use suas assinaturas",
    headline: "Use as assinaturas que você já tem.",
    line: "Entre com ChatGPT Plus ou Pro, GitHub Copilot ou Claude Code. Ou use uma assinatura OpenCode.",
    yours: {
      label: "Sua assinatura",
      items: {
        "chatgpt-plus-pro": {
          name: "ChatGPT Plus/Pro",
        },
        "github-copilot": {
          name: "GitHub Copilot",
        },
        "claude-code": {
          name: "Claude Code",
        },
      },
    },
    planLinks: ["assinatura OpenCode", "OpenCode Go"],
    ours: {
      label: "Planos OpenCode",
    },
  },
  brand: {
    hero: {
      copy: {
        text: "Regras para agente",
        copied: "Regras copiadas",
      },
    },
    naming: {
      title: "Nome",
      body: "Escreva OpenCode como uma palavra só, com O e C maiúsculos. Não escreva Opencode, Open Code, OpenCode AI nem Open-Code.",
      code: "Use `opencode` em minúsculas só em código e nomes de pacotes, como `opencode-figma` ou `@acme/opencode-plugin`.",
    },
    families: {
      logo: {
        title: "Logo",
        body: "O logo sozinho, para ícones de apps, avatares e outros espaços pequenos. As versões quadradas têm margem para lugares que cortam em quadrado.",
        assets: {
          light: {
            name: "Claro",
          },
          dark: {
            name: "Escuro",
          },
          "square-light": {
            name: "Quadrado, claro",
          },
          "square-dark": {
            name: "Quadrado, escuro",
          },
        },
      },
      wordmark: {
        title: "Logotipo",
        body: "O nome completo com as letras do OpenCode. Use sempre que houver espaço para escrever o nome por extenso.",
        assets: {
          light: {
            name: "Claro",
          },
          dark: {
            name: "Escuro",
          },
        },
      },
      "simple-wordmark": {
        title: "Logotipo simples",
        body: "Uma versão do logotipo em uma só cor, para impressão, bordado e lugares que só permitem uma cor.",
        assets: {
          light: {
            name: "Claro",
          },
          dark: {
            name: "Escuro",
          },
        },
      },
    },
    icons: {
      title: "Avatares",
      body: "Avatares quadrados de 1024px para Slack, Discord, GitHub e outros perfis. O fundo preenche todo o quadrado e o logo fica bem dentro do círculo, então resistem a um corte redondo.",
      items: {
        dark: {
          name: "Escuro",
        },
        light: {
          name: "Claro",
        },
      },
    },
    colors: {
      title: "Cores",
      body: "O logo e o logotipo usam uma tinta em três opacidades, com uma tinta mais clara para fundos escuros. Os valores abaixo são essa tinta sobre branco ou #0B0B0B, como os arquivos padrão a mostram. Clique em um valor para copiá-lo.",
      palettes: {
        light: {
          name: "Claro",
          swatches: {
            ink: {
              name: "Tinta",
              use: "O contorno do logo e as letras de “code”.",
            },
            "ink-70": {
              name: "Tinta 70%",
              use: "As letras de “open”.",
              ink: "A tinta com 70% de opacidade.",
            },
            "ink-20": {
              name: "Tinta 20%",
              use: "O tom interno do logo.",
              ink: "A tinta com 20% de opacidade.",
            },
          },
        },
        dark: {
          name: "Escuro",
          swatches: {
            ink: {
              name: "Tinta",
              use: "O contorno do logo e as letras de “code”.",
            },
            "ink-72": {
              name: "Tinta 72%",
              use: "As letras de “open”.",
              ink: "A tinta com 72% de opacidade.",
            },
            "ink-28": {
              name: "Tinta 28%",
              use: "O tom interno do logo.",
              ink: "A tinta com 28% de opacidade.",
            },
          },
        },
      },
    },
    variants: {
      title: "Variantes",
      body: "Escolha a versão que deixa o logo nítido no seu fundo, escura em fundos claros e clara em fundos escuros. O logo e o logotipo são arquivos separados, então use um ou outro.",
      groups: {
        default: {
          name: "Padrão",
          body: "O logo para usar em quase tudo. O tom interno é transparente. Sobre branco ou preto ele fica igual aos cinzas de dois tons, e sobre fotos, degradês e cores o fundo aparece por trás.",
          rows: {
            logo: {
              title: "Logo",
              tiles: {
                dark: {
                  name: "Escuro",
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
                  name: "Escuro",
                },
                light: {
                  name: "Claro",
                },
              },
            },
          },
        },
        simple: {
          name: "Simples",
          body: "Uma cor, com miolos abertos e sem tom interno. Use em fundos de cor chapada, em impressão de uma cor e onde não der para usar os cinzas, o simples escuro em cores claras e o simples claro em cores escuras.",
          rows: {
            wordmark: {
              title: "Logotipo",
              tiles: {
                dark: {
                  name: "Escuro",
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
      body: "Use as versões claras em fundos claros e as escuras em fundos escuros. O logo e o logotipo são separados. Use um ou outro, nunca os dois juntos.",
      stroke: {
        title: "Um traço",
        body: "As regras de espaçamento desta página são medidas em traços. Um traço é a espessura do contorno do logo, um quarto da sua largura, então o logo tem 4 traços de largura e 5 de altura.",
      },
      clearSpace: {
        title: "Área de respiro",
        body: "Deixe pelo menos dois traços de espaço em todos os lados do logo e do logotipo. No logo, um traço é a espessura do contorno, um quarto da largura. No logotipo, é a espessura das letras, um sétimo da altura.",
      },
      pixels: {
        title: "Pixels inteiros",
        body: "As proporções do logo são fixas em 4:5, e um traço é um quarto da largura. Redimensione em passos de 4 × 5px, para que cada borda e cada traço caia em um pixel inteiro.",
        do: "manter cada borda e o traço de 4px em pixels inteiros.",
        dont: "use tamanhos fora de 4:5, ou as bordas caem entre pixels e ficam borradas.",
        sizes: {
          logo: {
            title: "Logo",
          },
          wordmark: {
            title: "Logotipo",
          },
        },
      },
      minimumTitle: "Tamanhos mínimos",
      minimum: {
        logo: {
          title: "Logo",
          body: "Pelo menos 16 × 20px, com traço de 4px. Menor que isso, fica borrado.",
        },
        wordmark: {
          title: "Logotipo",
          body: "Pelo menos 117 × 21px, com traço de 3px. Menor que isso, fica borrado.",
        },
      },
    },
    donts: {
      title: "Não faça",
      body: "Erros comuns a evitar ao usar o logo e o logotipo.",
      examples: {
        "two-tone": {
          caption: "recolorir o logo com outras cores.",
        },
        bright: {
          caption: "usar uma única cor vibrante.",
        },
        gradient: {
          caption: "preencher o logo com degradê.",
        },
        inverted: {
          caption: "inverter os tons.",
        },
        stretch: {
          caption: "esticar ou achatar o logo.",
        },
        shadow: {
          caption: "adicionar sombras.",
        },
        glow: {
          caption: "adicionar brilhos ou contornos.",
        },
        lockup: {
          caption: "colocar outras palavras ao lado do logo.",
        },
        "low-contrast": {
          caption: "usar cinza sobre cinza com pouco contraste.",
        },
        color: {
          caption: "colocar o logo cinza de dois tons sobre fundo colorido, onde os cinzas ficam sujos.",
        },
      },
    },
    integrations: {
      title: "Integrações",
      body: "Plugins, provedores e ferramentas que funcionam com o OpenCode, e projetos feitos com ele, podem dizer isso. Use um selo ou um lockup de parceria, e dê ao seu projeto um nome que deixe claro que ele é seu.",
      badges: {
        body: "Coloque um selo no seu README, docs ou site com link para opencode.ai. Escolha o arquivo claro ou escuro para o seu fundo (o HTML alterna sozinho) e não mude as cores nem o texto.",
        sizes: "Todo estilo vem em 20, 32 e 44px (Shields só em 20px), em SVG e em PNG a 2×.",
        mono: "Cada arquivo também vem com texto em OpenTUI Mono. Adicione -mono antes da extensão, como em opencode-works-with-a-light-20-mono.svg, ou -mono-caps para OpenTUI Mono em maiúsculas.",
        groups: {
          "works-with": {
            title: "Funciona com",
            alt: "Funciona com OpenCode",
            body: "Para plugins, provedores e ferramentas que rodam com o OpenCode.",
          },
          "built-with": {
            title: "Feito com",
            alt: "Feito com OpenCode",
            body: "Para projetos feitos com o OpenCode.",
          },
        },
        styles: {
          a: {
            name: "Moldura",
          },
          c: {
            name: "Células",
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
        title: "Lockup de parceria",
        body: "Coloque o logo do OpenCode e o logo do parceiro lado a lado, com um × entre eles. Deixe 3 traços de espaço de cada lado do ×, ajuste o logo do parceiro para parecer tão alto quanto o do OpenCode e mantenha área de respiro em volta de todo o conjunto.",
        partners: {
          github: {
            name: "GitHub",
          },
        },
      },
      naming: {
        title: "Nome do seu projeto",
        body: "Comece pelo seu próprio nome, para deixar claro que o projeto é seu.",
        rule: "Escreva `Linear for OpenCode` ou chame o pacote de `opencode-linear`. Não escreva `OpenCode Linear` nem `Linear by OpenCode`.",
      },
    },
    trademarks: {
      title: "Marcas",
      body: "OpenCode e o logo do OpenCode são marcas registradas da Anomaly. Não as use para sugerir que a Anomaly apoia ou patrocina você, no nome do seu produto ou empresa, nem em produtos à venda sem permissão.",
      contact: {
        before: "Em caso de dúvidas, escreva para ",
        after: ".",
      },
    },
  },
  press: {
    title: "OpenCode | Kit de imprensa com dados da empresa e da marca",
    description:
      "O kit de imprensa do OpenCode, com dados sobre o OpenCode e a Anomaly, a empresa por trás dele, além de logos e logotipos para baixar e um contato para a imprensa.",
    hero: {
      title: "Imprensa",
      body: "Dados, ativos da marca e contatos para escrever sobre o OpenCode e a Anomaly.",
    },
    company: {
      title: "Sobre a Anomaly",
      lead: "A Anomaly é a empresa por trás do OpenCode. Ela cria ferramentas de código aberto para desenvolvedores.",
      more: "Outros projetos incluem SST e OpenTUI, todos de código aberto no [GitHub](github).",
      learnMore: "Para saber mais, acesse [anoma.ly](site).",
      projects: {
        opencode: {
          name: "OpenCode",
          body: "O agente de programação de código aberto, com apps para desktop, mobile e terminal, e um SDK. Licença MIT, mais de 220.000 estrelas no GitHub.",
        },
        sst: {
          name: "SST",
          body: "Um framework para criar apps full-stack na sua própria infraestrutura. Licença MIT, aberto desde 2020, com mais de 26.000 estrelas no GitHub.",
        },
        opentui: {
          name: "OpenTUI",
          body: "Uma biblioteca para interfaces de terminal em TypeScript, React ou Solid, com núcleo em Zig. O OpenCode a usa em produção. Mais de 13.000 estrelas no GitHub.",
        },
        "models-dev": {
          name: "Models.dev",
          body: "Um banco de dados aberto de especificações, preços e recursos de modelos de IA, com uma API pública. Lista mais de 8.900 modelos de mais de 200 provedores.",
        },
        hex: {
          name: "Hex",
          body: "Ditado por voz para Mac, Windows e Linux. O Hex transcreve no seu aparelho e cola em qualquer app, então o áudio nunca sai dele.",
        },
        opentunnel: {
          name: "OpenTunnel",
          body: "Uma CLI e um SDK que dão aos apps da sua máquina uma URL HTTPS pública. O TLS termina na sua máquina, então o relay nunca vê texto puro.",
        },
      },
    },
    about: {
      title: "Sobre o OpenCode",
      boilerplate: {
        long: "OpenCode é um agente de programação de código aberto. Ele vem como app desktop, app mobile, interface de terminal e SDK, e funciona com modelos de qualquer provedor, incluindo Claude, GPT e Gemini. O OpenCode tem licença MIT e é feito pela Anomaly. Tem mais de 220.000 estrelas no GitHub e mais de 1.000 colaboradores, e mais de 22 milhões de desenvolvedores o usam todo mês.",
        short:
          "OpenCode é um agente de programação de código aberto da Anomaly, com apps para desktop, mobile e terminal, e um SDK.",
      },
      products: {
        "opencode-console": {
          name: "OpenCode Console",
          long: "O OpenCode Console é o app web onde desenvolvedores e equipes compram e gerenciam acesso a modelos de IA para o OpenCode e outros agentes de programação. Ele oferece inferência pré-paga para modelos de fronteira e de pesos abertos, cobrada por requisição a partir de créditos, e assinaturas do OpenCode Go. Equipes têm workspaces com funções de Member, Admin e Owner, limites de gasto por workspace e por usuário, login único com Okta, Microsoft Entra ID ou Google Workspace, e SCIM. O Console aceita mais de 30 provedores, então as equipes podem conectar contas que já têm, e a inferência própria é opcional. Fica em opencode.ai/console.",
          short:
            "O OpenCode Console é o app web da Anomaly para acesso pré-pago a modelos de IA, assinaturas do OpenCode Go e controles de equipe como orçamentos e login único.",
        },
        "opencode-go": {
          name: "OpenCode Go",
          long: "O OpenCode Go é uma assinatura para desenvolvedores que querem um preço mensal fixo para modelos de programação. O Go custa US$ 10/mês, o Go Plus custa US$ 40/mês com limites maiores, e o Go Teams custa US$ 20/mês por membro. Cada plano inclui um conjunto selecionado de modelos testados para programação com agentes. Os limites de uso são valores mensais em dólares para cada modelo, com cotas contínuas de 5 horas e semanais de 20% e 50% do limite mensal. Assinantes podem recarregar créditos, recorrer a um saldo pré-pago e cancelar quando quiserem. O Go funciona com o OpenCode e outros agentes. Fica em opencode.ai/console/go.",
          short:
            "O OpenCode Go é uma assinatura mensal da Anomaly que dá aos desenvolvedores limites de uso mensais em um conjunto selecionado de modelos de programação, a partir de US$ 10/mês.",
        },
        "opencode-data": {
          name: "OpenCode Data",
          long: "O OpenCode Data é um painel público que mostra quais modelos de IA os desenvolvedores usam no OpenCode e como essa combinação muda ao longo do tempo. Ele publica um ranking dos principais modelos, uso de tokens, custos por sessão e por token, taxas de cache, participação de mercado e uma divisão por país. Os números são agregados a cada hora, com dias e semanas em UTC. As contagens de usuários e sessões são aproximadas, e os custos usam preços de tabela do catálogo de modelos do OpenCode. Jornalistas podem citá-lo como OpenCode Data (opencode.ai/data), com o horário de atualização mostrado na página.",
          short:
            "O OpenCode Data é um painel público em opencode.ai/data que classifica modelos de IA pelo uso real no OpenCode, com tokens, custos e participação de mercado atualizados a cada hora.",
        },
      },
    },
    facts: {
      title: "Em resumo",
      items: {
        license: {
          label: "Licença",
        },
        "first-release": {
          label: "Primeira versão",
        },
        "made-by": {
          label: "Feito por",
        },
      },
    },
    milestones: {
      title: "Marcos",
      items: {
        "first-release-v0-0-1": {
          date: "Abr 2025",
          text: "Primeira versão, v0.0.1",
        },
        "1-million-downloads": {
          date: "Out 2025",
          text: "1 mi+ de downloads",
        },
        "opencode-1-0": {
          date: "Out 2025",
          text: "OpenCode 1.0",
        },
        "desktop-app-ships": {
          date: "Dez 2025",
          text: "App desktop lançado",
        },
        "10-million-downloads": {
          date: "Jan 2026",
          text: "10 mi+ de downloads",
        },
        "opencode-2-0": {
          date: "Set 2026",
          text: "OpenCode 2.0",
        },
        "220-000-github-stars": {
          date: "Nov 2026",
          text: "220.000+ estrelas no GitHub",
        },
      },
    },
    news: {
      title: "Últimas versões",
      intro: "O OpenCode lança versões com frequência. Estas são as mais recentes com novos recursos.",
      changelog: {
        text: "Changelog completo",
      },
      feed: {
        text: "Feed RSS",
      },
    },
    media: {
      title: "Mídia",
      intro:
        "Imagens e vídeos curtos de cada app, gravados do produto real. Você pode usá-los para escrever sobre o OpenCode.",
      note: "Todas as capturas usam o tema escuro. Imagens e capas são JPGs de até 1920 × 1080, ou 1080 × 1350 na vertical. Os vídeos são clipes MP4 sem som.",
      all: {
        text: "Baixar toda a mídia",
      },
      products: {
        desktop: {
          name: "Desktop",
          items: {
            "locked-landscape": {
              title: "Vídeo do Desktop",
            },
            "frame-1": {
              title: "Imagem do Desktop 1",
            },
            "frame-2": {
              title: "Imagem do Desktop 2",
            },
            "frame-3": {
              title: "Imagem do Desktop 3",
            },
            "frame-4": {
              title: "Imagem do Desktop 4",
            },
            "feature-1": {
              title: "Sessões em abas",
            },
            "feature-2": {
              title: "Revise e comente",
            },
            "feature-3": {
              title: "Veja no navegador",
            },
            "locked-portrait": {
              title: "Vídeo do Desktop, vertical",
            },
          },
        },
        mobile: {
          name: "Mobile",
          items: {
            "locked-landscape": {
              title: "Vídeo do Mobile",
            },
            "frame-1": {
              title: "Imagem do Mobile 1",
            },
            "frame-2": {
              title: "Imagem do Mobile 2",
            },
            "frame-3": {
              title: "Imagem do Mobile 3",
            },
            "feature-1": {
              title: "Voz",
            },
            "feature-2": {
              title: "Aprovações",
            },
            "feature-3": {
              title: "Sessões",
            },
            "locked-portrait": {
              title: "Vídeo do Mobile, vertical",
            },
          },
        },
        terminal: {
          name: "Terminal",
          items: {
            "locked-landscape": {
              title: "Vídeo do Terminal",
            },
            "frame-1": {
              title: "Imagem do Terminal 1",
            },
            "frame-2": {
              title: "Imagem do Terminal 2",
            },
            "frame-3": {
              title: "Imagem do Terminal 3",
            },
            "frame-4": {
              title: "Imagem do Terminal 4",
            },
            "feature-1": {
              title: "Peça em palavras simples",
            },
            "feature-2": {
              title: "Aprove o que roda",
            },
            "feature-3": {
              title: "Do seu jeito",
            },
            "locked-portrait": {
              title: "Vídeo do Terminal, vertical",
            },
          },
        },
        sdk: {
          name: "SDK",
          items: {
            "locked-landscape": {
              title: "Vídeo SDK",
            },
            "frame-1": {
              title: "Imagem do SDK 1",
            },
            "frame-2": {
              title: "Imagem do SDK 2",
            },
            "frame-3": {
              title: "Imagem do SDK 3",
            },
            "frame-4": {
              title: "Imagem do SDK 4",
            },
            "feature-1": {
              title: "Corrija o CI",
            },
            "feature-2": {
              title: "Acompanhe cada passo",
            },
            "feature-3": {
              title: "Crie suas ferramentas",
            },
            "locked-portrait": {
              title: "Vídeo SDK, vertical",
            },
          },
        },
      },
    },
    people: {
      title: "Pessoas",
    },
    anomalyLogo: {
      title: "Logo da Anomaly",
      body: "O símbolo e o logotipo da Anomaly, em preto e branco. Os PNGs têm 2048 px de largura.",
      assets: {
        "mark-black": {
          name: "Símbolo, preto",
        },
        "mark-white": {
          name: "Símbolo, branco",
        },
        "wordmark-black": {
          name: "Logotipo, preto",
        },
        "wordmark-white": {
          name: "Logotipo, branco",
        },
      },
      all: {
        text: "Baixar tudo",
      },
    },
    coverage: {
      title: "Na mídia",
    },
    brand: {
      title: "Marca",
      before:
        "Baixe os logos e logotipos do OpenCode em um único arquivo ZIP. Para arquivos individuais, variantes e regras de uso, acesse a página da ",
      link: {
        text: "marca",
      },
      after: ".",
      usage:
        "Você pode usar estes arquivos para escrever sobre o OpenCode. Não os altere e não sugira que o OpenCode apoia o seu trabalho.",
    },
    product: {
      title: "Produto",
      items: {
        desktop: {
          name: "Desktop",
          body: "Rode vários agentes ao mesmo tempo, cada um na sua aba, no macOS, Windows e Linux. Revise cada mudança como diff e veja o resultado.",
        },
        mobile: {
          name: "Mobile",
          body: "O app mais novo do OpenCode. Ligue para uma sessão para falar com o agente e revise e aprove as mudanças pelo celular, de qualquer lugar.",
        },
        terminal: {
          name: "Terminal",
          body: "Uma interface de terminal que funciona em qualquer shell, editor ou servidor remoto. Veja cada edição como diff e escolha quais comandos rodam sozinhos.",
        },
        sdk: {
          name: "SDK",
          body: "Um cliente TypeScript tipado para scripts, jobs de CI e suas ferramentas. Crie sessões, envie prompts e transmita cada evento conforme chega.",
        },
      },
    },
    contact: {
      title: "Contato",
      items: {
        press: {
          title: "Imprensa",
          body: "Para jornalistas e analistas. Respondemos só a pedidos da mídia.",
        },
        support: {
          title: "Suporte",
          body: "Para ajuda com o OpenCode, abra uma issue ou pergunte à comunidade. Para dúvidas de conta e cobrança, mande um e-mail.",
          links: {
            "github-issues": {
              text: "Issues no GitHub",
            },
            "help-anoma-ly": {
              text: "help@anoma.ly",
            },
          },
        },
        security: {
          title: "Segurança",
          body: "Reporte uma vulnerabilidade pelo GitHub. Se ninguém responder em 6 dias úteis, mande um e-mail.",
          links: {
            "report-a-vulnerability": {
              text: "Reportar uma vulnerabilidade",
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
          name: "Script",
        },
      },
    },
    extensions: {
      title: "Extensões",
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
    integrations: {
      title: "Integrações",
      items: {
        github: {
          label: "GitHub",
          body: "Use o OpenCode no GitHub Actions.",
        },
        gitlab: {
          label: "GitLab",
          body: "Use o OpenCode no GitLab CI/CD ou no Duo.",
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
        label: "Ler a documentação do SDK",
      },
    },
    ide: {
      links: {
        "vs-code-marketplace": {
          label: "VS Code Marketplace",
        },
        "open-vsx-cursor-windsurf-vscodium": {
          label: "Open VSX (Cursor, Windsurf, VSCodium)",
        },
      },
      lead: "Rode opencode no terminal integrado do seu editor e a extensão se instala sozinha, ou instale você mesmo.",
      more: {
        label: "Configure o Zed, IDEs JetBrains e outros editores ACP",
      },
    },
    mini: {
      lead: "O Mini vem com a CLI do OpenCode. Instale com qualquer uma destas opções e rode opencode mini.",
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
    title: "Conecte seu celular",
    cardTitle: "Pareie seu celular com um comando",
    intro:
      "O OpenCode Mobile é um controle remoto para o OpenCode no seu computador. Suas sessões continuam rodando lá, e o app as mostra e deixa você conduzi-las.",
    steps: {
      "get-the-app": {
        title: "Baixe o app",
        body: "Instale o beta do OpenCode no iPhone pelo TestFlight. O app para Android chega em breve.",
      },
      "run-this-on-your-computer": {
        title: "Rode isto no computador",
        body: "Ele mostra um link de uso único e um QR code. Funcionam uma vez e expiram em 5 minutos.",
      },
      "scan-the-code": {
        title: "Leia o código",
        body: "Leia o QR code com o app ou cole o link. As sessões recentes do computador abrem no celular.",
      },
    },
    note: "--remote conecta por um endereço OpenTunnel, então funciona de qualquer rede. Na mesma rede Wi-Fi, rode opencode service set hostname 0.0.0.0 uma vez e depois opencode pair.",
    facts: [
      "O pareamento funciona de qualquer rede, porque --remote conecta por um endereço OpenTunnel.",
      "O link e o código funcionam uma vez e expiram em 5 minutos.",
      "Deixe o computador ligado, porque o agente roda nele e não no celular.",
      "Na mesma rede Wi-Fi, rode opencode service set hostname 0.0.0.0 uma vez e depois opencode pair.",
    ],
  },
} satisfies ContentOverlay
