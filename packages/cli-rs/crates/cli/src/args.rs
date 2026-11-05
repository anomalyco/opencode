//! The command tree of `packages/cli/src/commands/commands.ts`, with the same commands, flags, and descriptions.
//! `src/tests/tree.rs` proves it against a dump of the TypeScript tree. Effect CLI parses a few things differently
//! from clap; `normalize` and `validate` keep those behaviors (docs/C.0.md).

use std::collections::HashSet;
use std::ffi::OsString;

use clap::parser::ValueSource;
use clap::{ArgAction, ArgMatches, Args, Parser, Subcommand, ValueEnum};

#[derive(Parser, Debug)]
#[command(name = "opencode-rs", about = "OpenCode command line interface")]
pub struct Cli {
    #[command(flatten)]
    pub root: RootArgs,
    #[command(flatten)]
    pub global: GlobalArgs,
    #[command(subcommand)]
    pub command: Option<Command>,
}

/// The Effect CLI built-ins and `--print-logs`, accepted by every command.
#[derive(Args, Debug, Clone, Default)]
pub struct GlobalArgs {
    #[arg(short = 'h', long, global = true, action = ArgAction::Help, help = "Show help information")]
    pub help: Option<bool>,
    #[arg(short = 'v', long, global = true, help = "Show version information")]
    pub version: bool,
    #[arg(long, global = true, help = "Start wizard mode for a command")]
    pub wizard: bool,
    #[arg(long, global = true, value_name = "shell", help = "Print shell completion script")]
    pub completions: Option<Shell>,
    #[arg(long, global = true, value_name = "level", help = "Sets the minimum log level")]
    pub log_level: Option<LogLevel>,
    #[arg(long, global = true, help = "Print logs to stderr (server logs require --standalone)")]
    pub print_logs: bool,
}

#[derive(Args, Debug, Clone)]
pub struct RootArgs {
    // Own ids: clap copies the values of global args to every level by id, and `validate` must tell the
    // root's `--server` from that of the selected command.
    #[arg(id = "root_standalone", long = "standalone", help = STANDALONE)]
    pub standalone: bool,
    #[arg(id = "root_server", long = "server", value_name = "string", help = SERVER)]
    pub server: Option<String>,
    #[command(flatten)]
    pub permissions: PermissionFlags,
    #[arg(value_name = "directory", help = "Directory to start OpenCode in")]
    pub directory: Option<String>,
    #[arg(short = 'c', long = "continue", help = "Continue the last session")]
    pub continue_: bool,
    #[arg(short = 's', long, value_name = "string", help = SESSION)]
    pub session: Option<String>,
    #[arg(long, value_name = "string", help = "Prompt to use")]
    pub prompt: Option<String>,
}

const STANDALONE: &str = "Run with a private server instead of the background service";
const SERVER: &str = "Connect to a server URL instead of the background service";
const SESSION: &str = "Session ID to continue, or to create if it does not exist";

/// `--standalone` and `--server` on a command that declares them; they apply to its subcommands too.
#[derive(Args, Debug, Clone, Default)]
pub struct ServerFlags {
    #[arg(long, global = true, help = STANDALONE)]
    pub standalone: bool,
    #[arg(long, global = true, value_name = "string", help = SERVER)]
    pub server: Option<String>,
}

/// `debug heap-dump` takes `--server` without `--standalone`.
#[derive(Args, Debug, Clone, Default)]
pub struct ServerOnly {
    #[arg(long, global = true, value_name = "string", help = SERVER)]
    pub server: Option<String>,
}

#[derive(Args, Debug, Clone, Default)]
pub struct PermissionFlags {
    #[arg(long, help = "Auto-approve permissions that are not explicitly denied")]
    pub auto: bool,
    #[arg(long, hide = true)]
    pub yolo: bool,
    #[arg(long, hide = true)]
    pub dangerously_skip_permissions: bool,
}

impl PermissionFlags {
    /// `--yolo` and `--dangerously-skip-permissions` are hidden spellings of `--auto`.
    pub fn auto(&self) -> bool {
        self.auto || self.yolo || self.dangerously_skip_permissions
    }
}

