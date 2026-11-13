//! The command tree of `packages/cli/src/commands/commands.ts` as a static table in the shape of Effect CLI's
//! commands, flags, and arguments, and the typed arguments each handler takes. `src/tests/tree.rs` proves the
//! table against a dump of the TypeScript tree; `parse.rs` parses a command line over it.

use crate::parse::Values;

/// A command: Effect's `Command.make(name, params)` with its description, alias, global flags, and subcommands.
pub struct Spec {
    pub name: &'static str,
    /// `Command.withAlias`: a second name, shown as `name, alias` in help.
    pub alias: Option<&'static str>,
    pub description: &'static str,
    /// `Command.withGlobalFlags`: flags this command and its subcommands accept anywhere on the line.
    pub globals: &'static [Flag],
    /// Flags and arguments in declaration order, which is the order Effect parses and reports them in.
    pub params: &'static [Param],
    pub commands: &'static [Spec],
}

pub enum Param {
    Flag(Flag),
    Arg(Arg),
}

#[derive(Clone, Copy)]
pub struct Flag {
    pub name: &'static str,
    /// Single letters are short flags (`-c`), longer ones long flags.
    pub aliases: &'static [&'static str],
    pub description: &'static str,
    pub kind: Kind,
    /// `Flag.withMetavar`: the type shown in help in place of the kind's name.
    pub metavar: Option<&'static str>,
    pub hidden: bool,
    pub count: Count,
    /// `Flag.withOptionalValue`: the flag takes a value only after `=`, and is this value without one.
    pub optional_value: Option<&'static str>,
    pub check: Check,
}

#[derive(Clone, Copy)]
pub struct Arg {
    pub name: &'static str,
    pub description: &'static str,
    pub kind: Kind,
    pub count: Count,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Boolean,
    String,
    Int,
    Choice(&'static [&'static str]),
    KeyValue,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Count {
    Required,
    /// `Flag.optional`, `Argument.optional`.
    Optional,
    /// `Flag.withDefault`.
    Default(Default),
    /// `Flag.atMost`, `Flag.atLeast`, `Argument.variadic`, and `Flag.KeyValuePair` (at least one pair, then
    /// `optional` when wrapped in `Flag.optional`).
    Repeated {
        min: Option<usize>,
        max: Option<usize>,
        optional: bool,
    },
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Default {
    Bool(bool),
    Text(&'static str),
    Int(i64),
}

/// `Flag.withSchema` and `Flag.mapTryCatch` checks after the kind's own parse.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Check {
    None,
    AtLeast(i64),
    Between(i64, i64),
    NonEmpty,
    PairingUrl,
}

impl Flag {
    const fn new(name: &'static str, description: &'static str, kind: Kind, count: Count) -> Flag {
        Flag {
            name,
            aliases: &[],
            description,
            kind,
            metavar: None,
            hidden: false,
            count,
            optional_value: None,
            check: Check::None,
        }
    }

    const fn alias(self, aliases: &'static [&'static str]) -> Flag {
        Flag { aliases, ..self }
    }

    const fn hidden(self) -> Flag {
        Flag { hidden: true, ..self }
    }

    const fn check(self, check: Check) -> Flag {
        Flag { check, ..self }
    }

    const fn count(self, count: Count) -> Flag {
        Flag { count, ..self }
    }

    pub fn is_boolean(&self) -> bool {
        self.kind == Kind::Boolean
    }

    /// The long name that sets a boolean to false.
    pub fn negation(&self) -> Option<String> {
        self.is_boolean().then(|| format!("no-{}", self.name))
    }
}

impl Arg {
    pub fn is_variadic(&self) -> bool {
        matches!(self.count, Count::Repeated { .. })
    }

    /// Effect's help and completions: a variadic argument is required when it needs at least one value.
    pub fn is_required(&self) -> bool {
        match self.count {
            Count::Required => true,
            Count::Repeated { min, .. } => min.unwrap_or(0) > 0,
            _ => false,
        }
    }
}

impl Kind {
    /// `Primitive.getTypeName`.
    pub fn type_name(&self) -> &'static str {
        match self {
            Kind::Boolean => "boolean",
            Kind::String => "string",
            Kind::Int => "integer",
            Kind::Choice(_) => "choice",
            Kind::KeyValue => "key=value",
        }
    }
}

impl Spec {
    const fn new(name: &'static str, description: &'static str) -> Spec {
        Spec { name, alias: None, description, globals: &[], params: &[], commands: &[] }
    }

    const fn alias(self, alias: &'static str) -> Spec {
        Spec { alias: Some(alias), ..self }
    }

    const fn globals(self, globals: &'static [Flag]) -> Spec {
        Spec { globals, ..self }
    }

    const fn params(self, params: &'static [Param]) -> Spec {
        Spec { params, ..self }
    }

