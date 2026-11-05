//! `mini`: the minimal interactive interface (`packages/tui/src/mini`). The app lives in a footer at the bottom
//! of the main screen, and the session's transcript is written to the terminal's scrollback above it.
//!
//! M.1 owns the shell: the split-footer lifecycle (`shell`), the scrollback writer (`scrollback`), the
//! transcript and its replay (`replay`), the theme and monochrome output (`theme`), piped stdin (`stdin`), and
//! signals and traces (`signals`). The prompt (`prompt`, M.2), the request footers (`footers`, M.3), and the
//! tool output, settings, spinners, splash, and variants (M.4) fill the stubs M.1 leaves.

use std::path::PathBuf;
use std::time::Instant;

use opencode_api::client::Client;
use opencode_local::cli_config::Info;
use opencode_store::target::TargetInput;

pub mod footers;
pub mod prompt;
pub mod replay;
pub mod scrollback;
pub mod settings;
pub mod shell;
pub mod signals;
pub mod spinners;
pub mod splash;
pub mod stdin;
pub mod theme;
pub mod tools;
pub mod variants;

/// What `opencode mini` runs with (`MiniCommandInput` after the handler resolved it).
pub struct Input {
    pub client: Client,
    /// The logical working directory.
    pub directory: String,
    /// The home directory, shown as `~` in the entry header.
    pub home: PathBuf,
    /// Directories custom themes are read from.
    pub theme_directories: Vec<PathBuf>,
    /// The session to open: `--continue`, `--session`, `--fork`, `--model`, `--agent`.
    pub target: TargetInput,
    /// Piped stdin and `--prompt`, sent as the first prompt.
    pub initial_input: Option<String>,
    /// `--replay`, else `mini.replay`, else true.
    pub replay: bool,
    /// `--replay-limit`, else `mini.replay_limit`.
    pub replay_limit: Option<u32>,
    pub config: Info,
    /// The global paths: `cli.json` for `/settings` and `model.json` for saved variants.
    pub paths: opencode_local::paths::Paths,
    pub version: String,
    pub trace: Option<signals::Trace>,
    /// When the command started, for `OPENCODE_SHOW_TTFD`.
    pub start: Instant,
}

/// A failure mini reports as `Error: <message>` and exit code 1 (`MiniInputError`).
#[derive(Debug)]
pub struct InputError(pub String);

impl std::fmt::Display for InputError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for InputError {}

/// Runs mini until the user leaves.
pub fn run(input: Input) -> anyhow::Result<()> {
    shell::run(input)
}