#[derive(Subcommand, Debug)]
pub enum Command {
    #[command(about = "Upgrade OpenCode to the latest or a specific version", visible_alias = "update")]
    Upgrade(UpgradeArgs),
    #[command(about = "Uninstall OpenCode, keeping session data, configuration, and state")]
    Uninstall(UninstallArgs),
    #[command(about = "Start an Agent Client Protocol server")]
    Acp(AcpArgs),
    #[command(about = "Make a request to the running server")]
    Api(ApiArgs),
    #[command(about = "Debugging and troubleshooting tools")]
    Debug(DebugArgs),
    #[command(about = "manage integrations and credentials")]
    Auth(AuthArgs),
    #[command(about = "Manage MCP (Model Context Protocol) servers")]
    Mcp(McpArgs),
    #[command(about = "Manage plugins")]
    Plugin(PluginArgs),
    #[command(about = "List all available models")]
    Models(ServerArgs),
    #[command(about = "Show shareable usage statistics")]
    Stats(StatsArgs),
    #[command(about = "Start the minimal interactive interface")]
    Mini(MiniArgs),
    #[command(about = "Run OpenCode with a message")]
    Run(RunArgs),
    #[command(about = "Manage sessions")]
    Session(SessionArgs),
    #[command(about = "Manage the background server")]
    Service(ServiceArgs),
    #[command(about = "Reload configuration")]
    Reload(ServerArgs),
    #[command(about = "Print one-time links to connect a browser or app")]
    Pair(PairArgs),
    #[command(about = "Start the v2 API and web server")]
    Serve(ServeArgs),
}

/// A command whose only flags are `--standalone` and `--server`.
#[derive(Args, Debug, Clone, Default)]
pub struct ServerArgs {
    #[command(flatten)]
    pub server: ServerFlags,
}

#[derive(Args, Debug)]
pub struct UpgradeArgs {
    #[arg(value_name = "target", help = "Version to upgrade to (with or without a leading v)")]
    pub target: Option<String>,
    #[arg(short = 'm', long, value_name = "choice", help = "Installation method to use")]
    pub method: Option<UpgradeMethod>,
}

#[derive(ValueEnum, Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpgradeMethod {
    Curl,
    Npm,
    Pnpm,
    Bun,
    Yarn,
    Vp,
    Brew,
    Winget,
}

#[derive(Args, Debug)]
pub struct UninstallArgs {
    #[arg(long, help = "Show what would be removed without removing")]
    pub dry_run: bool,
    #[arg(short = 'f', long, help = "Skip confirmation prompts")]
    pub force: bool,
}

#[derive(Args, Debug)]
pub struct AcpArgs {
    #[arg(long, help = "Run auth login instead of starting the server")]
    pub login: bool,
}

#[derive(Args, Debug)]
pub struct ApiArgs {
    #[arg(
        value_name = "operation | method path",
        required = true,
        num_args = 1..=2,
        help = "OpenAPI operation ID, or an HTTP method followed by a path"
    )]
    pub request: Vec<String>,
    #[arg(short = 'd', long, value_name = "string", help = "Request body")]
    pub data: Option<String>,
    #[arg(short = 'H', long, value_name = "string", action = ArgAction::Append, help = "Request header in name:value form")]
    pub header: Vec<String>,
    #[arg(long, value_name = "key=value", action = ArgAction::Append, value_parser = key_value, help = "OpenAPI path or query parameter")]
    pub param: Vec<(String, String)>,
    #[command(flatten)]
    pub server: ServerFlags,
}

#[derive(Args, Debug)]
pub struct DebugArgs {
    #[command(subcommand)]
    pub command: Option<DebugCommand>,
}

#[derive(Subcommand, Debug)]
pub enum DebugCommand {
    #[command(about = "List all agents")]
    Agents(ServerArgs),
    #[command(about = "List configuration sources")]
    Config(ServerArgs),
    #[command(about = "Write a heap snapshot of the running server and print its path")]
    HeapDump(HeapDumpArgs),
    #[command(about = "Show global paths (data, config, cache, state)")]
    Paths(PathsArgs),
}

#[derive(Args, Debug)]
pub struct HeapDumpArgs {
    #[arg(
        long,
        value_name = "string",
        help = "Directory to write the snapshot into instead of the server's log directory"
    )]
    pub directory: Option<String>,
    #[command(flatten)]
    pub server: ServerOnly,
}

#[derive(Args, Debug)]
pub struct PathsArgs {
    #[arg(
        value_name = "name",
        help = "Print only one path: db, home, data, config, cache, state, tmp, bin, log, repos"
    )]
    pub name: Option<PathName>,
}

#[derive(ValueEnum, Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathName {
    Db,
    Home,
    Data,
    Config,
    Cache,
    State,
    Tmp,
    Bin,
    Log,
    Repos,
}