    const fn commands(self, commands: &'static [Spec]) -> Spec {
        Spec { commands, ..self }
    }

    pub fn flags(&self) -> impl Iterator<Item = &Flag> {
        self.params.iter().filter_map(|param| match param {
            Param::Flag(flag) => Some(flag),
            Param::Arg(_) => None,
        })
    }

    pub fn arguments(&self) -> impl Iterator<Item = &Arg> {
        self.params.iter().filter_map(|param| match param {
            Param::Arg(arg) => Some(arg),
            Param::Flag(_) => None,
        })
    }

    /// The subcommand named `name` or aliased so.
    pub fn find(&self, name: &str) -> Option<&Spec> {
        self.commands.iter().find(|sub| sub.name == name || sub.alias == Some(name))
    }
}

const fn boolean(name: &'static str, description: &'static str) -> Flag {
    Flag::new(name, description, Kind::Boolean, Count::Default(Default::Bool(false)))
}

const fn string(name: &'static str, description: &'static str) -> Flag {
    Flag::new(name, description, Kind::String, Count::Optional)
}

const fn int(name: &'static str, description: &'static str) -> Flag {
    Flag::new(name, description, Kind::Int, Count::Optional)
}

const fn choice(name: &'static str, description: &'static str, choices: &'static [&'static str]) -> Flag {
    Flag::new(name, description, Kind::Choice(choices), Count::Optional)
}

const fn key_value(name: &'static str, description: &'static str) -> Flag {
    Flag::new(name, description, Kind::KeyValue, Count::Repeated { min: Some(1), max: None, optional: true })
}

const AT_MOST_100: Count = Count::Repeated { min: None, max: Some(100), optional: false };

const fn arg(name: &'static str, description: &'static str) -> Arg {
    Arg { name, description, kind: Kind::String, count: Count::Required }
}

const fn optional(name: &'static str, description: &'static str) -> Arg {
    Arg { name, description, kind: Kind::String, count: Count::Optional }
}

const fn variadic(name: &'static str, description: &'static str, min: usize, max: Option<usize>) -> Arg {
    Arg { name, description, kind: Kind::String, count: Count::Repeated { min: Some(min), max, optional: false } }
}

const STANDALONE_TEXT: &str = "Run with a private server instead of the background service";
const SERVER_TEXT: &str = "Connect to a server URL instead of the background service";
const SESSION_TEXT: &str = "Session ID to continue, or to create if it does not exist";

const STANDALONE: Flag = boolean("standalone", STANDALONE_TEXT);
const SERVER: Flag = string("server", SERVER_TEXT);
const PRINT_LOGS: Flag = boolean("print-logs", "Print logs to stderr (server logs require --standalone)");
const SERVER_FLAGS: &[Flag] = &[STANDALONE, SERVER];

/// Effect CLI's built-in global flags (`GlobalFlag.BuiltIns`), accepted by every command.
pub const BUILTINS: &[Flag] = &[
    boolean("help", "Show help information").alias(&["h"]),
    boolean("version", "Show version information").alias(&["v"]),
    boolean("wizard", "Start wizard mode for a command"),
    Flag {
        metavar: Some("<bash|zsh|fish|powershell|sh|pwsh>"),
        ..choice("completions", "Print shell completion script", Shell::CHOICES)
    },
    Flag {
        metavar: Some("<all|trace|debug|info|warn|warning|error|fatal|none>"),
        ..choice("log-level", "Sets the minimum log level", LogLevel::CHOICES)
    },
];

const AUTO: Param = Param::Flag(boolean("auto", "Auto-approve permissions that are not explicitly denied"));
const YOLO: Param = Param::Flag(boolean("yolo", "").hidden());
const DANGEROUSLY: Param = Param::Flag(boolean("dangerously-skip-permissions", "").hidden());
const CONTINUE: Param = Param::Flag(boolean("continue", "Continue the last session").alias(&["c"]));
const SESSION: Param = Param::Flag(string("session", SESSION_TEXT).alias(&["s"]));
const PROMPT: Param = Param::Flag(string("prompt", "Prompt to use"));
const AGENT: Param = Param::Flag(string("agent", "Agent to use"));
const FORMAT: Param = Param::Flag(
    choice("format", "Output format", OutputFormat::CHOICES).count(Count::Default(Default::Text("default"))),
);
const TARGET: Param = Param::Arg(optional("target", "Integration ID or name"));
const CREDENTIAL: Param =
    Param::Arg(optional("credential", "Credential ID or label (opens an account picker when omitted)"));
/// `Updater.methods`.
const UPGRADE_METHODS: &[&str] = &["curl", "npm", "pnpm", "bun", "yarn", "vp", "brew", "winget"];
const MCP_NAME: &str = "Name of the MCP server";
const KEY: &str = "Service setting or env";

