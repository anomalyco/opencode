import { androidSoon } from "~/component/site/product-data"
import { docsUrl } from "~/lib/docs"
import { installs } from "~/lib/install-commands"

// The voice assistant's curated answers, written from the site's own pages (index.md, the product
// pages, /console/go, /console/models, the press facts). Each has a pre-generated ElevenLabs reading in
// public/voice/<id>.mp3 (script/voice-audio.md). `speech` is what is read out when the shown text
// has symbols or commands that read badly.

export type VoiceLink = { label: string; href: string }
export type VoiceAnswer = {
  id: string
  /** Ways people ask it. Matching compares the question's words with these. */
  asks: string[]
  /** Words that point strongly at this answer. */
  keys: string[]
  text: string
  speech?: string
  links: VoiceLink[]
  /** Its recording in public/voice is out of date, so the answer is spoken without it. */
  unrecorded?: boolean
}

export const hexUrl = "https://anoma.ly/hex"

export const voiceAnswers: VoiceAnswer[] = [
  {
    id: "what-is",
    asks: ["what is opencode", "what does opencode do", "tell me about opencode", "what is this", "explain opencode"],
    keys: ["what", "opencode", "about", "explain", "overview"],
    text: "OpenCode is an open source coding agent. It runs on your computer, works with any model, and you can use it from the desktop app, your phone, the terminal or your own code with the SDK.",
    links: [
      { label: "Home", href: "/" },
      { label: "Docs", href: docsUrl("/") },
    ],
  },
  {
    id: "install",
    asks: ["how do i install opencode", "how do i get started", "how do i download it", "install command", "set it up"],
    keys: ["install", "download", "setup", "started", "start", "get", "curl", "npm", "brew", "homebrew"],
    text: `In a terminal, run ${installs[0].command}. You can also install with npm, bun or Homebrew, or download the desktop app.`,
    speech:
      "In a terminal, run the install script from opencode dot A I slash v2 slash install. You can also install with npm, bun or Homebrew, or download the desktop app.",
    // public/voice/install.mp3 still reads the OpenCode 1 address (opencode.ai/install).
    unrecorded: true,
    links: [
      { label: "Product", href: "/product" },
      { label: "Intro docs", href: docsUrl("/") },
    ],
  },
  {
    id: "models",
    asks: [
      "which models does it support",
      "what models can i use",
      "can i use claude",
      "does it work with gpt",
      "local models",
    ],
    keys: [
      "model",
      "models",
      "claude",
      "gpt",
      "gemini",
      "anthropic",
      "openai",
      "llm",
      "provider",
      "providers",
      "ollama",
      "local",
    ],
    text: "Any model you like. OpenCode connects to more than 200 providers through Models.dev, including Anthropic, OpenAI, Google and xAI, and to local models with Ollama or LM Studio. It also includes free models.",
    links: [
      { label: "Models", href: docsUrl("/models/") },
      { label: "Providers", href: docsUrl("/providers/") },
    ],
  },
  {
    id: "cost",
    asks: ["how much does it cost", "is opencode free", "what is the price", "do i have to pay", "pricing"],
    keys: ["cost", "free", "price", "pricing", "pay", "money", "expensive", "cheap"],
    text: "OpenCode is free and MIT licensed, and it comes with free models you can use without an account. If you connect another provider, you pay that provider. OpenCode Go is from $10/month, and OpenCode Models are pay as you go.",
    speech:
      "OpenCode is free and MIT licensed, and it comes with free models you can use without an account. If you connect another provider, you pay that provider. OpenCode Go is from ten dollars a month, and OpenCode Models are pay as you go.",
    // public/voice/cost.mp3 still says Zen, the old name of OpenCode Models.
    unrecorded: true,
    links: [
      { label: "Free models", href: docsUrl("/console/models/#free-models") },
      { label: "Subscriptions", href: "/console/go" },
      { label: "OpenCode Models", href: "/console/models" },
    ],
  },
  {
    id: "go",
    asks: ["what is opencode go", "tell me about go", "go subscription", "what do i get with go"],
    keys: ["go", "subscription", "subscribe", "plan", "monthly"],
    text: "OpenCode Go is a low cost subscription from $10/month, with generous limits and reliable access to capable open source coding models. You can use it with OpenCode or any agent, and cancel any time.",
    speech:
      "OpenCode Go is a low cost subscription from ten dollars a month, with generous limits and reliable access to capable open source coding models. You can use it with OpenCode or any agent, and cancel any time.",
    links: [{ label: "OpenCode Go", href: "/console/go" }],
  },
  {
    id: "zen",
    // Still matches "zen", the old name, so people who ask for it get this answer.
    asks: ["what are opencode models", "what is zen", "tell me about zen", "opencode zen", "what is the console"],
    keys: ["zen", "gateway", "credit", "credits", "console", "balance"],
    text: "OpenCode Models gives you coding models that the OpenCode team has tested and benchmarked for coding agents. It's pay as you go, so you add credit and pay only for what you use.",
    // public/voice/zen.mp3 still says Zen, the old name of OpenCode Models.
    unrecorded: true,
    links: [
      { label: "OpenCode Models", href: "/console/models" },
      { label: "Console docs", href: docsUrl("/console/") },
    ],
  },
  {
    id: "subscriptions",
    asks: [
      "can i use my chatgpt subscription",
      "does it work with copilot",
      "use my existing subscription",
      "chatgpt plus",
    ],
    keys: ["chatgpt", "copilot", "github", "existing", "plus", "pro", "subscription", "already"],
    text: "Yes. You can sign in with your ChatGPT Plus or Pro subscription, or with GitHub Copilot, and use the models you already pay for.",
    links: [{ label: "Providers", href: docsUrl("/providers/") }],
  },
  {
    id: "desktop",
    asks: ["is there a desktop app", "tell me about the desktop app", "desktop vs terminal", "does it have a gui"],
    keys: ["desktop", "app", "gui", "window", "tabs", "mac", "windows", "linux", "macos"],
    text: "Yes. The desktop app runs on macOS, Windows and Linux. Each session gets its own tab, you review every change as a diff and comment on any line, and you check the result in the built-in browser.",
    links: [
      { label: "Desktop", href: "/desktop" },
      { label: "Download", href: "/desktop#download" },
    ],
  },
  {
    id: "terminal",
    asks: ["tell me about the terminal app", "is there a cli", "terminal ui", "does it work in my editor"],
    keys: ["terminal", "cli", "tui", "shell", "command", "line", "editor", "vim", "ssh", "server"],
    text: "The terminal app is a fast terminal interface that works in any shell, editor or remote server. It's the same agent as the desktop app, and they share your sessions.",
    links: [{ label: "Terminal", href: "/terminal" }],
  },
  {
    id: "mobile",
    asks: [
      "is there a mobile app",
      "can i use it on my phone",
      "iphone app",
      "android app",
      "can i talk to opencode from my phone",
    ],
    keys: ["mobile", "phone", "iphone", "android", "ios", "pocket", "call"],
    // public/voice/mobile.mp3 reads the "available" text, so it is left out while Android is coming soon.
    text: androidSoon
      ? "Yes. With the mobile app for iPhone, now a public beta on TestFlight, you can start, steer and approve sessions from your phone. You can even call a session and talk to the agent. It connects to OpenCode on your own computer. The Android app is coming soon."
      : "Yes. With the mobile app for iPhone and Android, you can start, steer and approve sessions from your phone. You can even call a session and talk to the agent. It connects to OpenCode on your own computer.",
    links: [{ label: "Mobile", href: "/mobile" }],
    unrecorded: androidSoon,
  },
  {
    id: "sdk",
    asks: ["is there an sdk", "can i use it from code", "api", "automate opencode", "ci"],
    keys: ["sdk", "api", "code", "script", "scripts", "automate", "ci", "javascript", "typescript", "programmatic"],
    text: "Yes. The SDK lets you drive OpenCode from your own scripts, CI jobs and tools. Create a session, send a prompt, and read the result from JavaScript or TypeScript.",
    links: [
      { label: "SDK", href: "/sdk" },
      { label: "SDK docs", href: docsUrl("/build/sdk/") },
    ],
  },
  {
    id: "privacy",
    asks: ["is my code private", "what about privacy", "do you store my code", "data privacy", "is it secure"],
    keys: ["privacy", "private", "data", "store", "secure", "security", "safe", "train", "training"],
    text: "OpenCode runs on your computer and doesn't store your code or context data, so it works in privacy sensitive environments. Your code goes to the model provider you choose. If you use OpenCode's own models, their data terms are in the docs.",
    links: [
      { label: "Privacy", href: docsUrl("/policies/") },
      { label: "Model data terms", href: docsUrl("/console/models/#privacy") },
    ],
  },
  {
    id: "open-source",
    asks: ["is opencode open source", "where is the source code", "github", "license", "can i contribute"],
    keys: ["open", "source", "github", "license", "mit", "contribute", "stars", "repo"],
    text: "Yes. OpenCode is fully open source under the MIT license. It has over 220,000 GitHub stars and more than 1,000 contributors, and anyone can file issues or send pull requests.",
    links: [{ label: "GitHub", href: "https://github.com/anomalyco/opencode" }],
  },
  {
    id: "extensions",
    asks: ["does it support mcp", "plugins", "can i add tools", "skills", "extensions"],
    keys: ["mcp", "plugin", "plugins", "skill", "skills", "extension", "extensions", "tools", "lsp", "integrations"],
    text: "Yes. Connect MCP servers for services like GitHub, Linear and Figma, hook into OpenCode with plugins, and teach agents your workflows with skills. In the desktop app you manage them all from the Extensions menu.",
    links: [
      { label: "Extensions", href: "/extensions" },
      { label: "MCP servers", href: docsUrl("/mcp-servers/") },
    ],
  },
  {
    id: "agents",
    asks: ["can i run several agents", "multiple sessions", "custom agents", "parallel agents"],
    keys: ["agents", "agent", "parallel", "multiple", "sessions", "session", "custom", "subagent"],
    text: "Yes. You can run several sessions in parallel on the same project, and create your own agents with their own prompts, models and tools. Permissions decide what runs automatically and what needs your approval.",
    links: [
      { label: "Agents", href: docsUrl("/agents/") },
      { label: "Permissions", href: docsUrl("/permissions/") },
    ],
  },
  {
    id: "browse",
    asks: ["what is browse", "can it use my browser", "browser automation"],
    keys: ["browse", "browser", "chrome", "tabs", "playwright", "web"],
    text: "Browse lets your agents use your real browser, with your tabs, logins and extensions. They drive background tabs, and hand the tab back to you for a login or a payment.",
    links: [{ label: "Browse", href: "/product/browse" }],
  },
  {
    id: "who",
    asks: ["who makes opencode", "who is behind opencode", "what is anomaly", "which company"],
    keys: ["who", "company", "anomaly", "team", "behind", "makes", "made", "built"],
    text: "OpenCode is made by Anomaly, a company that builds open source tools for developers. Anomaly also makes Hex, a voice dictation app.",
    links: [{ label: "Press", href: "/press" }],
  },
  {
    id: "hex",
    asks: ["what is hex", "tell me about hex", "voice dictation", "can i talk to my computer"],
    keys: ["hex", "dictation", "dictate", "voice", "speak", "speech", "computer"],
    text: "Hex is Anomaly's voice dictation app for Mac, Windows and Linux. Hold a key, speak, and it pastes into whatever app you're in. It transcribes on your device, so your voice stays on your machine.",
    links: [{ label: "Hex", href: hexUrl }],
  },
  {
    id: "enterprise",
    asks: ["enterprise", "can my company use it", "teams", "business"],
    keys: ["enterprise", "company", "teams", "team", "business", "organization", "sso"],
    text: "Yes. OpenCode works for teams and companies, with organizational controls in the Console when you need them. For an enterprise plan, contact the team from the enterprise page.",
    links: [{ label: "Enterprise", href: "/console/enterprise" }],
  },
  {
    id: "changelog",
    asks: ["what's new", "latest release", "changelog", "release notes", "updates"],
    keys: ["new", "latest", "release", "changelog", "updates", "version", "changes"],
    text: "OpenCode ships often. The changelog has the notes for every release, for the desktop app, the terminal and the SDK.",
    links: [{ label: "Changelog", href: "/changelog" }],
  },
  {
    id: "demo",
    asks: ["how does this work", "how does this voice assistant work", "who am i talking to", "are you an ai"],
    keys: ["this", "work", "works", "assistant", "demo", "you", "orb"],
    text: "I'm a small voice demo on the OpenCode website. Your browser turns your speech into text, I answer from the site's own pages, and an ElevenLabs voice reads the answer out loud.",
    links: [{ label: "llms.txt", href: "/llms.txt" }],
  },
  {
    id: "hello",
    asks: ["hello", "hi there", "hey", "good morning", "thanks", "thank you"],
    keys: ["hello", "hi", "hey", "thanks", "thank", "morning"],
    text: "Hi! Ask me anything about OpenCode: what it is, which models it works with, how to install it, or what it costs.",
    links: [],
  },
]