#[derive(Args, Debug)]
pub struct AuthArgs {
    #[command(subcommand)]
    pub command: Option<AuthCommand>,
    #[command(flatten)]
    pub server: ServerFlags,
}

#[derive(Subcommand, Debug)]
pub enum AuthCommand {
    #[command(about = "list integrations and credentials")]
    List(AuthListArgs),
    #[command(about = "connect an integration")]
    Login(AuthLoginArgs),
    #[command(about = "log out of a saved account")]
    Logout(AuthAccountArgs),
    #[command(about = "print stored credentials, including secrets, as JSON")]
    Export(AuthExportArgs),
    #[command(about = "import credentials exported by auth export")]
    Import(AuthImportArgs),
    #[command(about = "switch the active account for an integration")]
    Switch(AuthAccountArgs),
}

#[derive(Args, Debug)]
pub struct AuthListArgs {
    #[arg(long, value_name = "choice", default_value = "default", help = "Output format")]
    pub format: OutputFormat,
}

#[derive(ValueEnum, Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputFormat {
    Default,
    Json,
}

#[derive(Args, Debug)]
pub struct AuthLoginArgs {
    #[arg(value_name = "target", help = "Integration ID, name, or well-known provider URL")]
    pub target: Option<String>,
    #[arg(long, value_name = "string", help = "Authentication method ID")]
    pub method: Option<String>,
    #[arg(
        long,
        value_name = "string",
        action = ArgAction::Append,
        help = "Provider form answer (key=value; repeat for multiple fields)"
    )]
    pub answer: Vec<String>,
}

/// `auth logout` and `auth switch`.
#[derive(Args, Debug)]
pub struct AuthAccountArgs {
    #[arg(value_name = "target", help = "Integration ID or name")]
    pub target: Option<String>,
    #[arg(value_name = "credential", help = "Credential ID or label (opens an account picker when omitted)")]
    pub credential: Option<String>,
}

#[derive(Args, Debug)]
pub struct AuthExportArgs {
    #[arg(value_name = "target", help = "Integration ID or name (exports every integration when omitted)")]
    pub target: Option<String>,
}

#[derive(Args, Debug)]
pub struct AuthImportArgs {
    #[arg(value_name = "file", help = "JSON file to import (reads stdin when omitted)")]
    pub file: Option<String>,
}

#[derive(Args, Debug)]
pub struct McpArgs {
    #[command(subcommand)]
    pub command: Option<McpCommand>,
}

#[derive(Subcommand, Debug)]
pub enum McpCommand {
    #[command(about = "List configured MCP servers and their status")]
    List(ServerArgs),
    #[command(about = "Add an MCP server to your configuration")]
    Add(McpAddArgs),
    #[command(about = "Authenticate with an OAuth-capable remote MCP server")]
    Auth(McpAuthArgs),
    #[command(about = "Remove stored OAuth credentials for an MCP server")]
    Logout(McpLogoutArgs),
}

#[derive(Args, Debug)]
pub struct McpAddArgs {
    #[arg(value_name = "name", help = "Name of the MCP server")]
    pub name: String,
    #[arg(value_name = "command", help = "Command and arguments for a local server, passed after --")]
    pub command: Vec<String>,
    #[arg(long, value_name = "string", help = "URL for a remote MCP server")]
    pub url: Option<String>,
    #[arg(long, value_name = "key=value", action = ArgAction::Append, value_parser = key_value, help = "HTTP header for a remote server, as name=value")]
    pub header: Vec<(String, String)>,
    #[arg(long, value_name = "key=value", action = ArgAction::Append, value_parser = key_value, help = "Environment variable for a local server, as name=value")]
    pub env: Vec<(String, String)>,
    #[arg(long, help = "Write to the global config instead of the project config")]
    pub global: bool,
}

#[derive(Args, Debug)]
pub struct McpAuthArgs {
    #[arg(value_name = "name", help = "Name of the MCP server")]
    pub name: Option<String>,
    #[command(flatten)]
    pub server: ServerFlags,
}

#[derive(Args, Debug)]
pub struct McpLogoutArgs {
    #[arg(value_name = "name", help = "Name of the MCP server")]
    pub name: String,
    #[command(flatten)]
    pub server: ServerFlags,
}

#[derive(Args, Debug)]
pub struct PluginArgs {
    #[command(subcommand)]
    pub command: Option<PluginCommand>,
}