pub static ROOT: Spec = Spec::new("opencode", "OpenCode command line interface")
    .globals(&[PRINT_LOGS])
    .params(&[
        Param::Flag(STANDALONE),
        Param::Flag(SERVER),
        AUTO,
        YOLO,
        DANGEROUSLY,
        Param::Arg(optional("directory", "Directory to start OpenCode in")),
        CONTINUE,
        SESSION,
        PROMPT,
    ])
    .commands(&[
        Spec::new("upgrade", "Upgrade OpenCode to the latest or a specific version").alias("update").params(&[
            Param::Arg(optional("target", "Version to upgrade to (with or without a leading v)")),
            Param::Flag(choice("method", "Installation method to use", UPGRADE_METHODS).alias(&["m"])),
        ]),
        Spec::new("uninstall", "Uninstall OpenCode, keeping session data, configuration, and state").params(&[
            Param::Flag(boolean("dry-run", "Show what would be removed without removing")),
            Param::Flag(boolean("force", "Skip confirmation prompts").alias(&["f"])),
        ]),
        Spec::new("acp", "Start an Agent Client Protocol server")
            .params(&[Param::Flag(boolean("login", "Run auth login instead of starting the server"))]),
        Spec::new("api", "Make a request to the running server").globals(SERVER_FLAGS).params(&[
            Param::Arg(variadic(
                "operation | method path",
                "OpenAPI operation ID, or an HTTP method followed by a path",
                1,
                Some(2),
            )),
            Param::Flag(string("data", "Request body").alias(&["d"])),
            Param::Flag(string("header", "Request header in name:value form").alias(&["H"]).count(AT_MOST_100)),
            Param::Flag(key_value("param", "OpenAPI path or query parameter")),
        ]),
        Spec::new("debug", "Debugging and troubleshooting tools").commands(&[
            Spec::new("agents", "List all agents").globals(SERVER_FLAGS),
            Spec::new("config", "List configuration sources").globals(SERVER_FLAGS),
            Spec::new("heap-dump", "Write a heap snapshot of the running server and print its path")
                .globals(&[SERVER])
                .params(&[Param::Flag(string(
                    "directory",
                    "Directory to write the snapshot into instead of the server's log directory",
                ))]),
            Spec::new("paths", "Show global paths (data, config, cache, state)").params(&[Param::Arg(Arg {
                kind: Kind::Choice(PathName::CHOICES),
                ..optional("name", "Print only one path: db, home, data, config, cache, state, tmp, bin, log, repos")
            })]),
        ]),
        Spec::new("auth", "manage integrations and credentials").globals(SERVER_FLAGS).commands(&[
            Spec::new("list", "list integrations and credentials").params(&[FORMAT]),
            Spec::new("login", "connect an integration").params(&[
                Param::Arg(optional("target", "Integration ID, name, or well-known provider URL")),
                Param::Flag(string("method", "Authentication method ID")),
                Param::Flag(
                    string("answer", "Provider form answer (key=value; repeat for multiple fields)").count(AT_MOST_100),
                ),
            ]),
            Spec::new("logout", "log out of a saved account").params(&[TARGET, CREDENTIAL]),
            Spec::new("export", "print stored credentials, including secrets, as JSON").params(&[Param::Arg(optional(
                "target",
                "Integration ID or name (exports every integration when omitted)",
            ))]),
            Spec::new("import", "import credentials exported by auth export")
                .params(&[Param::Arg(optional("file", "JSON file to import (reads stdin when omitted)"))]),
            Spec::new("switch", "switch the active account for an integration").params(&[TARGET, CREDENTIAL]),
        ]),
        Spec::new("mcp", "Manage MCP (Model Context Protocol) servers").commands(&[
            Spec::new("list", "List configured MCP servers and their status").globals(SERVER_FLAGS),
            Spec::new("add", "Add an MCP server to your configuration").params(&[
                Param::Arg(arg("name", MCP_NAME)),
                Param::Arg(variadic("command", "Command and arguments for a local server, passed after --", 0, None)),
                Param::Flag(string("url", "URL for a remote MCP server")),
                Param::Flag(key_value("header", "HTTP header for a remote server, as name=value")),
                Param::Flag(key_value("env", "Environment variable for a local server, as name=value")),
                Param::Flag(boolean("global", "Write to the global config instead of the project config")),
            ]),
            Spec::new("auth", "Authenticate with an OAuth-capable remote MCP server")
                .globals(SERVER_FLAGS)
                .params(&[Param::Arg(optional("name", MCP_NAME))]),
            Spec::new("logout", "Remove stored OAuth credentials for an MCP server")
                .globals(SERVER_FLAGS)
                .params(&[Param::Arg(arg("name", MCP_NAME))]),
        ]),
        Spec::new("plugin", "Manage plugins").commands(&[
            Spec::new("list", "List plugins")
                .globals(SERVER_FLAGS)
                .params(&[Param::Flag(boolean("builtin", "Include built-in server plugins"))]),
            Spec::new("add", "Install a plugin and add it to the global configuration")
                .params(&[Param::Arg(arg("package", "npm registry or Git package specifier"))]),
            Spec::new("check", "Check package plugins for updates")
                .globals(SERVER_FLAGS)
                .params(&[Param::Arg(optional("target", "Configured package target"))]),
            Spec::new("update", "Update package plugins")
                .globals(SERVER_FLAGS)
                .params(&[Param::Arg(optional("target", "Configured package target; omit to update all outdated plugins"))]),
            Spec::new("remove", "Remove a plugin from global configuration")
                .params(&[Param::Arg(arg("package", "configured package specifier"))]),
        ]),
        Spec::new("models", "List all available models").globals(SERVER_FLAGS),
        Spec::new("stats", "Show shareable usage statistics").globals(SERVER_FLAGS).params(&[
            Param::Flag(int("days", "Show the last N days; 0 means today").check(Check::AtLeast(0))),
            Param::Flag(int("year", "Show a calendar year").check(Check::Between(1970, 9999))),
            Param::Flag(boolean("all", "Show lifetime statistics")),
            Param::Flag(string("project", "Filter by project ID, or use \".\" for the current project")),
            Param::Flag(boolean("models", "Show model usage")),
            Param::Flag(boolean("tools", "Show tool reliability")),
            Param::Flag(boolean("cost", "Show cost and token details")),
            Param::Flag(boolean("full", "Show every detailed section")),
            Param::Flag(
                int("limit", "Number of rows in detailed sections")
                    .check(Check::AtLeast(1))
                    .count(Count::Default(Default::Int(5))),
            ),
            Param::Flag(boolean("json", "Output statistics as JSON")),
        ]),
        Spec::new("mini", "Start the minimal interactive interface").globals(SERVER_FLAGS).params(&[
            CONTINUE,
            SESSION,
            Param::Flag(boolean("fork", "Fork the session when continuing")),
            Param::Flag(
                boolean("replay", "Restore session history on resume and resize (disable with --no-replay)")
                    .count(Count::Optional),
            ),
            Param::Flag(int("replay-limit", "Limit replay to the newest N messages (default: 200)")),
            Param::Flag(string("model", "Model to use in the format provider/model").alias(&["m"])),
            AGENT,
            PROMPT,
            Param::Flag(boolean("demo", "").hidden()),
        ]),
        Spec::new("run", "Run OpenCode with a message").globals(SERVER_FLAGS).params(&[
            Param::Arg(variadic("message", "Message to send", 0, None)),
            CONTINUE,
            SESSION,
            Param::Flag(boolean("fork", "Fork the session before continuing")),
            Param::Flag(Flag {
                metavar: Some("name"),
                optional_value: Some(""),
                ..string("worktree", "Start a new session in a new git worktree, optionally with this name").alias(&["w"])
            }),
            Param::Flag(string("model", "Model to use in the format provider/model#variant").alias(&["m"])),
            AGENT,
            FORMAT,
            Param::Flag(string("file", "File to attach to the message").alias(&["f"]).count(AT_MOST_100)),
            Param::Flag(string("title", "Session title")),
            Param::Flag(boolean(
                "archived",
                "Create the session archived so it stays out of session lists (useful for scripted or CI runs)",
            )),
            Param::Flag(boolean("thinking", "Show thinking blocks")),
            AUTO,
            YOLO,
            DANGEROUSLY,
        ]),
        Spec::new("session", "Manage sessions").globals(SERVER_FLAGS).commands(&[
            Spec::new("list", "List top-level sessions in the current project, newest first").params(&[
                Param::Flag(
                    int("max-count", "Limit to N most recent sessions (default: 100)")
                        .alias(&["n"])
                        .check(Check::AtLeast(1)),
                ),
                Param::Flag(
                    choice("format", "Output format", SessionListFormat::CHOICES)
                        .count(Count::Default(Default::Text("table"))),
                ),
            ]),
            Spec::new("delete", "Delete a session and its child sessions")
                .params(&[Param::Arg(arg("sessionID", "Session ID to delete"))]),
            Spec::new("export", "Export session data as JSON").params(&[
                Param::Arg(optional("session", "Session ID to export")),
                Param::Flag(boolean("sanitize", "Redact sensitive transcript and file data")),
            ]),
            Spec::new("import", "Import session data from a JSON file or URL").params(&[
                Param::Arg(arg("file", "JSON file or URL to import")),
                Param::Flag(string("directory", "Directory in which to import the session")),
            ]),
        ]),
        Spec::new("service", "Manage the background server").commands(&[
            Spec::new("start", "Start the background server"),
            Spec::new("restart", "Restart the background server"),
            Spec::new("status", "Show background server status"),
            Spec::new("stop", "Stop the background server"),
            Spec::new("get", "Get service configuration")
                .params(&[Param::Arg(optional("key", KEY)), Param::Arg(optional("name", "Environment variable name"))]),
            Spec::new("set", "Set service configuration").params(&[
                Param::Arg(arg("key", KEY)),
                Param::Arg(arg("value", "Setting value or environment variable name")),
                Param::Arg(optional("env-value", "Environment variable value")),
            ]),
            Spec::new("unset", "Unset service configuration")
                .params(&[Param::Arg(arg("key", KEY)), Param::Arg(optional("name", "Environment variable name"))]),
        ]),
        Spec::new("reload", "Reload configuration").globals(SERVER_FLAGS),
        Spec::new("pair", "Print one-time links to connect a browser or app").params(&[
            Param::Flag(string("url", "Use an external HTTP(S) server URL in pairing links").check(Check::PairingUrl)),
            Param::Flag(boolean(
                "remote",
                "Pair through the OpenTunnel remote address, enabling remote access if needed (exposes the server to the internet)",
            )),
            Param::Flag(boolean(
                "yes",
                "Accept exposing the server to the internet when --remote enables remote access for the first time (required without an interactive terminal)",
            ).alias(&["y"])),
        ]),
        Spec::new("serve", "Start the v2 API and web server").params(&[
            Param::Flag(string("hostname", "")),
            Param::Flag(int("port", "")),
            Param::Flag(
                string("cors", "Additional allowed CORS origin (repeat for multiple origins)")
                    .check(Check::NonEmpty)
                    .count(Count::Repeated { min: Some(0), max: None, optional: false }),
            ),
            Param::Flag(boolean("service", "")),
            Param::Flag(boolean("stdio", "")),
        ]),
    ]);

