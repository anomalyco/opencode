import type { Component, JSX } from "solid-js"
import { createMemo, splitProps } from "solid-js"
import sprite from "./file-icons/sprite.svg"
import type { IconName } from "./file-icons/types"

export type FileIconProps = JSX.GSVGAttributes<SVGSVGElement> & {
  node: { path: string; type: "file" | "directory" }
  expanded?: boolean
}

export const FileIcon: Component<FileIconProps> = (props) => {
  const [local, rest] = splitProps(props, ["node", "class", "classList", "expanded"])
  const name = createMemo(() => chooseIconName(local.node.path, local.node.type, local.expanded || false))
  return (
    <svg
      data-component="file-icon"
      {...rest}
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    >
      <use href={`${sprite}#${name()}`} />
    </svg>
  )
}

type IconMaps = {
  fileNames: Record<string, IconName>
  fileExtensions: Record<string, IconName>
  folderNames: Record<string, IconName>
  defaults: {
    file: IconName
    folder: IconName
    folderOpen: IconName
  }
}

const ICON_MAPS: IconMaps = {
  fileNames: {
    // Documentation files
    "readme.md": "Readme",
    "changelog.md": "Changelog",
    "contributing.md": "Contributing",
    "conduct.md": "Conduct",
    license: "Certificate",
    authors: "Authors",
    credits: "Credits",
    install: "Installation",

    // Node.js files
    "package.json": "Nodejs",
    "package-lock.json": "Nodejs",
    "yarn.lock": "Yarn",
    "pnpm-lock.yaml": "Pnpm",
    "bun.lock": "Bun",
    "bun.lockb": "Bun",
    "bunfig.toml": "Bun",
    ".nvmrc": "Nodejs",
    ".node-version": "Nodejs",

    // Docker files
    dockerfile: "Docker",
    "docker-compose.yml": "Docker",
    "docker-compose.yaml": "Docker",
    ".dockerignore": "Docker",

    // Config files
    "jest.config.js": "Jest",
    "jest.config.ts": "Jest",
    "jest.config.mjs": "Jest",
    "vitest.config.js": "Vitest",
    "vitest.config.ts": "Vitest",
    "tailwind.config.js": "Tailwindcss",
    "tailwind.config.ts": "Tailwindcss",
    "turbo.json": "Turborepo",
    "tsconfig.json": "Tsconfig",
    "jsconfig.json": "Jsconfig",
    ".eslintrc": "Eslint",
    ".eslintrc.js": "Eslint",
    ".eslintrc.json": "Eslint",
    ".prettierrc": "Prettier",
    ".prettierrc.js": "Prettier",
    ".prettierrc.json": "Prettier",
    "vite.config.js": "Vite",
    "vite.config.ts": "Vite",
    "webpack.config.js": "Webpack",
    "rollup.config.js": "Rollup",
    "astro.config.mjs": "AstroConfig",
    "astro.config.js": "AstroConfig",
    "next.config.js": "Next",
    "next.config.mjs": "Next",
    "nuxt.config.js": "Nuxt",
    "nuxt.config.ts": "Nuxt",
    "svelte.config.js": "Svelte",
    "gatsby-config.js": "Gatsby",
    "remix.config.js": "Remix",
    "prisma.schema": "Prisma",
    ".gitignore": "Git",
    ".gitattributes": "Git",
    makefile: "Makefile",
    cmake: "Cmake",
    "cargo.toml": "Rust",
    "go.mod": "GoMod",
    "go.sum": "GoMod",
    "requirements.txt": "Python",
    "pyproject.toml": "Python",
    pipfile: "Python",
    "poetry.lock": "Poetry",
    gemfile: "Gemfile",
    rakefile: "Ruby",
    "composer.json": "Php",
    "build.gradle": "Gradle",
    "pom.xml": "Maven",
    "deno.json": "Deno",
    "deno.jsonc": "Deno",
    "vercel.json": "Vercel",
    "netlify.toml": "Netlify",
    ".env": "Tune",
    ".env.local": "Tune",
    ".env.development": "Tune",
    ".env.production": "Tune",
    ".env.example": "Tune",
    ".editorconfig": "Editorconfig",
    "robots.txt": "Robots",
    "favicon.ico": "Favicon",
    browserlist: "Browserlist",
    ".babelrc": "Babel",
    "babel.config.js": "Babel",
    "gulpfile.js": "Gulp",
    "gruntfile.js": "Grunt",
    "capacitor.config.json": "Capacitor",
    "ionic.config.json": "Ionic",
    "angular.json": "Angular",
    ".storybook": "Storybook",
    "storybook.config.js": "Storybook",
    "cypress.config.js": "Cypress",
    "playwright.config.js": "Playwright",
    "puppeteer.config.js": "Puppeteer",
    "wrangler.toml": "Wrangler",
    "firebase.json": "Firebase",
    supabase: "Supabase",
    terraform: "Terraform",
    kubernetes: "Kubernetes",
    ".gitpod.yml": "Gitpod",
    ".devcontainer": "Vscode",
    "travis.yml": "Travis",
    "appveyor.yml": "Appveyor",
    ".circleci": "Circleci",
    "renovate.json": "Renovate",
    "dependabot.yml": "Dependabot",
    "lerna.json": "Lerna",
    "nx.json": "Nx",
  },
  fileExtensions: {
    // Test files
    "spec.ts": "TestTs",
    "test.ts": "TestTs",
    "spec.tsx": "TestJsx",
    "test.tsx": "TestJsx",
    "spec.js": "TestJs",
    "test.js": "TestJs",
    "spec.jsx": "TestJsx",
    "test.jsx": "TestJsx",

    // JavaScript/TypeScript
    "js.map": "JavascriptMap",
    "d.ts": "TypescriptDef",
    ts: "Typescript",
    tsx: "React_ts",
    js: "Javascript",
    jsx: "React",
    mjs: "Javascript",
    cjs: "Javascript",

    // Web languages
    html: "Html",
    htm: "Html",
    css: "Css",
    scss: "Sass",
    sass: "Sass",
    less: "Less",
    styl: "Stylus",

    // Data formats
    json: "Json",
    xml: "Xml",
    yml: "Yaml",
    yaml: "Yaml",
    toml: "Toml",
    hjson: "Hjson",

    // Documentation
    md: "Markdown",
    mdx: "Mdx",
    tex: "Tex",

    // Programming languages
    py: "Python",
    pyx: "Python",
    pyw: "Python",
    rs: "Rust",
    go: "Go",
    java: "Java",
    kt: "Kotlin",
    scala: "Scala",
    php: "Php",
    rb: "Ruby",
    cs: "Csharp",
    vb: "Visualstudio",
    cpp: "Cpp",
    cc: "Cpp",
    cxx: "Cpp",
    c: "C",
    h: "H",
    hpp: "Hpp",
    swift: "Swift",
    m: "ObjectiveC",
    mm: "ObjectiveCpp",
    dart: "Dart",
    lua: "Lua",
    pl: "Perl",
    r: "R",
    jl: "Julia",
    hs: "Haskell",
    elm: "Elm",
    ml: "Ocaml",
    clj: "Clojure",
    cljs: "Clojure",
    erl: "Erlang",
    ex: "Elixir",
    exs: "Elixir",
    nim: "Nim",
    zig: "Zig",
    v: "Vlang",
    odin: "Odin",
    gleam: "Gleam",
    grain: "Grain",
    roc: "Rocket",
    fs: "Fsharp",

    // Shell scripts
    sh: "Console",
    bash: "Console",
    zsh: "Console",
    fish: "Console",
    ps1: "Powershell",

    // Config/build files
    cfg: "Settings",
    ini: "Settings",
    conf: "Settings",
    properties: "Settings",

    // Media files
    svg: "Svg",
    png: "Image",
    jpg: "Image",
    jpeg: "Image",
    gif: "Image",
    webp: "Image",
    bmp: "Image",
    ico: "Favicon",
    mp4: "Video",
    mov: "Video",
    avi: "Video",
    webm: "Video",
    mp3: "Audio",
    wav: "Audio",
    flac: "Audio",

    // Archive files
    zip: "Zip",
    tar: "Zip",
    gz: "Zip",
    rar: "Zip",
    "7z": "Zip",

    // Document files
    pdf: "Pdf",
    doc: "Word",
    docx: "Word",
    ppt: "Powerpoint",
    pptx: "Powerpoint",
    xls: "Document",
    xlsx: "Document",

    // Database files
    sql: "Database",
    db: "Database",
    sqlite: "Database",

    // Other
    env: "Tune",
    log: "Log",
    lock: "Lock",
    key: "Key",
    pem: "Certificate",
    crt: "Certificate",
    proto: "Proto",
    graphql: "Graphql",
    gql: "Graphql",
    wasm: "Webassembly",
    dockerfile: "Docker",
  },
  folderNames: {
    // Source code
    src: "FolderSrc",
    source: "FolderSrc",
    lib: "FolderLib",
    libs: "FolderLib",

    // Testing
    test: "FolderTest",
    tests: "FolderTest",
    testing: "FolderTest",
    spec: "FolderTest",
    specs: "FolderTest",
    __tests__: "FolderTest",
    e2e: "FolderTest",
    integration: "FolderTest",
    unit: "FolderTest",
    cypress: "FolderCypress",

    // Dependencies
    node_modules: "FolderNode",
    vendor: "FolderPackages",
    packages: "FolderPackages",
    deps: "FolderPackages",

    // Build/dist
    build: "FolderBuildkite",
    dist: "FolderDist",
    out: "FolderDist",
    output: "FolderDist",
    target: "FolderTarget",

    // Configuration
    config: "FolderConfig",
    configs: "FolderConfig",
    configuration: "FolderConfig",
    settings: "FolderConfig",
    env: "FolderEnvironment",
    environments: "FolderEnvironment",

    // Docker
    docker: "FolderDocker",
    dockerfiles: "FolderDocker",
    containers: "FolderDocker",

    // Documentation
    docs: "FolderDocs",
    doc: "FolderDocs",
    documentation: "FolderDocs",
    readme: "FolderDocs",

    // Public/assets
    public: "FolderPublic",
    static: "FolderPublic",
    assets: "FolderImages",
    images: "FolderImages",
    img: "FolderImages",
    icons: "FolderImages",
    media: "FolderImages",
    fonts: "FolderFont",
    styles: "FolderCss",
    stylesheets: "FolderCss",
    css: "FolderCss",
    sass: "FolderSass",
    scss: "FolderSass",
    less: "FolderLess",

    // Scripts
    scripts: "FolderScripts",
    script: "FolderScripts",
    tools: "FolderTools",
    utils: "FolderUtils",
    utilities: "FolderUtils",
    helpers: "FolderHelper",

    // Framework specific
    components: "FolderComponents",
    component: "FolderComponents",
    views: "FolderViews",
    view: "FolderViews",
    layouts: "FolderLayout",
    layout: "FolderLayout",
    templates: "FolderTemplate",
    template: "FolderTemplate",
    hooks: "FolderHook",
    hook: "FolderHook",
    store: "FolderStore",
    stores: "FolderStore",
    state: "FolderNgrxStore",
    reducers: "FolderReduxReducer",
    reducer: "FolderReduxReducer",
    services: "FolderApi",
    service: "FolderApi",
    api: "FolderApi",
    apis: "FolderApi",
    routes: "FolderRoutes",
    route: "FolderRoutes",
    routing: "FolderRoutes",
    middleware: "FolderMiddleware",
    middlewares: "FolderMiddleware",
    controllers: "FolderController",
    controller: "FolderController",
    models: "FolderDatabase",
    model: "FolderDatabase",
    schemas: "FolderDatabase",
    schema: "FolderDatabase",
    migrations: "FolderDatabase",
    migration: "FolderDatabase",
    seeders: "FolderSeeders",
    seeder: "FolderSeeders",

    // TypeScript
    types: "FolderTypescript",
    typing: "FolderTypescript",
    typings: "FolderTypescript",
    "@types": "FolderTypescript",
    interfaces: "FolderInterface",
    interface: "FolderInterface",

    // Mobile
    android: "FolderAndroid",
    ios: "FolderIos",
    mobile: "FolderMobile",
    flutter: "FolderFlutter",

    // Infrastructure
    kubernetes: "FolderKubernetes",
    k8s: "FolderKubernetes",
    terraform: "FolderTerraform",
    aws: "FolderAws",
    azure: "FolderAzurePipelines",
    firebase: "FolderFirebase",
    supabase: "FolderSupabase",
    vercel: "FolderVercel",
    netlify: "FolderNetlify",

    // CI/CD
    ".github": "FolderGithub",
    ".gitlab": "FolderGitlab",
    ".circleci": "FolderCircleci",
    ci: "FolderCi",
    ".ci": "FolderCi",
    workflows: "FolderGhWorkflows",

    // Git
    ".git": "FolderGit",

    // Development tools
    ".vscode": "FolderVscode",
    ".idea": "FolderIntellij",
    ".cursor": "FolderCursor",
    ".devcontainer": "FolderContainer",
    ".storybook": "FolderStorybook",

    // Localization
    i18n: "FolderI18n",
    locales: "FolderI18n",
    locale: "FolderI18n",
    lang: "FolderI18n",
    languages: "FolderI18n",

    // Other common patterns
    temp: "FolderTemp",
    tmp: "FolderTemp",
    logs: "FolderLog",
    log: "FolderLog",
    backup: "FolderBackup",
    backups: "FolderBackup",
    examples: "FolderExamples",
    example: "FolderExamples",
    demo: "FolderExamples",
    demos: "FolderExamples",
    samples: "FolderExamples",
    sample: "FolderExamples",
    fixtures: "FolderTest",
    mocks: "FolderMock",
    mock: "FolderMock",
    data: "FolderDatabase",
    database: "FolderDatabase",
    db: "FolderDatabase",
    sql: "FolderDatabase",
    prisma: "FolderPrisma",
    drizzle: "FolderDrizzle",

    // Security
    security: "FolderSecure",
    auth: "FolderSecure",
    authentication: "FolderSecure",
    authorization: "FolderSecure",
    keys: "FolderKeys",
    certs: "FolderKeys",
    certificates: "FolderKeys",

    // Content
    content: "FolderContent",
    posts: "FolderContent",
    articles: "FolderContent",
    blog: "FolderContent",

    // Functions
    functions: "FolderFunctions",
    function: "FolderFunctions",
    lambda: "FolderFunctions",
    lambdas: "FolderFunctions",
    serverless: "FolderServerless",

    // Jobs/tasks
    jobs: "FolderJob",
    job: "FolderJob",
    tasks: "FolderTasks",
    task: "FolderTasks",
    cron: "FolderTasks",
    queue: "FolderQueue",
    queues: "FolderQueue",

    // Desktop platforms
    desktop: "FolderDesktop",
    windows: "FolderWindows",
    macos: "FolderMacos",
    linux: "FolderLinux",
  },
  defaults: {
    file: "Document",
    folder: "Folder",
    folderOpen: "FolderOpen",
  },
}