#[derive(Subcommand, Debug)]
pub enum PluginCommand {
    #[command(about = "List plugins")]
    List(PluginListArgs),
    #[command(about = "Install a plugin and add it to the global configuration")]
    Add(PluginAddArgs),
    #[command(about = "Check package plugins for updates")]
    Check(PluginCheckArgs),
    #[command(about = "Update package plugins")]
    Update(PluginUpdateArgs),
    #[command(about = "Remove a plugin from global configuration")]
    Remove(PluginRemoveArgs),
}

#[derive(Args, Debug)]
pub struct PluginListArgs {
    #[arg(long, help = "Include built-in server plugins")]
    pub builtin: bool,
    #[command(flatten)]
    pub server: ServerFlags,
}

#[derive(Args, Debug)]
pub struct PluginAddArgs {
    #[arg(value_name = "package", help = "npm registry or Git package specifier")]
    pub package: String,
}

#[derive(Args, Debug)]
pub struct PluginCheckArgs {
    #[arg(value_name = "target", help = "Configured package target")]
    pub target: Option<String>,
    #[command(flatten)]
    pub server: ServerFlags,
}

#[derive(Args, Debug)]
pub struct PluginUpdateArgs {
    #[arg(value_name = "target", help = "Configured package target; omit to update all outdated plugins")]
    pub target: Option<String>,
    #[command(flatten)]
    pub server: ServerFlags,
}

#[derive(Args, Debug)]
pub struct PluginRemoveArgs {
    #[arg(value_name = "package", help = "configured package specifier")]
    pub package: String,
}

#[derive(Args, Debug)]
pub struct StatsArgs {
    #[arg(long, value_name = "integer", value_parser = clap::value_parser!(u32), help = "Show the last N days; 0 means today")]
    pub days: Option<u32>,
    #[arg(long, value_name = "integer", value_parser = clap::value_parser!(u16).range(1970..=9999), help = "Show a calendar year")]
    pub year: Option<u16>,
    #[arg(long, help = "Show lifetime statistics")]
    pub all: bool,
    #[arg(long, value_name = "string", help = "Filter by project ID, or use \".\" for the current project")]
    pub project: Option<String>,
    #[arg(long, help = "Show model usage")]
    pub models: bool,
    #[arg(long, help = "Show tool reliability")]
    pub tools: bool,
    #[arg(long, help = "Show cost and token details")]
    pub cost: bool,
    #[arg(long, help = "Show every detailed section")]
    pub full: bool,
    #[arg(long, value_name = "integer", default_value = "5", value_parser = clap::value_parser!(u32).range(1..), help = "Number of rows in detailed sections")]
    pub limit: u32,
    #[arg(long, help = "Output statistics as JSON")]
    pub json: bool,
    #[command(flatten)]
    pub server: ServerFlags,
}

#[derive(Args, Debug)]
pub struct MiniArgs {
    #[arg(short = 'c', long = "continue", help = "Continue the last session")]
    pub continue_: bool,
    #[arg(short = 's', long, value_name = "string", help = SESSION)]
    pub session: Option<String>,
    #[arg(long, help = "Fork the session when continuing")]
    pub fork: bool,
    #[arg(long, help = "Restore session history on resume and resize (disable with --no-replay)")]
    pub replay: bool,
    // Set by `normalize` for `--no-replay` and `--replay=false`, so `replay()` can tell false from absent.
    #[arg(long = "no-replay", hide = true)]
    pub no_replay: bool,
    #[arg(long, value_name = "integer", help = "Limit replay to the newest N messages (default: 200)")]
    pub replay_limit: Option<i64>,
    #[arg(short = 'm', long, value_name = "string", help = "Model to use in the format provider/model")]
    pub model: Option<String>,
    #[arg(long, value_name = "string", help = "Agent to use")]
    pub agent: Option<String>,
    #[arg(long, value_name = "string", help = "Prompt to use")]
    pub prompt: Option<String>,
    #[arg(long, hide = true)]
    pub demo: bool,
    #[command(flatten)]
    pub server: ServerFlags,
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

#[derive(Args, Debug)]
pub struct RunArgs {
    #[arg(value_name = "message", help = "Message to send")]
    pub message: Vec<String>,
    #[arg(short = 'c', long = "continue", help = "Continue the last session")]
    pub continue_: bool,
    #[arg(short = 's', long, value_name = "string", help = SESSION)]
    pub session: Option<String>,
    #[arg(long, help = "Fork the session before continuing")]
    pub fork: bool,
    // A value only with `=`: `run -w "fix it"` keeps "fix it" as the message (framework/flag.ts:3-4).
    #[arg(
        short = 'w',
        long,
        value_name = "name",
        num_args = 0..=1,
        require_equals = true,
        default_missing_value = "",
        help = "Start a new session in a new git worktree, optionally with this name"
    )]
    pub worktree: Option<String>,
    #[arg(short = 'm', long, value_name = "string", help = "Model to use in the format provider/model#variant")]
    pub model: Option<String>,
    #[arg(long, value_name = "string", help = "Agent to use")]
    pub agent: Option<String>,
    #[arg(long, value_name = "choice", default_value = "default", help = "Output format")]
    pub format: OutputFormat,
    #[arg(short = 'f', long, value_name = "string", action = ArgAction::Append, help = "File to attach to the message")]
    pub file: Vec<String>,
    #[arg(long, value_name = "string", help = "Session title")]
    pub title: Option<String>,
    #[arg(
        long,
        help = "Create the session archived so it stays out of session lists (useful for scripted or CI runs)"
    )]
    pub archived: bool,
    #[arg(long, help = "Show thinking blocks")]
    pub thinking: bool,
    #[command(flatten)]
    pub permissions: PermissionFlags,
    #[command(flatten)]
    pub server: ServerFlags,
}