macro_rules! choices {
    ($name:ident { $($variant:ident = $text:literal),* $(,)? }) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        pub enum $name {
            $($variant),*
        }

        impl $name {
            pub const CHOICES: &'static [&'static str] = &[$($text),*];

            pub fn from_choice(text: &str) -> $name {
                match text {
                    $($text => $name::$variant,)*
                    _ => unreachable!("the parser accepts only {:?}", $name::CHOICES),
                }
            }
        }
    };
}

choices!(PathName {
    Db = "db",
    Home = "home",
    Data = "data",
    Config = "config",
    Cache = "cache",
    State = "state",
    Tmp = "tmp",
    Bin = "bin",
    Log = "log",
    Repos = "repos",
});
choices!(OutputFormat { Default = "default", Json = "json" });
choices!(SessionListFormat { Table = "table", Json = "json" });
choices!(Shell { Bash = "bash", Zsh = "zsh", Fish = "fish", Powershell = "powershell", Sh = "sh", Pwsh = "pwsh" });
choices!(LogLevel {
    All = "all",
    Trace = "trace",
    Debug = "debug",
    Info = "info",
    Warn = "warn",
    Warning = "warning",
    Error = "error",
    Fatal = "fatal",
    None = "none",
});

/// The parsed command line a handler runs with.
#[derive(Debug)]
pub struct Cli {
    pub root: RootArgs,
    pub global: GlobalArgs,
    pub command: Option<Command>,
}