const toOpenVariant = (icon: IconName): IconName => {
  if (!icon.startsWith("Folder")) return icon
  if (icon.endsWith("_light")) return icon.replace("_light", "Open_light") as IconName
  if (!icon.endsWith("Open")) return (icon + "Open") as IconName
  return icon
}

const basenameOf = (p: string) =>
  p
    .replace(/[/\\]+$/, "")
    .split(/[\\/]/)
    .pop() ?? ""

const folderNameVariants = (name: string) => {
  const n = name.toLowerCase()
  return [n, `.${n}`, `_${n}`, `__${n}__`]
}

const dottedSuffixesDesc = (name: string) => {
  const n = name.toLowerCase()
  const idxs: number[] = []
  for (let i = 0; i < n.length; i++) if (n[i] === ".") idxs.push(i)
  const out = new Set<string>()
  out.add(n) // allow exact whole-name "extensions" like "dockerfile"
  for (const i of idxs) if (i + 1 < n.length) out.add(n.slice(i + 1))
  return Array.from(out).sort((a, b) => b.length - a.length) // longest first
}

export function chooseIconName(path: string, type: "directory" | "file", expanded: boolean): IconName {
  const base = basenameOf(path)
  const baseLower = base.toLowerCase()

  if (type === "directory") {
    for (const cand of folderNameVariants(baseLower)) {
      const icon = ICON_MAPS.folderNames[cand]
      if (icon) return expanded ? toOpenVariant(icon) : icon
    }
    return expanded ? ICON_MAPS.defaults.folderOpen : ICON_MAPS.defaults.folder
  }

  const byName = ICON_MAPS.fileNames[baseLower]
  if (byName) return byName

  for (const ext of dottedSuffixesDesc(baseLower)) {
    const icon = ICON_MAPS.fileExtensions[ext]
    if (icon) return icon
  }

  return ICON_MAPS.defaults.file
}