impl RunArgs {
    /// `None` without `-w`; `Some(None)` for `-w` without a name.
    pub fn worktree(&self) -> Option<Option<&str>> {
        self.worktree.as_deref().map(|name| Some(name).filter(|name| !name.is_empty()))
    }
}

#[derive(Args, Debug)]
pub struct SessionArgs {
    #[command(subcommand)]
    pub command: Option<SessionCommand>,
    #[command(flatten)]
    pub server: ServerFlags,
}

#[derive(Subcommand, Debug)]
pub enum SessionCommand {
    #[command(about = "List top-level sessions in the current project, newest first")]
    List(SessionListArgs),
    #[command(about = "Delete a session and its child sessions")]
    Delete(SessionDeleteArgs),
    #[command(about = "Export session data as JSON")]
    Export(SessionExportArgs),
    #[command(about = "Import session data from a JSON file or URL")]
    Import(SessionImportArgs),
}

#[derive(Args, Debug)]
pub struct SessionListArgs {
    #[arg(short = 'n', long, value_name = "integer", value_parser = clap::value_parser!(u32).range(1..), help = "Limit to N most recent sessions (default: 100)")]
    pub max_count: Option<u32>,
    #[arg(long, value_name = "choice", default_value = "table", help = "Output format")]
    pub format: SessionListFormat,
}

#[derive(ValueEnum, Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionListFormat {
    Table,
    Json,
}

#[derive(Args, Debug)]
pub struct SessionDeleteArgs {
    #[arg(value_name = "sessionID", help = "Session ID to delete")]
    pub session_id: String,
}

#[derive(Args, Debug)]
pub struct SessionExportArgs {
    #[arg(value_name = "session", help = "Session ID to export")]
    pub session: Option<String>,
    #[arg(long, help = "Redact sensitive transcript and file data")]
    pub sanitize: bool,
}

#[derive(Args, Debug)]
pub struct SessionImportArgs {
    #[arg(value_name = "file", help = "JSON file or URL to import")]
    pub file: String,
    #[arg(long, value_name = "string", help = "Directory in which to import the session")]
    pub directory: Option<String>,
}

#[derive(Args, Debug)]
pub struct ServiceArgs {
    #[command(subcommand)]
    pub command: Option<ServiceCommand>,
}

#[derive(Subcommand, Debug)]
pub enum ServiceCommand {
    #[command(about = "Start the background server")]
    Start,
    #[command(about = "Restart the background server")]
    Restart,
    #[command(about = "Show background server status")]
    Status,
    #[command(about = "Stop the background server")]
    Stop,
    #[command(about = "Get service configuration")]
    Get(ServiceGetArgs),
    #[command(about = "Set service configuration")]
    Set(ServiceSetArgs),
    #[command(about = "Unset service configuration")]
    Unset(ServiceUnsetArgs),
}

#[derive(Args, Debug)]
pub struct ServiceGetArgs {
    #[arg(value_name = "key", help = "Service setting or env")]
    pub key: Option<String>,
    #[arg(value_name = "name", help = "Environment variable name")]
    pub name: Option<String>,
}