/// The global settings every command accepts: Effect CLI's `--log-level` and `--print-logs`.
#[derive(Debug, Clone, Default)]
pub struct GlobalArgs {
    pub log_level: Option<LogLevel>,
    pub print_logs: bool,
}

#[derive(Debug, Clone, Default)]
pub struct RootArgs {
    pub standalone: bool,
    pub server: Option<String>,
    pub permissions: PermissionFlags,
    pub directory: Option<String>,
    pub continue_: bool,
    pub session: Option<String>,
    pub prompt: Option<String>,
}

/// `--standalone` and `--server` on a command that declares them; they apply to its subcommands too.
#[derive(Debug, Clone, Default)]
pub struct ServerFlags {
    pub standalone: bool,
    pub server: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct PermissionFlags {
    pub auto: bool,
    pub yolo: bool,
    pub dangerously_skip_permissions: bool,
}

impl PermissionFlags {
    /// `--yolo` and `--dangerously-skip-permissions` are hidden spellings of `--auto`.
    pub fn auto(&self) -> bool {
        self.auto || self.yolo || self.dangerously_skip_permissions
    }
}

#[derive(Debug)]
pub enum Command {
    Upgrade(UpgradeArgs),
    Uninstall(UninstallArgs),
    Acp(AcpArgs),
    Api(ApiArgs),
    Debug(DebugArgs),
    Auth(AuthArgs),
    Mcp(McpArgs),
    Plugin(PluginArgs),
    Models,
    Stats(StatsArgs),
    Mini(MiniArgs),
    Run(RunArgs),
    Session(SessionArgs),
    Service(ServiceArgs),
    Reload,
    Pair(PairArgs),
    Serve(ServeArgs),
}

// `upgrade`, `uninstall`, `plugin`, and `serve` run the TypeScript CLI with the process arguments, which parses
// them again.
#[derive(Debug)]
pub struct UpgradeArgs;

#[derive(Debug)]
pub struct UninstallArgs;

#[derive(Debug)]
pub struct AcpArgs {
    pub login: bool,
}

#[derive(Debug)]
pub struct ApiArgs {
    pub request: Vec<String>,
    pub data: Option<String>,
    pub header: Vec<String>,
    pub param: Vec<(String, String)>,
}

#[derive(Debug)]
pub struct DebugArgs {
    pub command: Option<DebugCommand>,
}

#[derive(Debug)]
pub enum DebugCommand {
    Agents,
    Config,
    HeapDump(HeapDumpArgs),
    Paths(PathsArgs),
}

#[derive(Debug)]
pub struct HeapDumpArgs {
    pub directory: Option<String>,
}

#[derive(Debug)]
pub struct PathsArgs {
    pub name: Option<PathName>,
}

#[derive(Debug)]
pub struct AuthArgs {
    pub command: Option<AuthCommand>,
}

#[derive(Debug)]
pub enum AuthCommand {
    List(AuthListArgs),
    Login(AuthLoginArgs),
    Logout(AuthAccountArgs),
    Export(AuthExportArgs),
    Import(AuthImportArgs),
    Switch(AuthAccountArgs),
}

#[derive(Debug)]
pub struct AuthListArgs {
    pub format: OutputFormat,
}

#[derive(Debug)]
pub struct AuthLoginArgs {
    pub target: Option<String>,
    pub method: Option<String>,
    pub answer: Vec<String>,
}

/// `auth logout` and `auth switch`.
#[derive(Debug)]
pub struct AuthAccountArgs {
    pub target: Option<String>,
    pub credential: Option<String>,
}

#[derive(Debug)]
pub struct AuthExportArgs {
    pub target: Option<String>,
}

#[derive(Debug)]
pub struct AuthImportArgs {
    pub file: Option<String>,
}

#[derive(Debug)]
pub struct McpArgs {
    pub command: Option<McpCommand>,
}

#[derive(Debug)]
pub enum McpCommand {
    List,
    Add(McpAddArgs),
    Auth(McpAuthArgs),
    Logout(McpLogoutArgs),
}

#[derive(Debug)]
pub struct McpAddArgs {
    pub name: String,
    pub command: Vec<String>,
    pub url: Option<String>,
    pub header: Vec<(String, String)>,
    pub env: Vec<(String, String)>,
    pub global: bool,
}

#[derive(Debug)]
pub struct McpAuthArgs {
    pub name: Option<String>,
}

#[derive(Debug)]
pub struct McpLogoutArgs {
    pub name: String,
}

#[derive(Debug)]
pub struct PluginArgs {
    pub command: Option<PluginCommand>,
}

#[derive(Debug)]
pub enum PluginCommand {
    List,
    Add,
    Check,
    Update,
    Remove,
}

#[derive(Debug)]
pub struct StatsArgs {
    pub days: Option<u32>,
    pub year: Option<u16>,
    pub all: bool,
    pub project: Option<String>,
    pub models: bool,
    pub tools: bool,
    pub cost: bool,
    pub full: bool,
    pub limit: u32,
    pub json: bool,
}

#[derive(Debug)]
pub struct MiniArgs {
    pub continue_: bool,
    pub session: Option<String>,
    pub fork: bool,
    pub replay: bool,
    pub no_replay: bool,
    pub replay_limit: Option<i64>,
    pub model: Option<String>,
    pub agent: Option<String>,
    pub prompt: Option<String>,
}

impl MiniArgs {
    pub fn replay(&self) -> Option<bool> {
        match (self.replay, self.no_replay) {
            (true, _) => Some(true),
            (_, true) => Some(false),
            _ => None,
        }
    }
}

#[derive(Debug)]
pub struct RunArgs {
    pub message: Vec<String>,
    pub continue_: bool,
    pub session: Option<String>,
    pub fork: bool,
    /// `Some("")` for `-w` without a name.
    pub worktree: Option<String>,
    pub model: Option<String>,
    pub agent: Option<String>,
    pub format: OutputFormat,
    pub file: Vec<String>,
    pub title: Option<String>,
    pub archived: bool,
    pub thinking: bool,
    pub permissions: PermissionFlags,
}

impl RunArgs {
    /// `None` without `-w`; `Some(None)` for `-w` without a name.
    pub fn worktree(&self) -> Option<Option<&str>> {
        self.worktree.as_deref().map(|name| Some(name).filter(|name| !name.is_empty()))
    }
}

#[derive(Debug)]
pub struct SessionArgs {
    pub command: Option<SessionCommand>,
}

#[derive(Debug)]
pub enum SessionCommand {
    List(SessionListArgs),
    Delete(SessionDeleteArgs),
    Export(SessionExportArgs),
    Import(SessionImportArgs),
}

#[derive(Debug)]
pub struct SessionListArgs {
    pub max_count: Option<u32>,
    pub format: SessionListFormat,
}

#[derive(Debug)]
pub struct SessionDeleteArgs {
    pub session_id: String,
}

#[derive(Debug)]
pub struct SessionExportArgs {
    pub session: Option<String>,
    pub sanitize: bool,
}

#[derive(Debug)]
pub struct SessionImportArgs {
    pub file: String,
    pub directory: Option<String>,
}

#[derive(Debug)]
pub struct ServiceArgs {
    pub command: Option<ServiceCommand>,
}

#[derive(Debug)]
pub enum ServiceCommand {
    Start,
    Restart,
    Status,
    Stop,
    Get(ServiceGetArgs),
    Set(ServiceSetArgs),
    Unset(ServiceUnsetArgs),
}

#[derive(Debug)]
pub struct ServiceGetArgs {
    pub key: Option<String>,
    pub name: Option<String>,
}

#[derive(Debug)]
pub struct ServiceSetArgs {
    pub key: String,
    pub value: String,
    pub env_value: Option<String>,
}

#[derive(Debug)]
pub struct ServiceUnsetArgs {
    pub key: String,
    pub name: Option<String>,
}

#[derive(Debug)]
pub struct PairArgs {
    pub url: Option<String>,
    pub remote: bool,
    pub yes: bool,
}

#[derive(Debug)]
pub struct ServeArgs;

impl GlobalArgs {
    /// The settings from the values `parse` checked.
    pub fn from_values(values: &mut Values) -> GlobalArgs {
        GlobalArgs {
            log_level: values.string("log-level").map(|level| LogLevel::from_choice(&level)),
            print_logs: values.flag("print-logs"),
        }
    }
}

impl Cli {
    /// The typed arguments of the command at `path` (names below the root), from the values `parse` checked
    /// against its params.
    pub fn new(path: &[&str], values: &mut Values, global: GlobalArgs) -> Cli {
        let root = match path {
            [] => RootArgs {
                standalone: values.flag("standalone"),
                server: values.string("server"),
                permissions: permissions(values),
                directory: values.string("directory"),
                continue_: values.flag("continue"),
                session: values.string("session"),
                prompt: values.string("prompt"),
            },
            _ => RootArgs::default(),
        };
        Cli { root, global, command: command(path, values) }
    }
}

fn permissions(values: &mut Values) -> PermissionFlags {
    PermissionFlags {
        auto: values.flag("auto"),
        yolo: values.flag("yolo"),
        dangerously_skip_permissions: values.flag("dangerously-skip-permissions"),
    }
}

fn command(path: &[&str], v: &mut Values) -> Option<Command> {
    Some(match path {
        [] => return None,
        ["upgrade"] => Command::Upgrade(UpgradeArgs),
        ["uninstall"] => Command::Uninstall(UninstallArgs),
        ["acp"] => Command::Acp(AcpArgs { login: v.flag("login") }),
        ["api"] => Command::Api(ApiArgs {
            request: v.list("operation | method path"),
            data: v.string("data"),
            header: v.list("header"),
            param: v.pairs("param"),
        }),
        ["debug", rest @ ..] => Command::Debug(DebugArgs {
            command: match rest {
                [] => None,
                ["agents"] => Some(DebugCommand::Agents),
                ["config"] => Some(DebugCommand::Config),
                ["heap-dump"] => Some(DebugCommand::HeapDump(HeapDumpArgs { directory: v.string("directory") })),
                _ => Some(DebugCommand::Paths(PathsArgs {
                    name: v.string("name").map(|name| PathName::from_choice(&name)),
                })),
            },
        }),
        ["auth", rest @ ..] => Command::Auth(AuthArgs {
            command: match rest {
                [] => None,
                ["list"] => {
                    Some(AuthCommand::List(AuthListArgs { format: OutputFormat::from_choice(&v.text("format")) }))
                }
                ["login"] => Some(AuthCommand::Login(AuthLoginArgs {
                    target: v.string("target"),
                    method: v.string("method"),
                    answer: v.list("answer"),
                })),
                ["logout"] => Some(AuthCommand::Logout(account(v))),
                ["export"] => Some(AuthCommand::Export(AuthExportArgs { target: v.string("target") })),
                ["import"] => Some(AuthCommand::Import(AuthImportArgs { file: v.string("file") })),
                _ => Some(AuthCommand::Switch(account(v))),
            },
        }),
        ["mcp", rest @ ..] => Command::Mcp(McpArgs {
            command: match rest {
                [] => None,
                ["list"] => Some(McpCommand::List),
                ["add"] => Some(McpCommand::Add(McpAddArgs {
                    name: v.text("name"),
                    command: v.list("command"),
                    url: v.string("url"),
                    header: v.pairs("header"),
                    env: v.pairs("env"),
                    global: v.flag("global"),
                })),
                ["auth"] => Some(McpCommand::Auth(McpAuthArgs { name: v.string("name") })),
                _ => Some(McpCommand::Logout(McpLogoutArgs { name: v.text("name") })),
            },
        }),
        ["plugin", rest @ ..] => Command::Plugin(PluginArgs {
            command: match rest {
                [] => None,
                ["list"] => Some(PluginCommand::List),
                ["add"] => Some(PluginCommand::Add),
                ["check"] => Some(PluginCommand::Check),
                ["update"] => Some(PluginCommand::Update),
                _ => Some(PluginCommand::Remove),
            },
        }),
        ["models"] => Command::Models,
        ["stats"] => Command::Stats(StatsArgs {
            days: v.int("days").map(saturate),
            year: v.int("year").map(saturate),
            all: v.flag("all"),
            project: v.string("project"),
            models: v.flag("models"),
            tools: v.flag("tools"),
            cost: v.flag("cost"),
            full: v.flag("full"),
            limit: v.int("limit").map_or(5, saturate),
            json: v.flag("json"),
        }),
        ["mini"] => {
            let replay = v.optional_flag("replay");
            Command::Mini(MiniArgs {
                continue_: v.flag("continue"),
                session: v.string("session"),
                fork: v.flag("fork"),
                replay: replay == Some(true),
                no_replay: replay == Some(false),
                replay_limit: v.int("replay-limit"),
                model: v.string("model"),
                agent: v.string("agent"),
                prompt: v.string("prompt"),
            })
        }
        ["run"] => Command::Run(RunArgs {
            message: v.list("message"),
            continue_: v.flag("continue"),
            session: v.string("session"),
            fork: v.flag("fork"),
            worktree: v.string("worktree"),
            model: v.string("model"),
            agent: v.string("agent"),
            format: OutputFormat::from_choice(&v.text("format")),
            file: v.list("file"),
            title: v.string("title"),
            archived: v.flag("archived"),
            thinking: v.flag("thinking"),
            permissions: permissions(v),
        }),
        ["session", rest @ ..] => Command::Session(SessionArgs {
            command: match rest {
                [] => None,
                ["list"] => Some(SessionCommand::List(SessionListArgs {
                    max_count: v.int("max-count").map(saturate),
                    format: SessionListFormat::from_choice(&v.text("format")),
                })),
                ["delete"] => Some(SessionCommand::Delete(SessionDeleteArgs { session_id: v.text("sessionID") })),
                ["export"] => Some(SessionCommand::Export(SessionExportArgs {
                    session: v.string("session"),
                    sanitize: v.flag("sanitize"),
                })),
                _ => Some(SessionCommand::Import(SessionImportArgs {
                    file: v.text("file"),
                    directory: v.string("directory"),
                })),
            },
        }),
        ["service", rest @ ..] => Command::Service(ServiceArgs {
            command: match rest {
                [] => None,
                ["start"] => Some(ServiceCommand::Start),
                ["restart"] => Some(ServiceCommand::Restart),
                ["status"] => Some(ServiceCommand::Status),
                ["stop"] => Some(ServiceCommand::Stop),
                ["get"] => Some(ServiceCommand::Get(ServiceGetArgs { key: v.string("key"), name: v.string("name") })),
                ["set"] => Some(ServiceCommand::Set(ServiceSetArgs {
                    key: v.text("key"),
                    value: v.text("value"),
                    env_value: v.string("env-value"),
                })),
                _ => Some(ServiceCommand::Unset(ServiceUnsetArgs { key: v.text("key"), name: v.string("name") })),
            },
        }),
        ["reload"] => Command::Reload,
        ["pair"] => Command::Pair(PairArgs { url: v.string("url"), remote: v.flag("remote"), yes: v.flag("yes") }),
        _ => Command::Serve(ServeArgs),
    })
}

fn account(values: &mut Values) -> AuthAccountArgs {
    AuthAccountArgs { target: values.string("target"), credential: values.string("credential") }
}

// The checks keep these in range except beyond `u32::MAX` days or rows, which mean the same as the maximum.
fn saturate<T: TryFrom<i64> + Bounded>(value: i64) -> T {
    T::try_from(value).unwrap_or(T::MAX)
}

trait Bounded {
    const MAX: Self;
}

impl Bounded for u32 {
    const MAX: u32 = u32::MAX;
}

impl Bounded for u16 {
    const MAX: u16 = u16::MAX;
}
