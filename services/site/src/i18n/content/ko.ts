import type { ContentOverlay } from "./source"

export const content = {
  products: {
    desktop: {
      name: "Desktop",
      body: "macOS, Windows, Linux에서 세션, 탭, diff, 내장 브라우저, 확장 프로그램을 사용하세요.",
      action: "다운로드",
    },
    mobile: {
      name: "Mobile",
      body: "어디에 있든 휴대폰으로 세션을 시작하고, 방향을 잡고, 승인하세요.",
      action: "다운로드",
    },
    terminal: {
      name: "Terminal",
      body: "어떤 셸, 에디터, 원격 서버에서도 동작하는 빠른 터미널 UI입니다.",
      action: "설치",
    },
    sdk: { name: "SDK", body: "직접 만든 스크립트, CI 작업, 도구에서 OpenCode를 제어하세요.", action: "문서 읽기" },
    ide: {
      name: "IDE 확장 프로그램",
      body: "VS Code, Cursor, Windsurf에서 OpenCode를 열거나, ACP로 Zed와 JetBrains IDE에서 사용하세요.",
      action: "설치",
    },
    mini: {
      name: "Mini",
      body: "미니멀한 터미널 인터페이스입니다. 답변은 스크롤백에 출력되고, 아래에는 프롬프트 하나만 남습니다.",
      action: "설치",
    },
  },
  productDetails: {
    desktop: {
      title: "OpenCode | macOS, Windows, Linux용 데스크톱 앱",
      description:
        "원하는 만큼 OpenCode 에이전트를 병렬로 실행하고, 옆 브라우저에서 모든 변경 사항을 확인하고, 어떤 기기에서든 이어서 작업하세요. macOS, Windows, Linux용.",
      intro:
        "여러 에이전트를 동시에 실행하고, 세션마다 각자의 탭을 쓰세요. 모든 변경 사항을 diff로 검토하고, 원하는 줄에 댓글을 달고, 내장 브라우저에서 결과를 확인하세요. macOS, Windows, Linux를 지원합니다.",
      showcase: {
        "parallel-agents": {
          title: "병렬 에이전트",
          body: "원하는 만큼 에이전트를 시작하고 모두 병렬로 작업하게 하세요. 작업이 끝나는 대로 에이전트 사이를 오가세요.",
        },
        "see-it-in-the-browser": {
          title: "브라우저에서 확인",
          body: "앱이 에이전트 옆 브라우저에서 열리므로, 당신과 에이전트 모두 모든 변경 사항을 바로 확인할 수 있습니다.",
        },
        "on-every-device": {
          title: "모든 기기에서",
          body: "모든 기기에서 에이전트를 시작하고, 데스크톱 앱, 터미널, 휴대폰에서 이어서 작업하세요.",
        },
        "extend-it": {
          title: "확장하기",
          body: "도구와 서비스를 연결해 에이전트가 무엇이든 다룰 수 있게 하세요. 또는 OpenCode가 스스로 플러그인을 만들게 하고, 사이드바에 전용 UI를 띄우세요.",
        },
      },
    },
    mobile: {
      title: "OpenCode | 휴대폰으로 코딩 에이전트를 조종하는 모바일 앱",
      description:
        "휴대폰에서 OpenCode 세션을 시작하고 조작하세요. 에이전트가 컴퓨터에서 실행되는 동안 대화할 수 있습니다.",
      intro:
        "어디서든 휴대폰에서 세션을 시작하고 조작하세요. 세션에 전화해 에이전트와 대화하거나, 세션을 열어 멈춘 곳에서 이어갈 수 있습니다. 모두 내 컴퓨터에서 실행되는 OpenCode에서 이뤄집니다.",
      features: {
        "notify-when-done": { title: "완료 알림", body: "시작한 세션이 끝나면 짧은 요약을 받아 보세요." },
        "pair-from-anywhere": {
          title: "어디서나 페어링",
          body: "opencode pair --remote로 어떤 네트워크에서든 연결하세요.",
        },
        "every-computer": { title: "모든 컴퓨터", body: "페어링한 컴퓨터 사이를 한 번의 탭으로 전환하세요." },
        "siri-and-shortcuts": { title: "Siri와 단축어", body: "Siri나 제어 센터에서 통화나 세션을 시작하세요." },
        "follow-along": {
          title: "실시간 확인",
          body: "에이전트가 일하는 동안 타임라인이 업데이트되는 모습을 지켜보세요.",
        },
        "your-computer": { title: "내 컴퓨터", body: "내 컴퓨터에서 실행 중인 OpenCode에 연결합니다." },
        "share-sheet": { title: "공유 시트", body: "앱을 열지 않고도 무엇이든 세션으로 공유하세요." },
        "mute-sessions": { title: "세션 무음", body: "알림은 받지 않고 세션을 목록에 남겨 두세요." },
      },
      showcase: {
        results: { title: "결과", body: "요청한 작업이 끝나면 통화로 무엇이 바뀌었는지 알려 줍니다." },
        voice: { title: "음성", body: "세션에 전화를 걸어 필요한 것을 말하세요. 에이전트가 소리 내어 답합니다." },
        sessions: { title: "세션", body: "세션을 열어 진행 상황을 보고, 멈춘 곳에서 바로 이어 가세요." },
        steer: { title: "조종", body: "후속 메시지를 보내 세션 도중에 방향을 바꾸세요." },
      },
    },
    terminal: {
      title: "OpenCode | 오픈 소스 코딩 에이전트를 위한 터미널 UI",
      description:
        "어떤 셸, 에디터, 원격 서버에서도 동작하는 OpenCode의 빠른 터미널 UI입니다. 원하는 것을 설명하고, 모든 편집을 diff로 보고, 명령어를 승인하세요.",
      intro:
        "어떤 셸, 에디터, 원격 서버에서도 동작하는 빠른 터미널 UI입니다. 원하는 것을 평소 말투로 설명하고, 편집이 diff로 반영되는 모습을 지켜보고, 스스로 실행될 명령어를 직접 정하세요.",
      features: {
        "any-terminal": { title: "모든 터미널", body: "어떤 셸, 에디터의 터미널, 원격 서버에서도 동작합니다." },
        "diffs-in-the-timeline": {
          title: "타임라인 속 diff",
          body: "에이전트가 편집할 때마다 타임라인에 diff로 표시됩니다.",
        },
        "pick-up-later": { title: "나중에 이어 하기", body: "-c로 마지막 세션을, -s로 원하는 세션을 이어 가세요." },
        "one-off-runs": { title: "일회성 실행", body: "opencode run은 메시지 하나를 보내고 답변을 출력합니다." },
        "agents-and-commands": {
          title: "에이전트와 명령어",
          body: "shift+tab으로 에이전트를 바꾸고 ctrl+p로 모든 명령어를 여세요.",
        },
        "auto-approve": { title: "자동 승인", body: "--auto로 실행하면 거부하지 않은 모든 작업을 허용합니다." },
        "any-server": { title: "모든 서버", body: "--server로 URL을 지정해 OpenCode 서버에 연결하세요." },
        "usage-stats": { title: "사용 통계", body: "opencode stats는 공유할 수 있는 사용 통계를 보여 줍니다." },
      },
      showcase: {
        "ask-in-plain-words": {
          title: "평소 말투로 요청",
          body: "원하는 것을 입력하면 에이전트가 작업하면서 계획을 보여 줍니다.",
        },
        "approve-what-runs": { title: "실행할 것만 승인", body: "편집은 diff로 표시되고, 명령어는 허락을 기다립니다." },
        "make-it-yours": { title: "내 취향대로", body: "기본 테마부터 tokyonight까지, 키 하나로 테마를 바꾸세요." },
        mini: { title: "Mini", body: "opencode mini를 실행하면 답변이 내 스크롤백에 출력됩니다." },
      },
    },
    sdk: {
      title: "OpenCode | 코드로 에이전트를 제어하는 TypeScript SDK",
      description:
        "직접 만든 스크립트, CI 작업, 도구에서 OpenCode를 제어하세요. 타입이 지정된 TypeScript 클라이언트로 세션을 만들고, 프롬프트를 보내고, 모든 이벤트를 실시간으로 스트리밍합니다.",
      intro:
        "직접 만든 스크립트, CI 작업, 도구에서 OpenCode를 제어하세요. SDK는 내 설정과 모델로 OpenCode를 내 프로세스 안에서 실행하며, 타입이 지정된 클라이언트가 세션을 만들고, 프롬프트를 보내고, 모든 이벤트를 스트리밍합니다.",
      features: {
        "typescript-client": {
          title: "TypeScript 클라이언트",
          body: "@opencode/client와 같은 값을 쓰는 타입 지정 요청과 이벤트.",
        },
        "sessions-from-code": {
          title: "코드로 세션 생성",
          body: "어떤 스크립트에서든 세션을 만들고 프롬프트를 보내세요.",
        },
        "any-model": { title: "모든 모델", body: "OpenCode 설정에 있는 모델을 그대로 사용합니다." },
        "npm-or-bun": { title: "npm 또는 bun", body: "npm i @opencode/sdk 또는 bun add @opencode/sdk로 설치하세요." },
        "in-process-host": {
          title: "인프로세스 호스트",
          body: "네트워크를 거치지 않고 메모리에서 OpenCode를 실행합니다.",
        },
        "your-plugins": { title: "내 플러그인", body: "인프로세스 호스트를 만들 때 직접 만든 플러그인을 넘기세요." },
        "promise-or-effect": { title: "Promise 또는 Effect", body: "같은 값을 돌려주는 Promise API와 Effect API." },
        "cloudflare-workers": {
          title: "Cloudflare Workers",
          body: "Workers의 Cloudflare Durable Object 안에서 OpenCode를 실행하세요.",
        },
      },
      showcase: {
        "in-your-process": {
          title: "내 프로세스 안에서",
          body: "내 설정과 모델로 OpenCode를 내 프로세스 안에서 실행합니다.",
        },
        "fix-ci-from-code": {
          title: "코드로 CI 고치기",
          body: "짧은 스크립트가 OpenCode에게 실패한 테스트를 고치게 한 뒤 다시 실행합니다.",
        },
        "follow-every-step": {
          title: "모든 단계 추적",
          body: "이벤트를 스트리밍해 에이전트가 호출하는 도구를 실시간으로 확인하세요.",
        },
        "build-your-own-tools": {
          title: "나만의 도구 만들기",
          body: "몇 줄의 코드로 OpenCode를 봇, 대시보드, 워크플로에 연결하세요.",
        },
      },
    },
    ide: {
      title: "OpenCode | VS Code, Cursor, Zed 등을 위한 IDE 확장 프로그램",
      description:
        "에디터 안에서 OpenCode를 사용하세요. VS Code, Cursor, Windsurf, VSCodium에는 확장 프로그램이, Zed, JetBrains IDE 등 ACP 에디터에는 opencode acp가 있습니다.",
      intro:
        "에디터 안에서 OpenCode를 사용하세요. VS Code, Cursor, Windsurf, VSCodium에서는 통합 터미널에서 opencode를 실행하면 확장 프로그램이 자동으로 설치됩니다. Zed, JetBrains IDE 등 Agent Client Protocol을 지원하는 에디터에서는 opencode acp로 OpenCode를 실행합니다.",
      features: {
        "quick-launch": { title: "빠른 실행", body: "Cmd+Esc 또는 Ctrl+Esc로 분할 터미널에서 OpenCode를 엽니다." },
        "new-session": { title: "새 세션", body: "Cmd+Shift+Esc 또는 Ctrl+Shift+Esc로 새 세션을 시작합니다." },
        context: { title: "컨텍스트", body: "현재 선택 영역이나 탭을 OpenCode와 공유합니다." },
        "file-references": { title: "파일 참조", body: "Cmd+Option+K 또는 Alt+Ctrl+K로 @File#L37-42를 삽입합니다." },
        "installs-itself": { title: "자동 설치", body: "통합 터미널에서 opencode를 실행하면 추가됩니다." },
        "acp-editors": { title: "ACP 에디터", body: "Zed, JetBrains IDE, Avante.nvim, CodeCompanion.nvim." },
        "open-vsx": { title: "Open VSX", body: "Cursor, Windsurf, VSCodium용으로 Open VSX에도 있습니다." },
        "same-agent": { title: "같은 에이전트", body: "터미널에서 쓰던 그 OpenCode를 코드 바로 옆에서." },
      },
    },
    mini: {
      title: "OpenCode | 에이전트를 위한 미니멀 터미널 인터페이스, Mini",
      description:
        "Mini는 미니멀한 터미널 인터페이스에서 OpenCode를 실행합니다. 답변은 터미널 자체의 스크롤백에 출력되고, 아래에는 프롬프트와 상태 줄만 남습니다.",
      intro:
        "OpenCode를 위한 미니멀한 터미널 인터페이스입니다. opencode mini를 실행하면 답변이 터미널 자체의 스크롤백에 바로 출력되므로, 다른 출력처럼 스크롤하고, 검색하고, 복사할 수 있습니다. 아래에는 프롬프트와 상태 줄만 남습니다.",
      features: {
        "your-scrollback": { title: "내 스크롤백", body: "답변이 평범한 터미널 기록이 됩니다." },
        "one-prompt": { title: "프롬프트 하나", body: "에이전트, 모델, 컨텍스트, 비용을 상태 줄 하나에." },
        permissions: { title: "권한", body: "프롬프트 영역에서 편집과 명령어를 허용하세요." },
        "how-much-shows": { title: "표시 수준", body: "생각 과정과 도구 출력을 조용히, 기본, 전체 중에서 고르세요." },
        "pick-up-later": { title: "나중에 이어 하기", body: "-c로 마지막 세션을, -s로 원하는 세션을 이어 가세요." },
        "same-opencode": { title: "같은 OpenCode", body: "다른 앱과 같은 서버, 에이전트, 모델." },
        agents: { title: "에이전트", body: "프롬프트에서 바로 에이전트를 바꾸세요." },
        compact: { title: "압축", body: "/compact로 긴 세션을 줄이세요." },
      },
    },
  },
  extensionCard: {
    name: "확장 프로그램",
    body: "VS Code 안에서, 또는 ACP로 Zed 등 다른 에디터에서 OpenCode를 사용하세요.",
    action: "설치",
  },
  extensions: {
    browse: {
      name: "Browse",
      body: "에이전트가 실제 브라우저를 쓰게 하세요.",
      title: "OpenCode | Browse, 코딩 에이전트를 위한 실제 브라우저",
      description:
        "Browse는 OpenCode와 다른 MCP 클라이언트가 실제 브라우저를 쓰게 합니다. 에이전트는 Playwright로 백그라운드 탭을 조작하고, 로그인과 2FA는 사용자에게 넘깁니다.",
      intro:
        "MCP 서버와 Chromium 확장 프로그램으로, 에이전트가 내 탭, 내 로그인, 내 확장 프로그램이 있는 실제 브라우저를 쓰게 합니다. 에이전트는 Playwright로 탭을 열고 조작하며, 스크린샷을 찍고 화면을 녹화합니다. 이 탭들은 방해되지 않게 백그라운드에서 그룹으로 묶입니다. 로그인, 2FA, 결제처럼 내가 직접 해야 할 때가 오면 탭을 넘겨주고, 내가 계속을 클릭하면 다시 이어 갑니다.",
      features: {
        "your-real-browser": {
          title: "실제 브라우저",
          body: "Chrome, Edge, Brave, Arc, Helium, Vivaldi, Opera, Chromium.",
        },
        "out-of-your-way": { title: "방해 없이", body: "에이전트 탭은 접힌 그룹으로 백그라운드에서 열립니다." },
        handoffs: { title: "작업 넘기기", body: "로그인이나 2FA는 직접 처리하고, 계속을 클릭하세요." },
        "lend-a-tab": { title: "탭 빌려주기", body: "툴바 버튼을 클릭해 열려 있는 탭을 에이전트에게 넘기세요." },
        "record-and-capture": { title: "녹화와 캡처", body: "스크린샷, 화면 녹화, 네트워크 트래픽을 HAR로." },
        "any-mcp-client": {
          title: "모든 MCP 클라이언트",
          body: "OpenCode, Claude Code, Cursor, Codex, Zed 등 다양한 클라이언트.",
        },
        "all-your-logins": {
          title: "모든 로그인 그대로",
          body: "에이전트가 이미 로그인한 사이트를 그대로 사용합니다. 키도, 설정도 필요 없습니다.",
        },
        allowlists: { title: "허용 목록", body: "세션의 탭을 지정한 사이트로만 제한하세요." },
      },
      install:
        "한 줄로 Browse를 설치하고, 찾은 에이전트에 추가하고 확장 프로그램과 페어링합니다. Windows에서는 irm https://opencode.ai/browse/install.ps1 | iex 를 실행하세요. 에이전트에게 설정을 맡겨도 됩니다.",
    },
  },
  apps: {
    browse: {
      category: "에이전트용 브라우저 제어",
      body: "로그인과 탭이 그대로인 실제 브라우저를 에이전트가 사용하게 하세요.",
    },
    hex: { category: "음성 받아쓰기", body: "어떤 앱에서든 쓰는 온디바이스 음성 받아쓰기." },
    opentunnel: { category: "로컬 터널", body: "로컬 앱을 위한 공개 HTTPS URL." },
    opentui: { category: "라이브러리", body: "터미널 사용자 인터페이스를 위한 라이브러리." },
  },
  getStarted: {
    title: "시작하기",
    lead: "가장 쉬운 시작 방법은 OpenCode 다운로드 후 무료 모델을 쓰는 것입니다. 계정은 필요 없습니다. 더 필요하면 내 구독을 연결하거나 OpenCode Go를 사용하세요.",
    phrases: {
      "download-opencode": { text: "OpenCode 다운로드" },
      "free-models": { text: "무료 모델" },
      "your-own-subscription": { text: "내 구독" },
      "a-subscription-you-already-have": { text: "이미 사용 중인 구독" },
      "opencode-go": { text: "OpenCode Go" },
    },
    subscriptions: { "chatgpt-plus-pro": { name: "ChatGPT Plus/Pro" } },
    steps: {
      download: { title: "다운로드", line: "데스크톱, 터미널, 모바일 중에서 고르세요." },
      "use-free-models": {
        title: "무료 모델 사용",
        line: "OpenCode에는 무료 모델이 기본으로 들어 있습니다. 계정은 필요 없습니다.",
      },
      "add-more-models": {
        title: "모델 추가",
        line: "내 구독을 연결하거나, 월 $10부터 시작하는 OpenCode Go의 엄선된 모델을 사용하세요.",
      },
    },
    sentence: "OpenCode 다운로드 후 무료 모델로 시작하고, 더 필요하면 내 구독이나 OpenCode Go를 사용하세요.",
  },
  byos: {
    title: "내 구독 사용",
    headline: "이미 가진 구독을 그대로 쓰세요.",
    line: "ChatGPT Plus 또는 Pro나 GitHub Copilot으로 로그인하세요. OpenCode 구독을 사용할 수도 있습니다.",
    yours: { label: "내 구독", items: { "chatgpt-plus-pro": { name: "ChatGPT Plus/Pro" } } },
    planLinks: ["OpenCode 구독", "OpenCode Go"],
    ours: { label: "OpenCode 요금제" },
  },
  brand: {
    hero: { copy: { text: "에이전트용 규칙", copied: "규칙 복사됨" } },
    naming: {
      title: "명칭",
      body: "OpenCode는 대문자 O와 대문자 C를 써서 한 단어로 표기합니다. Opencode, Open Code, OpenCode AI, Open-Code로 쓰지 마세요.",
      code: "소문자 `opencode`는 `opencode-figma`나 `@acme/opencode-plugin`처럼 코드와 패키지 이름에만 쓰세요.",
    },
    families: {
      logo: {
        title: "로고",
        body: "앱 아이콘, 아바타 등 작은 공간을 위한 로고 단독형입니다. 정사각형 버전은 정사각형으로 잘리는 곳을 위해 여백을 더했습니다.",
        assets: {
          light: { name: "라이트" },
          dark: { name: "다크" },
          "square-light": { name: "정사각형, 라이트" },
          "square-dark": { name: "정사각형, 다크" },
        },
      },
      wordmark: {
        title: "워드마크",
        body: "OpenCode 글자꼴로 쓴 전체 이름입니다. 이름을 모두 쓸 공간이 있는 곳이라면 어디서나 사용하세요.",
        assets: { light: { name: "라이트" }, dark: { name: "다크" } },
      },
      "simple-wordmark": {
        title: "심플 워드마크",
        body: "워드마크의 단색 버전으로, 인쇄, 자수, 한 가지 색만 쓸 수 있는 곳을 위한 것입니다.",
        assets: { light: { name: "라이트" }, dark: { name: "다크" } },
      },
    },
    icons: {
      title: "아바타",
      body: "Slack, Discord, GitHub 등의 프로필을 위한 1024px 정사각형 아바타입니다. 배경이 정사각형 전체를 채우고 로고는 원 안쪽에 넉넉히 들어가므로, 원형으로 잘려도 문제없습니다.",
      items: { dark: { name: "다크" }, light: { name: "라이트" } },
    },
    colors: {
      title: "색상",
      body: "로고와 워드마크는 한 가지 잉크를 세 가지 불투명도로 쓰며, 어두운 배경에는 더 밝은 잉크를 씁니다. 아래 값은 표준 파일과 같이 그 잉크를 흰색 또는 #0B0B0B 위에 올린 결과입니다. 값을 클릭하면 복사됩니다.",
      palettes: {
        light: {
          name: "라이트",
          swatches: {
            ink: { name: "잉크", use: "로고 외곽선과 “code”의 글자." },
            "ink-70": { name: "잉크 70%", use: "“open”의 글자.", ink: "불투명도 70%의 잉크." },
            "ink-20": { name: "잉크 20%", use: "로고 안쪽 음영.", ink: "불투명도 20%의 잉크." },
          },
        },
        dark: {
          name: "다크",
          swatches: {
            ink: { name: "잉크", use: "로고 외곽선과 “code”의 글자." },
            "ink-72": { name: "잉크 72%", use: "“open”의 글자.", ink: "불투명도 72%의 잉크." },
            "ink-28": { name: "잉크 28%", use: "로고 안쪽 음영.", ink: "불투명도 28%의 잉크." },
          },
        },
      },
    },
    variants: {
      title: "변형",
      body: "배경에서 로고가 또렷하게 보이는 버전을 고르세요. 밝은 배경에는 다크, 어두운 배경에는 라이트를 씁니다. 로고와 워드마크는 별도 파일이니 둘 중 하나만 사용하세요.",
      groups: {
        default: {
          name: "기본",
          body: "거의 모든 곳에 쓰는 로고입니다. 안쪽 음영이 투명해서 흰색이나 검은색 위에서는 2톤 회색과 똑같이 보이고, 사진, 그라데이션, 컬러 위에서는 배경이 비쳐 보입니다.",
          rows: {
            logo: { title: "로고", tiles: { dark: { name: "다크" }, light: { name: "라이트" } } },
            wordmark: { title: "워드마크", tiles: { dark: { name: "다크" }, light: { name: "라이트" } } },
          },
        },
        simple: {
          name: "심플",
          body: "단색에 속공간이 열려 있고 안쪽 음영이 없습니다. 단색 컬러 배경, 1도 인쇄, 회색을 쓸 수 없는 곳에 사용하세요. 밝은 색에는 심플 다크, 어두운 색에는 심플 라이트를 씁니다.",
          rows: { wordmark: { title: "워드마크", tiles: { dark: { name: "다크" }, light: { name: "라이트" } } } },
        },
      },
    },
    usage: {
      title: "사용법",
      body: "밝은 배경에는 라이트 버전을, 어두운 배경에는 다크 버전을 사용하세요. 로고와 워드마크는 별개이므로 둘 중 하나만 쓰고, 함께 쓰지 마세요.",
      stroke: {
        title: "1 스트로크",
        body: "이 페이지의 간격 규칙은 스트로크 단위로 잽니다. 1 스트로크는 로고 외곽선의 두께로, 로고 너비의 4분의 1입니다. 따라서 로고는 너비 4 스트로크, 높이 5 스트로크입니다.",
      },
      clearSpace: {
        title: "여백",
        body: "로고와 워드마크의 모든 면에 최소 2 스트로크의 여백을 두세요. 로고에서 1 스트로크는 외곽선의 두께로 너비의 4분의 1이고, 워드마크에서는 글자의 두께로 높이의 7분의 1입니다.",
      },
      pixels: {
        title: "정수 픽셀",
        body: "로고의 비율은 4:5로 고정되어 있고, 1 스트로크는 너비의 4분의 1입니다. 4 × 5px 단위로 크기를 조절해 모든 가장자리와 스트로크가 정수 픽셀에 맞도록 하세요.",
        do: "모든 가장자리와 4px 스트로크를 정수 픽셀에 맞추기.",
        dont: "4:5에서 벗어난 크기로 쓰기. 가장자리가 픽셀 사이에 걸려 흐려집니다.",
        sizes: { logo: { title: "로고" }, wordmark: { title: "워드마크" } },
      },
      minimumTitle: "최소 크기",
      minimum: {
        logo: { title: "로고", body: "최소 16 × 20px, 스트로크 4px. 이보다 작으면 흐려집니다." },
        wordmark: { title: "워드마크", body: "최소 117 × 21px, 스트로크 3px. 이보다 작으면 흐려집니다." },
      },
    },
    donts: {
      title: "금지",
      body: "로고와 워드마크를 사용할 때 피해야 할 흔한 실수입니다.",
      examples: {
        "two-tone": { caption: "로고를 새로운 색으로 바꾸기." },
        bright: { caption: "밝은 단색 하나로 쓰기." },
        gradient: { caption: "로고를 그라데이션으로 채우기." },
        inverted: { caption: "톤을 서로 바꾸기." },
        stretch: { caption: "로고를 늘이거나 찌그러뜨리기." },
        shadow: { caption: "그림자 넣기." },
        glow: { caption: "글로나 외곽선 넣기." },
        lockup: { caption: "로고 옆에 다른 단어 붙이기." },
        "low-contrast": { caption: "대비가 낮은 회색 위에 회색 쓰기." },
        color: { caption: "회색 2톤 로고를 컬러 배경에 올리기. 회색이 탁해집니다." },
      },
    },
    integrations: {
      title: "통합",
      body: "OpenCode와 함께 동작하는 플러그인, 제공자, 도구와 OpenCode로 만든 프로젝트는 그 사실을 밝힐 수 있습니다. 배지나 파트너 록업을 사용하고, 프로젝트가 내 것임이 분명하도록 이름을 지으세요.",
      badges: {
        body: "README, 문서, 웹사이트에 배지를 넣고 opencode.ai로 링크하세요. 배경에 맞춰 라이트 또는 다크 파일을 고르고(HTML은 자동으로 전환됩니다), 색상이나 텍스트는 바꾸지 마세요.",
        sizes: "모든 스타일은 20, 32, 44px(Shields는 20px만)로 제공되며, SVG와 2배 PNG 형식입니다.",
        mono: "각 파일에는 OpenTUI Mono 텍스트 버전도 있습니다. opencode-works-with-a-light-20-mono.svg처럼 확장자 앞에 -mono를 붙이고, 대문자 OpenTUI Mono는 -mono-caps를 붙이세요.",
        groups: {
          "works-with": {
            title: "호환",
            alt: "OpenCode 호환",
            body: "OpenCode와 함께 실행되는 플러그인, 제공자, 도구용.",
          },
          "built-with": { title: "제작", alt: "OpenCode로 제작", body: "OpenCode로 만든 프로젝트용." },
        },
        styles: { a: { name: "프레임" }, c: { name: "셀" }, f: { name: "솔리드" }, g: { name: "Shields" } },
      },
      lockup: {
        title: "파트너 록업",
        body: "OpenCode 로고와 파트너 로고를 나란히 놓고 사이에 ×를 넣으세요. × 양옆에 3 스트로크씩 간격을 두고, 파트너 로고는 OpenCode 로고와 같은 높이로 보이게 맞추고, 록업 전체 주위에 여백을 두세요.",
        partners: { github: { name: "GitHub" } },
      },
      naming: {
        title: "프로젝트 이름 짓기",
        body: "프로젝트가 내 것임이 분명하도록 내 이름을 앞에 두세요.",
        rule: "`Linear for OpenCode`로 쓰거나 패키지 이름을 `opencode-linear`로 지으세요. `OpenCode Linear`나 `Linear by OpenCode`로 쓰지 마세요.",
      },
    },
    trademarks: {
      title: "상표",
      body: "OpenCode와 OpenCode 로고는 Anomaly의 상표입니다. Anomaly가 보증하거나 후원한다고 암시하는 데, 제품명이나 회사명에, 또는 허락 없이 굿즈에 사용하지 마세요.",
      contact: { before: "문의 사항은 ", after: "(으)로 이메일을 보내 주세요." },
    },
  },
  press: {
    title: "OpenCode | 회사 정보와 브랜드 자산이 담긴 프레스 키트",
    description:
      "OpenCode 프레스 키트입니다. OpenCode와 이를 만드는 회사 Anomaly에 관한 정보, 다운로드할 수 있는 로고와 워드마크, 언론 문의 연락처를 담았습니다.",
    hero: { title: "언론", body: "OpenCode와 Anomaly에 관해 쓰기 위한 정보, 브랜드 자산, 연락처." },
    company: {
      title: "Anomaly 소개",
      lead: "Anomaly는 OpenCode를 만드는 회사입니다. 개발자를 위한 오픈 소스 도구를 만듭니다.",
      more: "다른 프로젝트로는 SST와 OpenTUI가 있으며, 모두 [GitHub](github)에 오픈 소스로 공개되어 있습니다.",
      learnMore: "자세한 내용은 [anoma.ly](site)에서 확인하세요.",
      projects: {
        opencode: {
          name: "OpenCode",
          body: "데스크톱, 터미널, 모바일 앱과 SDK를 갖춘 오픈 소스 코딩 에이전트. MIT 라이선스, GitHub 스타 220,000개 이상.",
        },
        sst: {
          name: "SST",
          body: "내 인프라에서 풀스택 앱을 만드는 프레임워크. MIT 라이선스, 2020년부터 오픈 소스, GitHub 스타 26,000개 이상.",
        },
        opentui: {
          name: "OpenTUI",
          body: "TypeScript, React, Solid로 터미널 UI를 만드는 라이브러리로, 코어는 Zig로 작성되었습니다. OpenCode가 프로덕션에서 사용합니다. GitHub 스타 13,000개 이상.",
        },
        "models-dev": {
          name: "Models.dev",
          body: "AI 모델의 사양, 가격, 기능을 담은 오픈 소스 데이터베이스로, 공개 API를 제공합니다. 200개 이상 제공자의 모델 8,900개 이상을 수록하고 있습니다.",
        },
        hex: {
          name: "Hex",
          body: "Mac, Windows, Linux용 음성 받아쓰기. Hex는 기기에서 받아쓰고 어떤 앱에든 붙여 넣으므로, 오디오가 기기 밖으로 나가지 않습니다.",
        },
        opentunnel: {
          name: "OpenTunnel",
          body: "내 컴퓨터의 앱에 공개 HTTPS URL을 주는 CLI와 SDK. TLS가 내 컴퓨터에서 종료되므로, 릴레이는 평문을 볼 수 없습니다.",
        },
      },
    },
    about: {
      title: "OpenCode 소개",
      boilerplate: {
        long: "OpenCode는 오픈 소스 코딩 에이전트입니다. 데스크톱 앱, 터미널 UI, 모바일 앱, SDK로 제공되며, Claude, GPT, Gemini를 비롯해 모든 제공자의 모델과 함께 작동합니다. OpenCode는 MIT 라이선스이며 Anomaly가 만듭니다. GitHub 스타 220,000개 이상, 기여자 1,000명 이상을 보유하고 있으며, 매달 2,200만 명 이상의 개발자가 사용합니다.",
        short: "OpenCode는 Anomaly가 만든 오픈 소스 코딩 에이전트로, 데스크톱, 터미널, 모바일 앱과 SDK를 제공합니다.",
      },
      products: {
        "opencode-console": {
          name: "OpenCode Console",
          long: "OpenCode Console은 개발자와 팀이 OpenCode 및 다른 코딩 에이전트를 위한 AI 모델 이용권을 구매하고 관리하는 웹 앱입니다. 프런티어 모델과 오픈 웨이트 모델에 대한 종량제 추론을 제공하며, 선불 크레딧에서 요청마다 차감하고, OpenCode Go 구독도 제공합니다. 팀은 Member, Admin, Owner 역할이 있는 워크스페이스, 워크스페이스 및 사용자별 지출 한도, Okta, Microsoft Entra ID, Google Workspace를 통한 SSO, SCIM을 이용할 수 있습니다. Console은 30개 이상의 제공자를 지원하므로 팀이 이미 가진 제공자 계정을 연결할 수 있으며, 자체 추론은 선택 사항입니다. 주소는 opencode.ai/console입니다.",
          short:
            "OpenCode Console은 종량제 AI 모델 이용, OpenCode Go 구독, 예산과 SSO 같은 팀 관리 기능을 제공하는 Anomaly의 웹 앱입니다.",
        },
        "opencode-go": {
          name: "OpenCode Go",
          long: "OpenCode Go는 코딩 모델을 고정 월 요금으로 쓰고 싶은 개발자를 위한 구독입니다. Go는 월 $10, 한도가 더 높은 Go Plus는 월 $40, Go Teams는 멤버당 월 $20입니다. 각 요금제에는 에이전트 기반 코딩용으로 테스트한 엄선된 모델이 포함됩니다. 사용 한도는 모델별 월간 금액이며, 월간 한도의 20%와 50%에 해당하는 5시간 및 주간 롤링 한도가 있습니다. 구독자는 크레딧을 충전하고, 종량제 잔액으로 넘어가 사용할 수 있으며, 언제든 해지할 수 있습니다. Go는 OpenCode와 다른 에이전트에서 작동합니다. 주소는 opencode.ai/console/go입니다.",
          short:
            "OpenCode Go는 엄선된 코딩 모델에 대한 월간 사용 한도를 제공하는 Anomaly의 월 구독으로, 월 $10부터 시작합니다.",
        },
        "opencode-data": {
          name: "OpenCode Data",
          long: "OpenCode Data는 개발자들이 OpenCode에서 어떤 AI 모델을 쓰는지, 그 구성이 시간에 따라 어떻게 바뀌는지 보여 주는 공개 대시보드입니다. 인기 모델 순위, 토큰 사용량, 세션 및 토큰 비용, 캐시 비율, 시장 점유율, 국가별 분석을 공개합니다. 수치는 매시간 집계되며, 일과 주는 UTC 기준입니다. 사용자 수와 세션 수는 근삿값이며, 비용은 OpenCode 모델 카탈로그의 정가를 사용합니다. 기자는 OpenCode Data (opencode.ai/data)로 출처를 밝히고 페이지에 표시된 업데이트 시각을 함께 적으면 됩니다.",
          short:
            "OpenCode Data는 opencode.ai/data에 있는 공개 대시보드로, OpenCode의 실제 사용량으로 AI 모델 순위를 매기며 토큰, 비용, 시장 점유율을 매시간 업데이트합니다.",
        },
      },
    },
    facts: {
      title: "한눈에 보기",
      items: { license: { label: "라이선스" }, "first-release": { label: "첫 출시" }, "made-by": { label: "개발사" } },
    },
    milestones: {
      title: "주요 이정표",
      items: {
        "first-release-v0-0-1": { date: "2025년 4월", text: "첫 출시, v0.0.1" },
        "1-million-downloads": { date: "2025년 10월", text: "다운로드 100만 회 돌파" },
        "opencode-1-0": { date: "2025년 10월", text: "OpenCode 1.0" },
        "desktop-app-ships": { date: "2025년 12월", text: "데스크톱 앱 출시" },
        "10-million-downloads": { date: "2026년 1월", text: "다운로드 1,000만 회 돌파" },
        "opencode-2-0": { date: "2026년 9월", text: "OpenCode 2.0" },
        "220-000-github-stars": { date: "2026년 11월", text: "GitHub 스타 220,000개 돌파" },
      },
    },
    news: {
      title: "최신 릴리스",
      intro: "OpenCode는 자주 출시됩니다. 새 기능이 담긴 최신 릴리스입니다.",
      changelog: { text: "전체 변경 내역" },
      feed: { text: "RSS 피드" },
    },
    media: {
      title: "미디어",
      intro: "실제 제품에서 녹화한 각 앱의 스틸 이미지와 짧은 동영상입니다. OpenCode에 관한 글에 사용할 수 있습니다.",
      note: "모든 캡처는 다크 테마입니다. 스틸과 포스터는 최대 1920 × 1080(세로형은 1080 × 1350) JPG이며, 동영상은 소리 없는 MP4 클립입니다.",
      products: {
        desktop: {
          name: "Desktop",
          items: {
            "locked-landscape": { title: "Desktop 영상" },
            "frame-1": { title: "Desktop 스틸 1" },
            "frame-2": { title: "Desktop 스틸 2" },
            "frame-3": { title: "Desktop 스틸 3" },
            "frame-4": { title: "Desktop 스틸 4" },
            "feature-1": { title: "탭으로 나뉜 세션" },
            "feature-2": { title: "검토와 댓글" },
            "feature-3": { title: "브라우저에서 확인" },
            "locked-portrait": { title: "Desktop 영상, 세로형" },
          },
        },
        mobile: {
          name: "Mobile",
          items: {
            "locked-landscape": { title: "Mobile 영상" },
            "frame-1": { title: "Mobile 스틸 1" },
            "frame-2": { title: "Mobile 스틸 2" },
            "frame-3": { title: "Mobile 스틸 3" },
            "feature-1": { title: "음성" },
            "feature-2": { title: "승인" },
            "feature-3": { title: "세션" },
            "locked-portrait": { title: "Mobile 영상, 세로형" },
          },
        },
        terminal: {
          name: "Terminal",
          items: {
            "locked-landscape": { title: "Terminal 영상" },
            "frame-1": { title: "Terminal 스틸 1" },
            "frame-2": { title: "Terminal 스틸 2" },
            "frame-3": { title: "Terminal 스틸 3" },
            "frame-4": { title: "Terminal 스틸 4" },
            "feature-1": { title: "평소 말투로 요청" },
            "feature-2": { title: "실행할 것만 승인" },
            "feature-3": { title: "내 취향대로" },
            "locked-portrait": { title: "Terminal 영상, 세로형" },
          },
        },
        sdk: {
          name: "SDK",
          items: {
            "locked-landscape": { title: "SDK 영상" },
            "frame-1": { title: "SDK 스틸 1" },
            "frame-2": { title: "SDK 스틸 2" },
            "frame-3": { title: "SDK 스틸 3" },
            "frame-4": { title: "SDK 스틸 4" },
            "feature-1": { title: "코드로 CI 고치기" },
            "feature-2": { title: "모든 단계 추적" },
            "feature-3": { title: "나만의 도구 만들기" },
            "locked-portrait": { title: "SDK 영상, 세로형" },
          },
        },
      },
    },
    people: { title: "사람들" },
    anomalyLogo: {
      title: "Anomaly 로고",
      body: "Anomaly 마크와 워드마크, 검은색과 흰색 버전입니다. PNG는 너비 2048px입니다.",
      assets: {
        "mark-black": { name: "마크, 검은색" },
        "mark-white": { name: "마크, 흰색" },
        "wordmark-black": { name: "워드마크, 검은색" },
        "wordmark-white": { name: "워드마크, 흰색" },
      },
      all: { text: "모두 다운로드" },
    },
    coverage: { title: "보도" },
    brand: {
      title: "브랜드",
      before: "OpenCode 로고와 워드마크를 ZIP 파일 하나로 다운로드하세요. 개별 파일, 변형, 사용 규칙은 ",
      link: { text: "브랜드 페이지" },
      after: "에서 확인하세요.",
      usage:
        "OpenCode에 관한 글에 이 파일들을 사용할 수 있습니다. 파일을 수정하거나, OpenCode가 내 작업을 보증한다고 암시하지 마세요.",
    },
    product: {
      title: "제품",
      items: {
        desktop: {
          name: "Desktop",
          body: "macOS, Windows, Linux에서 여러 에이전트를 각자의 탭에서 동시에 실행하세요. 모든 변경 사항을 diff로 검토하고 미리 보세요.",
        },
        mobile: {
          name: "Mobile",
          body: "가장 새로운 OpenCode 앱. 세션에 전화를 걸어 에이전트와 대화하고, 어디서든 휴대폰으로 변경 사항을 검토하고 승인하세요.",
        },
        terminal: {
          name: "Terminal",
          body: "어떤 셸, 에디터, 원격 서버에서도 동작하는 터미널 UI. 모든 편집을 diff로 보고, 스스로 실행될 명령어를 정하세요.",
        },
        sdk: {
          name: "SDK",
          body: "스크립트, CI 작업, 나만의 도구를 위한 타입 지정 TypeScript 클라이언트. 세션을 만들고, 프롬프트를 보내고, 모든 이벤트를 스트리밍하세요.",
        },
      },
    },
    contact: {
      title: "연락처",
      items: {
        press: { title: "언론", body: "기자와 애널리스트를 위한 창구입니다. 언론 요청에만 답변합니다." },
        support: {
          links: { "github-issues": { text: "GitHub 이슈" }, "help-anoma-ly": { text: "help@anoma.ly" } },
          title: "지원",
          body: "OpenCode 사용에 도움이 필요하면 이슈를 열거나 커뮤니티에 질문하세요. 계정 및 결제 문의는 이메일로 보내 주세요.",
        },
        security: {
          links: {
            "report-a-vulnerability": { text: "취약점 제보" },
            "security-anoma-ly": { text: "security@anoma.ly" },
          },
          title: "보안",
          body: "취약점은 GitHub로 제보해 주세요. 영업일 기준 6일 안에 답변이 없으면 이메일을 보내 주세요.",
        },
      },
    },
  },
  download: {
    desktop: { title: "Desktop" },
    mobile: { title: "Mobile", stores: { "google-play": { label: "Google Play" } } },
    terminal: { title: "Terminal", installs: { curl: { name: "스크립트" } } },
    extensions: {
      title: "확장 프로그램",
      items: {
        cursor: { label: "Cursor" },
        zed: { label: "Zed" },
        windsurf: { label: "Windsurf" },
        vscodium: { label: "VSCodium" },
      },
    },
  },
  productDownloads: {
    terminal: { commands: { curl: { name: "스크립트" } } },
    sdk: { more: { label: "SDK 문서 읽기" } },
    ide: {
      links: {
        "vs-code-marketplace": { label: "VS Code 마켓플레이스" },
        "open-vsx-cursor-windsurf-vscodium": { label: "Open VSX (Cursor, Windsurf, VSCodium)" },
      },
      lead: "에디터의 통합 터미널에서 opencode를 실행하면 확장 프로그램이 자동으로 설치됩니다. 직접 설치할 수도 있습니다.",
      more: { label: "Zed, JetBrains IDE 등 ACP 에디터 설정" },
    },
    mini: {
      commands: { curl: { name: "스크립트" } },
      lead: "Mini는 OpenCode CLI에 포함되어 있습니다. 아래 방법 중 하나로 설치한 뒤 opencode mini를 실행하세요.",
    },
  },
  pair: {
    title: "휴대폰 연결",
    cardTitle: "명령어 하나로 휴대폰 페어링",
    intro:
      "OpenCode Mobile은 내 컴퓨터의 OpenCode를 위한 리모컨입니다. 세션은 컴퓨터에서 계속 실행되고, 앱은 세션을 보여 주며 방향을 잡게 해 줍니다.",
    steps: {
      "get-the-app": {
        title: "앱 받기",
        body: "TestFlight에서 iPhone에 OpenCode 베타를 설치하세요. Android 앱은 곧 출시됩니다.",
      },
      "run-this-on-your-computer": {
        title: "컴퓨터에서 실행",
        body: "일회용 링크와 QR 코드가 출력됩니다. 한 번만 쓸 수 있고 5분 뒤 만료됩니다.",
      },
      "scan-the-code": {
        title: "코드 스캔",
        body: "앱으로 QR 코드를 스캔하거나 링크를 붙여 넣으세요. 컴퓨터의 최근 세션이 휴대폰에서 열립니다.",
      },
    },
    note: "--remote는 OpenTunnel 주소를 거쳐 연결되므로 어떤 네트워크에서든 동작합니다. 같은 Wi-Fi에서는 opencode service set hostname 0.0.0.0을 한 번 실행한 뒤 opencode pair를 실행하세요.",
    facts: [
      "어떤 네트워크에서든 동작합니다. --remote는 OpenTunnel 주소를 거쳐 연결됩니다.",
      "링크와 코드는 한 번만 쓸 수 있고 5분 뒤 만료됩니다.",
      "컴퓨터를 켜 두세요. 에이전트는 휴대폰이 아니라 컴퓨터에서 실행됩니다.",
      "같은 Wi-Fi라면 opencode service set hostname 0.0.0.0을 한 번 실행한 뒤 opencode pair를 실행하세요.",
    ],
  },
  announcements: {
    "create-install-and-share-desktop-plugins": {
      text: "데스크톱 플러그인을 만들고, 설치하고, 공유하세요.",
      link: "2.2의 새 기능 보기",
    },
    "desktop-terminals-now-survive-restarts": {
      text: "이제 데스크톱 터미널이 재시작 후에도 유지됩니다.",
      link: "v2.2.4 보기",
    },
    "agents-can-now-generate-images": { text: "이제 에이전트가 이미지를 생성할 수 있습니다.", link: "v2.2.1 보기" },
    "steer-your-sessions-from-your-phone": {
      text: "휴대폰으로 세션의 방향을 잡으세요.",
      link: "OpenCode Mobile 만나기",
    },
    "a-refreshed-desktop-app": { text: "새로워진 데스크톱 앱.", link: "2.2의 새 기능 보기" },
  },
} satisfies ContentOverlay