#[derive(Args, Debug)]
pub struct ServiceSetArgs {
    #[arg(value_name = "key", help = "Service setting or env")]
    pub key: String,
    #[arg(value_name = "value", help = "Setting value or environment variable name")]
    pub value: String,
    #[arg(value_name = "env-value", help = "Environment variable value")]
    pub env_value: Option<String>,
}

#[derive(Args, Debug)]
pub struct ServiceUnsetArgs {
    #[arg(value_name = "key", help = "Service setting or env")]
    pub key: String,
    #[arg(value_name = "name", help = "Environment variable name")]
    pub name: Option<String>,
}

#[derive(Args, Debug)]
pub struct PairArgs {
    #[arg(long, value_name = "string", value_parser = pairing_url, help = "Use an external HTTP(S) server URL in pairing links")]
    pub url: Option<String>,
    #[arg(
        long,
        help = "Pair through the OpenTunnel remote address, enabling remote access if needed (exposes the server to the internet)"
    )]
    pub remote: bool,
    #[arg(
        short = 'y',
        long,
        help = "Accept exposing the server to the internet when --remote enables remote access for the first time (required without an interactive terminal)"
    )]
    pub yes: bool,
}

#[derive(Args, Debug)]
pub struct ServeArgs {
    #[arg(long, value_name = "string")]
    pub hostname: Option<String>,
    #[arg(long, value_name = "integer")]
    pub port: Option<i64>,
    #[arg(
        long,
        value_name = "string",
        action = ArgAction::Append,
        value_parser = clap::builder::NonEmptyStringValueParser::new(),
        help = "Additional allowed CORS origin (repeat for multiple origins)"
    )]
    pub cors: Vec<String>,
    #[arg(long)]
    pub service: bool,
    #[arg(long)]
    pub stdio: bool,
}

#[derive(ValueEnum, Debug, Clone, Copy, PartialEq, Eq)]
pub enum Shell {
    Bash,
    Zsh,
    Fish,
    Powershell,
    Sh,
    Pwsh,
}

#[derive(ValueEnum, Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogLevel {
    All,
    Trace,
    Debug,
    Info,
    Warn,
    Warning,
    Error,
    Fatal,
    None,
}

fn key_value(value: &str) -> Result<(String, String), String> {
    let Some((key, val)) = value.split_once('=') else {
        return Err(format!("Invalid key=value format. Expected format: key=value, got: {value}"));
    };
    if key.is_empty() || val.is_empty() {
        return Err(format!("Invalid key=value format. Both key and value must be non-empty. Got: {value}"));
    }
    Ok((key.to_string(), val.to_string()))
}

