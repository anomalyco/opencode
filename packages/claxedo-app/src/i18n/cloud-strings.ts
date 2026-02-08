/**
 * Cloud-specific i18n Strings
 *
 * These strings are merged into the core OpenCode dictionaries
 * to provide cloud-specific translations without modifying upstream locale files.
 *
 * Structure: { locale: { "flat.key": "Translation" } }
 */

export const cloudStrings: Record<string, Record<string, string>> = {
  en: {
    // Override workspace terminology for cloud
    "workspace.new": "New Project",
    "command.project.open": "New Project",

    // Account section
    "settings.general.section.account": "Account",
    "settings.general.account.logout.title": "Log out",
    "settings.general.account.logout.description": "Sign out of your Claxedo account",
    "settings.general.account.logout.button": "Log out",
    "settings.general.account.email": "Email",
    "settings.general.account.organization": "Organization",

    // Login page
    "cloud.login.title": "Sign in to Claxedo",
    "cloud.login.subtitle": "Cloud-first development environment",
    "cloud.login.github": "Continue with GitHub",
    "cloud.login.google": "Continue with Google",
    "cloud.login.error.generic": "Failed to sign in. Please try again.",
    "cloud.login.error.github": "Failed to sign in with GitHub",
    "cloud.login.error.google": "Failed to sign in with Google",
    "cloud.login.terms": "By continuing, you agree to Claxedo's",
    "cloud.login.termsOfService": "Terms of Service",
    "cloud.login.and": "and",
    "cloud.login.privacyPolicy": "Privacy Policy",

    // Auth-related strings (legacy compatibility)
    "auth.login": "Log In",
    "auth.logout": "Log Out",
    "auth.signUp": "Sign Up",
    "auth.continueWith": "Continue with {provider}",
    "auth.loading": "Loading...",
    "auth.error.generic": "Authentication failed. Please try again.",
    "auth.error.github": "Failed to login with GitHub",
    "auth.error.google": "Failed to login with Google",

    // Login page (legacy compatibility)
    "login.title": "Claxedo",
    "login.tagline": "Cloud-first development environment",
    "login.termsPrefix": "By continuing, you agree to",
    "login.termsOfService": "Terms of Service",
    "login.and": "and",
    "login.privacyPolicy": "Privacy Policy",

    // Cloud project creation
    "cloud.project.create": "Create Cloud Project",
    "cloud.project.create.title": "New Cloud Project",
    "cloud.project.create.repoUrl": "Git Repository URL",
    "cloud.project.create.repoUrl.placeholder": "https://github.com/username/repo",
    "cloud.project.create.submit": "Clone & Open",
    "cloud.project.create.loading": "Cloning...",
    "cloud.project.create.error": "Failed to create project",

    // Legacy project strings
    "cloud.createProject": "New Cloud Project",
    "cloud.gitRepoUrl": "Git Repository URL",
    "cloud.gitRepoPlaceholder": "https://github.com/username/repo",
    "cloud.cloneAndOpen": "Clone & Open",
    "cloud.cloning": "Cloning...",
    "cloud.createFailed": "Failed to create project",

    // Cloud session
    "cloud.session.connecting": "Connecting to cloud sandbox...",
    "cloud.session.error.notFound": "Cloud session not found",
    "cloud.session.error.connection": "Failed to connect to cloud sandbox",

    // Cloud server
    "cloud.server.connecting": "Connecting to cloud server...",
    "cloud.server.connected": "Connected to cloud server",
    "cloud.server.disconnected": "Disconnected from cloud server",
    "cloud.server.error": "Cloud server error",

    // Sandbox
    "sandbox.creating": "Creating sandbox...",
    "sandbox.ready": "Sandbox ready",
    "sandbox.error": "Sandbox error",

    // Cloud status
    "cloud.status.connected": "Connected to cloud",
    "cloud.status.disconnected": "Disconnected from cloud",
    "cloud.status.syncing": "Syncing with cloud...",
  },

  zh: {
    // Override workspace terminology for cloud
    "workspace.new": "新建项目",
    "command.project.open": "新建项目",

    // Account section
    "settings.general.section.account": "账户",
    "settings.general.account.logout.title": "退出登录",
    "settings.general.account.logout.description": "退出您的 Claxedo 账户",
    "settings.general.account.logout.button": "退出登录",
    "settings.general.account.email": "电子邮件",
    "settings.general.account.organization": "组织",

    // Login page
    "cloud.login.title": "登录 Claxedo",
    "cloud.login.subtitle": "云端优先的开发环境",
    "cloud.login.github": "使用 GitHub 继续",
    "cloud.login.google": "使用 Google 继续",
    "cloud.login.error.generic": "登录失败，请重试。",
    "cloud.login.error.github": "使用 GitHub 登录失败",
    "cloud.login.error.google": "使用 Google 登录失败",
    "cloud.login.terms": "继续即表示您同意 Claxedo 的",
    "cloud.login.termsOfService": "服务条款",
    "cloud.login.and": "和",
    "cloud.login.privacyPolicy": "隐私政策",

    // Cloud project creation
    "cloud.project.create": "创建云项目",
    "cloud.project.create.title": "新建云项目",
    "cloud.project.create.repoUrl": "Git 仓库 URL",
    "cloud.project.create.repoUrl.placeholder": "https://github.com/username/repo",
    "cloud.project.create.submit": "克隆并打开",
    "cloud.project.create.loading": "正在克隆...",
    "cloud.project.create.error": "创建项目失败",

    // Cloud session
    "cloud.session.connecting": "正在连接云沙箱...",
    "cloud.session.error.notFound": "未找到云会话",
    "cloud.session.error.connection": "连接云沙箱失败",

    // Cloud status
    "cloud.status.connected": "已连接到云端",
    "cloud.status.disconnected": "已断开云端连接",
    "cloud.status.syncing": "正在与云端同步...",
  },

  zht: {
    // Override workspace terminology for cloud
    "workspace.new": "新建專案",
    "command.project.open": "新建專案",

    // Account section
    "settings.general.section.account": "帳戶",
    "settings.general.account.logout.title": "登出",
    "settings.general.account.logout.description": "登出您的 Claxedo 帳戶",
    "settings.general.account.logout.button": "登出",
    "settings.general.account.email": "電子郵件",
    "settings.general.account.organization": "組織",

    // Login page
    "cloud.login.title": "登入 Claxedo",
    "cloud.login.subtitle": "雲端優先的開發環境",
    "cloud.login.github": "使用 GitHub 繼續",
    "cloud.login.google": "使用 Google 繼續",
    "cloud.login.error.generic": "登入失敗，請重試。",
    "cloud.login.error.github": "使用 GitHub 登入失敗",
    "cloud.login.error.google": "使用 Google 登入失敗",
    "cloud.login.terms": "繼續即表示您同意 Claxedo 的",
    "cloud.login.termsOfService": "服務條款",
    "cloud.login.and": "和",
    "cloud.login.privacyPolicy": "隱私政策",

    // Cloud project creation
    "cloud.project.create": "建立雲端專案",
    "cloud.project.create.title": "新建雲端專案",
    "cloud.project.create.repoUrl": "Git 儲存庫 URL",
    "cloud.project.create.repoUrl.placeholder": "https://github.com/username/repo",
    "cloud.project.create.submit": "複製並開啟",
    "cloud.project.create.loading": "正在複製...",
    "cloud.project.create.error": "建立專案失敗",

    // Cloud session
    "cloud.session.connecting": "正在連接雲端沙箱...",
    "cloud.session.error.notFound": "未找到雲端會話",
    "cloud.session.error.connection": "連接雲端沙箱失敗",

    // Cloud status
    "cloud.status.connected": "已連接到雲端",
    "cloud.status.disconnected": "已斷開雲端連接",
    "cloud.status.syncing": "正在與雲端同步...",
  },

  ja: {
    // Override workspace terminology for cloud
    "workspace.new": "新規プロジェクト",
    "command.project.open": "新規プロジェクト",

    // Account section
    "settings.general.section.account": "アカウント",
    "settings.general.account.logout.title": "ログアウト",
    "settings.general.account.logout.description": "Claxedoアカウントからログアウト",
    "settings.general.account.logout.button": "ログアウト",
    "settings.general.account.email": "メールアドレス",
    "settings.general.account.organization": "組織",

    // Login page
    "cloud.login.title": "Claxedoにサインイン",
    "cloud.login.subtitle": "クラウドファーストの開発環境",
    "cloud.login.github": "GitHubで続ける",
    "cloud.login.google": "Googleで続ける",
    "cloud.login.error.generic": "サインインに失敗しました。もう一度お試しください。",
    "cloud.login.error.github": "GitHubでのサインインに失敗しました",
    "cloud.login.error.google": "Googleでのサインインに失敗しました",
    "cloud.login.terms": "続行することで、Claxedoの",
    "cloud.login.termsOfService": "利用規約",
    "cloud.login.and": "および",
    "cloud.login.privacyPolicy": "プライバシーポリシー",

    // Cloud project creation
    "cloud.project.create": "クラウドプロジェクトを作成",
    "cloud.project.create.title": "新規クラウドプロジェクト",
    "cloud.project.create.repoUrl": "GitリポジトリURL",
    "cloud.project.create.repoUrl.placeholder": "https://github.com/username/repo",
    "cloud.project.create.submit": "クローンして開く",
    "cloud.project.create.loading": "クローン中...",
    "cloud.project.create.error": "プロジェクトの作成に失敗しました",

    // Cloud session
    "cloud.session.connecting": "クラウドサンドボックスに接続中...",
    "cloud.session.error.notFound": "クラウドセッションが見つかりません",
    "cloud.session.error.connection": "クラウドサンドボックスへの接続に失敗しました",

    // Cloud status
    "cloud.status.connected": "クラウドに接続済み",
    "cloud.status.disconnected": "クラウドから切断",
    "cloud.status.syncing": "クラウドと同期中...",
  },

  ko: {
    // Override workspace terminology for cloud
    "workspace.new": "새 프로젝트",
    "command.project.open": "새 프로젝트",

    // Account section
    "settings.general.section.account": "계정",
    "settings.general.account.logout.title": "로그아웃",
    "settings.general.account.logout.description": "Claxedo 계정에서 로그아웃",
    "settings.general.account.logout.button": "로그아웃",
    "settings.general.account.email": "이메일",
    "settings.general.account.organization": "조직",

    // Login page
    "cloud.login.title": "Claxedo 로그인",
    "cloud.login.subtitle": "클라우드 우선 개발 환경",
    "cloud.login.github": "GitHub로 계속",
    "cloud.login.google": "Google로 계속",
    "cloud.login.error.generic": "로그인에 실패했습니다. 다시 시도해 주세요.",
    "cloud.login.error.github": "GitHub 로그인에 실패했습니다",
    "cloud.login.error.google": "Google 로그인에 실패했습니다",
    "cloud.login.terms": "계속 진행하면 Claxedo의",
    "cloud.login.termsOfService": "서비스 약관",
    "cloud.login.and": "및",
    "cloud.login.privacyPolicy": "개인정보 처리방침",

    // Cloud project creation
    "cloud.project.create": "클라우드 프로젝트 생성",
    "cloud.project.create.title": "새 클라우드 프로젝트",
    "cloud.project.create.repoUrl": "Git 저장소 URL",
    "cloud.project.create.repoUrl.placeholder": "https://github.com/username/repo",
    "cloud.project.create.submit": "복제 및 열기",
    "cloud.project.create.loading": "복제 중...",
    "cloud.project.create.error": "프로젝트 생성에 실패했습니다",

    // Cloud session
    "cloud.session.connecting": "클라우드 샌드박스에 연결 중...",
    "cloud.session.error.notFound": "클라우드 세션을 찾을 수 없습니다",
    "cloud.session.error.connection": "클라우드 샌드박스 연결에 실패했습니다",

    // Cloud status
    "cloud.status.connected": "클라우드에 연결됨",
    "cloud.status.disconnected": "클라우드 연결 끊김",
    "cloud.status.syncing": "클라우드와 동기화 중...",
  },

  de: {
    // Override workspace terminology for cloud
    "workspace.new": "Neues Projekt",
    "command.project.open": "Neues Projekt",

    // Account section
    "settings.general.section.account": "Konto",
    "settings.general.account.logout.title": "Abmelden",
    "settings.general.account.logout.description": "Von Ihrem Claxedo-Konto abmelden",
    "settings.general.account.logout.button": "Abmelden",
    "settings.general.account.email": "E-Mail",
    "settings.general.account.organization": "Organisation",

    // Login page
    "cloud.login.title": "Bei Claxedo anmelden",
    "cloud.login.subtitle": "Cloud-First-Entwicklungsumgebung",
    "cloud.login.github": "Mit GitHub fortfahren",
    "cloud.login.google": "Mit Google fortfahren",
    "cloud.login.error.generic": "Anmeldung fehlgeschlagen. Bitte versuchen Sie es erneut.",
    "cloud.login.error.github": "Anmeldung mit GitHub fehlgeschlagen",
    "cloud.login.error.google": "Anmeldung mit Google fehlgeschlagen",
    "cloud.login.terms": "Durch Fortfahren stimmen Sie den",
    "cloud.login.termsOfService": "Nutzungsbedingungen",
    "cloud.login.and": "und der",
    "cloud.login.privacyPolicy": "Datenschutzrichtlinie",

    // Cloud project creation
    "cloud.project.create": "Cloud-Projekt erstellen",
    "cloud.project.create.title": "Neues Cloud-Projekt",
    "cloud.project.create.repoUrl": "Git-Repository-URL",
    "cloud.project.create.repoUrl.placeholder": "https://github.com/username/repo",
    "cloud.project.create.submit": "Klonen & Oeffnen",
    "cloud.project.create.loading": "Wird geklont...",
    "cloud.project.create.error": "Projekt konnte nicht erstellt werden",

    // Cloud session
    "cloud.session.connecting": "Verbindung zur Cloud-Sandbox wird hergestellt...",
    "cloud.session.error.notFound": "Cloud-Sitzung nicht gefunden",
    "cloud.session.error.connection": "Verbindung zur Cloud-Sandbox fehlgeschlagen",

    // Cloud status
    "cloud.status.connected": "Mit Cloud verbunden",
    "cloud.status.disconnected": "Von Cloud getrennt",
    "cloud.status.syncing": "Wird mit Cloud synchronisiert...",
  },

  fr: {
    // Override workspace terminology for cloud
    "workspace.new": "Nouveau projet",
    "command.project.open": "Nouveau projet",

    // Account section
    "settings.general.section.account": "Compte",
    "settings.general.account.logout.title": "Se deconnecter",
    "settings.general.account.logout.description": "Se deconnecter de votre compte Claxedo",
    "settings.general.account.logout.button": "Se deconnecter",
    "settings.general.account.email": "E-mail",
    "settings.general.account.organization": "Organisation",

    // Login page
    "cloud.login.title": "Se connecter a Claxedo",
    "cloud.login.subtitle": "Environnement de developpement cloud-first",
    "cloud.login.github": "Continuer avec GitHub",
    "cloud.login.google": "Continuer avec Google",
    "cloud.login.error.generic": "Echec de la connexion. Veuillez reessayer.",
    "cloud.login.error.github": "Echec de la connexion avec GitHub",
    "cloud.login.error.google": "Echec de la connexion avec Google",
    "cloud.login.terms": "En continuant, vous acceptez les",
    "cloud.login.termsOfService": "Conditions d'utilisation",
    "cloud.login.and": "et la",
    "cloud.login.privacyPolicy": "Politique de confidentialite",

    // Cloud project creation
    "cloud.project.create": "Creer un projet cloud",
    "cloud.project.create.title": "Nouveau projet cloud",
    "cloud.project.create.repoUrl": "URL du depot Git",
    "cloud.project.create.repoUrl.placeholder": "https://github.com/username/repo",
    "cloud.project.create.submit": "Cloner et ouvrir",
    "cloud.project.create.loading": "Clonage en cours...",
    "cloud.project.create.error": "Echec de la creation du projet",

    // Cloud session
    "cloud.session.connecting": "Connexion au bac a sable cloud...",
    "cloud.session.error.notFound": "Session cloud introuvable",
    "cloud.session.error.connection": "Echec de la connexion au bac a sable cloud",

    // Cloud status
    "cloud.status.connected": "Connecte au cloud",
    "cloud.status.disconnected": "Deconnecte du cloud",
    "cloud.status.syncing": "Synchronisation avec le cloud...",
  },

  es: {
    // Override workspace terminology for cloud
    "workspace.new": "Nuevo proyecto",
    "command.project.open": "Nuevo proyecto",

    // Account section
    "settings.general.section.account": "Cuenta",
    "settings.general.account.logout.title": "Cerrar sesion",
    "settings.general.account.logout.description": "Cerrar sesion de su cuenta Claxedo",
    "settings.general.account.logout.button": "Cerrar sesion",
    "settings.general.account.email": "Correo electronico",
    "settings.general.account.organization": "Organizacion",

    // Login page
    "cloud.login.title": "Iniciar sesion en Claxedo",
    "cloud.login.subtitle": "Entorno de desarrollo cloud-first",
    "cloud.login.github": "Continuar con GitHub",
    "cloud.login.google": "Continuar con Google",
    "cloud.login.error.generic": "Error al iniciar sesion. Por favor, intentelo de nuevo.",
    "cloud.login.error.github": "Error al iniciar sesion con GitHub",
    "cloud.login.error.google": "Error al iniciar sesion con Google",
    "cloud.login.terms": "Al continuar, acepta los",
    "cloud.login.termsOfService": "Terminos de servicio",
    "cloud.login.and": "y la",
    "cloud.login.privacyPolicy": "Politica de privacidad",

    // Cloud project creation
    "cloud.project.create": "Crear proyecto en la nube",
    "cloud.project.create.title": "Nuevo proyecto en la nube",
    "cloud.project.create.repoUrl": "URL del repositorio Git",
    "cloud.project.create.repoUrl.placeholder": "https://github.com/username/repo",
    "cloud.project.create.submit": "Clonar y abrir",
    "cloud.project.create.loading": "Clonando...",
    "cloud.project.create.error": "Error al crear el proyecto",

    // Cloud session
    "cloud.session.connecting": "Conectando al sandbox en la nube...",
    "cloud.session.error.notFound": "Sesion en la nube no encontrada",
    "cloud.session.error.connection": "Error al conectar con el sandbox en la nube",

    // Cloud status
    "cloud.status.connected": "Conectado a la nube",
    "cloud.status.disconnected": "Desconectado de la nube",
    "cloud.status.syncing": "Sincronizando con la nube...",
  },
}

export type CloudStrings = typeof cloudStrings
export type CloudStringKey = keyof (typeof cloudStrings)["en"]