export const fallbackAnswer: VoiceAnswer = {
  id: "fallback",
  asks: [],
  keys: [],
  text: "I'm not sure about that one. I can tell you what OpenCode is, which models it works with, how to install it, what it costs, and about the desktop, terminal and mobile apps.",
  links: [{ label: "Docs", href: docsUrl("/") }],
}

const stop = new Set(
  "a an the is it its of to in on for and or do does i me my you your can how what which with this that be are about tell please there use using get".split(
    " ",
  ),
)

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/open ?code/g, "opencode")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (word.length > 4 && word.endsWith("s") ? word.slice(0, -1) : word))

const trigrams = (text: string) => {
  const padded = `  ${text.toLowerCase()} `
  return new Set(Array.from({ length: Math.max(padded.length - 2, 0) }, (_, i) => padded.slice(i, i + 3)))
}

const similarity = (a: Set<string>, b: Set<string>) => {
  const shared = [...a].filter((item) => b.has(item)).length
  return shared / Math.max(a.size + b.size - shared, 1)
}

/** The curated answer closest to `question`: key words first, then the closest way of asking it. */
export function matchAnswer(question: string) {
  const asked = words(question)
  const content = asked.filter((word) => !stop.has(word))
  const grams = trigrams(question)
  const scored = voiceAnswers.map((answer) => {
    const keys = new Set(answer.keys.flatMap(words))
    const hits = content.filter((word) => keys.has(word)).length
    const phrasing = Math.max(...answer.asks.map((ask) => similarity(grams, trigrams(ask))))
    return { answer, score: hits * 0.6 + phrasing * 2 }
  })
  const best = scored.reduce((a, b) => (b.score > a.score ? b : a))
  return best.score >= 0.75 ? best.answer : fallbackAnswer
}