// commands.ts:551-561: an HTTP(S) URL without credentials, query, or fragment, without trailing slashes.
fn pairing_url(value: &str) -> Result<String, String> {
    let error = "Expected an HTTP(S) server URL without credentials, query parameters, or a fragment";
    let url = url::Url::parse(value).map_err(|_| error.to_string())?;
    let plain = matches!(url.scheme(), "http" | "https")
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none();
    if !plain {
        return Err(error.to_string());
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}

/// Rewrites Effect CLI boolean forms into ones clap accepts, walking the arguments with `command` (built, so
/// global flags are visible at every level) the way Effect's parser does: only the first word at each level
/// can name a subcommand, and everything after `--` is left alone.
///
/// - `--flag=<literal>`, `--flag <literal>` (`true yes on 1 y`, `false no off 0 n`) set the boolean.
/// - `--no-flag` sets it to false; a value after it is an error.
/// - A boolean given twice is an error, as Effect reports "at most 1 value".
/// - Short clusters split into single flags (`-cf` is `-c -f`), as Effect's lexer does.
///
/// A false boolean is dropped, or becomes the hidden `--no-<flag>` where the command has one.
pub fn normalize(command: &clap::Command, args: Vec<OsString>) -> Result<Vec<OsString>, String> {
    let mut input = args.into_iter();
    let mut out: Vec<OsString> = input.next().into_iter().collect();
    let mut tokens: Vec<OsString> = Vec::new();
    let mut rest: Vec<OsString> = Vec::new();
    for arg in input.by_ref() {
        if arg == "--" {
            rest.push(arg);
            break;
        }
        match arg.to_str().and_then(cluster) {
            Some(split) => tokens.extend(split.into_iter().map(OsString::from)),
            None => tokens.push(arg),
        }
    }
    rest.extend(input);

    let mut node = command;
    let mut first = true;
    let mut seen = HashSet::new();
    let mut tokens = tokens.into_iter().peekable();
    while let Some(token) = tokens.next() {
        let Some(text) = token.to_str().filter(|text| is_flag(text)) else {
            match token.to_str().and_then(|name| find_subcommand(node, name)) {
                Some(sub) if first => node = sub,
                _ => first = false,
            }
            out.push(token);
            continue;
        };
        let (name, value) = match text.split_once('=') {
            Some((name, value)) => (name, Some(value)),
            None => (text, None),
        };
        let negated = name.strip_prefix("--no-").and_then(|long| find_long(node, long).filter(|arg| is_bool(arg)));
        if let Some(arg) = negated {
            let literal = value.map(str::to_string).or_else(|| take_literal(&mut tokens));
            if let Some(literal) = literal {
                let long = arg.get_long().unwrap_or_default();
                return Err(format!(
                    "Invalid value for flag --{long}: \"{literal}\". Expected: omit the value and use {name} by itself to set --{long} to false"
                ));
            }
            record(&mut seen, arg)?;
            push_bool(&mut out, node, arg, false);
            continue;
        }
        let Some(arg) = find_flag(node, name) else {
            out.push(token);
            continue;
        };
        if is_bool(arg) {
            let literal = value.map(str::to_string).or_else(|| take_literal(&mut tokens));
            let enabled = match literal.as_deref() {
                None => true,
                Some(literal) => parse_bool(literal).ok_or_else(|| {
                    format!(
                        "Invalid value for flag --{}: \"{literal}\". Expected: boolean",
                        arg.get_long().unwrap_or_default()
                    )
                })?,
            };
            record(&mut seen, arg)?;
            push_bool(&mut out, node, arg, enabled);
            continue;
        }
        // A flag that takes the next word: keep that word out of subcommand detection.
        let takes_next = value.is_none()
            && !arg.is_require_equals_set()
            && arg.get_num_args().is_some_and(|range| range.min_values() > 0);
        out.push(token);
        if takes_next && let Some(next) = tokens.next_if(|next| next.to_str().is_none_or(|next| !is_flag(next))) {
            out.push(next);
        }
    }
    out.extend(rest);
    Ok(out)
}

// Effect's lexer: a word starting with `-` is a flag unless it is `-` alone or a negative number.
fn is_flag(text: &str) -> bool {
    text.len() > 1 && text.starts_with('-') && text != "--" && !text.starts_with("--=") && !is_negative_number(text)
}

// lexer.ts:49, `^-(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$`.
fn is_negative_number(text: &str) -> bool {
    let digits = |part: &str| part.chars().all(|char| char.is_ascii_digit());
    let number = &text[1..];
    let (mantissa, exponent) = match number.split_once(['e', 'E']) {
        Some((mantissa, exponent)) => (mantissa, Some(exponent)),
        None => (number, None),
    };
    let mantissa = match mantissa.split_once('.') {
        Some((int, frac)) => digits(int) && digits(frac) && !(int.is_empty() && frac.is_empty()),
        None => !mantissa.is_empty() && digits(mantissa),
    };
    let exponent = exponent.is_none_or(|exponent| {
        let exponent = exponent.strip_prefix(['+', '-']).unwrap_or(exponent);
        !exponent.is_empty() && digits(exponent)
    });
    mantissa && exponent
}

/// `-abc` is `-a -b -c`, and `-ab=v` is `-a -b=v`.
fn cluster(text: &str) -> Option<Vec<String>> {
    if !is_flag(text) || text.starts_with("--") {
        return None;
    }
    let (flags, value) = match text[1..].split_once('=') {
        Some((flags, value)) => (flags, Some(value)),
        None => (&text[1..], None),
    };
    if flags.chars().count() < 2 {
        return None;
    }
    let mut split: Vec<String> = flags.chars().map(|char| format!("-{char}")).collect();
    if let (Some(last), Some(value)) = (split.last_mut(), value) {
        last.push('=');
        last.push_str(value);
    }
    Some(split)
}

fn find_subcommand<'a>(node: &'a clap::Command, name: &str) -> Option<&'a clap::Command> {
    node.get_subcommands().find(|sub| sub.get_name() == name || sub.get_all_aliases().any(|alias| alias == name))
}

fn find_long<'a>(node: &'a clap::Command, long: &str) -> Option<&'a clap::Arg> {
    node.get_arguments().find(|arg| arg.get_long() == Some(long))
}

fn find_flag<'a>(node: &'a clap::Command, name: &str) -> Option<&'a clap::Arg> {
    if let Some(long) = name.strip_prefix("--") {
        return find_long(node, long);
    }
    let mut chars = name[1..].chars();
    let short = chars.next().filter(|_| chars.next().is_none())?;
    node.get_arguments().find(|arg| arg.get_short() == Some(short))
}

fn is_bool(arg: &clap::Arg) -> bool {
    matches!(arg.get_action(), ArgAction::SetTrue)
}

fn parse_bool(text: &str) -> Option<bool> {
    match text {
        "true" | "yes" | "on" | "1" | "y" => Some(true),
        "false" | "no" | "off" | "0" | "n" => Some(false),
        _ => None,
    }
}

fn take_literal(tokens: &mut std::iter::Peekable<impl Iterator<Item = OsString>>) -> Option<String> {
    tokens.next_if(|next| next.to_str().and_then(parse_bool).is_some()).and_then(|next| next.into_string().ok())
}

fn record(seen: &mut HashSet<String>, arg: &clap::Arg) -> Result<(), String> {
    let long = arg.get_long().unwrap_or_default();
    if seen.insert(long.to_string()) {
        return Ok(());
    }
    Err(format!("Invalid value for flag --{long}: \"2 occurrences\". Expected: at most 1 value"))
}

fn push_bool(out: &mut Vec<OsString>, node: &clap::Command, arg: &clap::Arg, enabled: bool) {
    let long = arg.get_long().unwrap_or_default();
    if enabled {
        out.push(format!("--{long}").into());
        return;
    }
    if find_long(node, &format!("no-{long}")).is_some() {
        out.push(format!("--no-{long}").into());
    }
}

/// The repeatable flags with `Flag.atMost(100)` in commands.ts, by command name and flag.
pub const AT_MOST_100: [(&str, &str); 3] = [("api", "header"), ("login", "answer"), ("run", "file")];

/// Checks Effect CLI rules clap does not know, after clap parsed `matches` of `command` (built). Returns the
/// `--standalone` and `--server` that apply to the selected command: the root's own, or those of the
/// command that declares them, which may be given before the subcommand (`opencode --server URL session list`).
pub fn validate(command: &clap::Command, matches: &ArgMatches) -> Result<ServerFlags, String> {
    let mut path = vec![command];
    let mut leaf = matches;
    while let Some((name, sub)) = leaf.subcommand() {
        path.push(path.last().and_then(|node| node.find_subcommand(name)).expect("clap matched it"));
        leaf = sub;
    }
    let names: Vec<&str> = path.iter().map(|node| node.get_name()).collect();
    if path.len() == 1 {
        return Ok(ServerFlags {
            standalone: matches.get_flag("root_standalone"),
            server: matches.get_one::<String>("root_server").cloned(),
        });
    }
    let mut flags = ServerFlags {
        standalone: leaf.try_get_one::<bool>("standalone").ok().flatten().copied().unwrap_or(false),
        server: leaf.try_get_one::<String>("server").ok().flatten().cloned(),
    };
    let root_flags = command.get_arguments().filter(|arg| !arg.is_global_set() && !arg.is_positional());
    for arg in root_flags {
        let id = arg.get_id().as_str();
        if matches.value_source(id) != Some(ValueSource::CommandLine) {
            continue;
        }
        let long = arg.get_long().unwrap_or(id);
        // Effect CLI does not pass a command's own flags to its subcommands; only declared globals apply.
        if !matches!(long, "standalone" | "server") || leaf.try_contains_id(long).is_err() {
            return Err(format!("Unrecognized flag: --{long} in command {}", names.join(" ")));
        }
        if leaf.value_source(long) == Some(ValueSource::CommandLine) {
            return Err(format!("Invalid value for flag --{long}: \"2 occurrences\". Expected: at most 1 value"));
        }
        match long {
            "standalone" => flags.standalone = true,
            _ => flags.server = matches.get_one::<String>(id).cloned(),
        }
    }
    // Flag.atMost(100) in commands.ts.
    if let Some((_, id)) = AT_MOST_100.iter().find(|(name, _)| names.last() == Some(name)) {
        let count = leaf.get_raw_occurrences(id).map_or(0, |values| values.count());
        if count > 100 {
            return Err(format!(
                "Invalid value for flag --{id}: \"{count} occurrences\". Expected: at most 100 values"
            ));
        }
    }
    Ok(flags)
}
