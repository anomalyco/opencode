//! TypeScript binary resolution: `OPENCODE_TS_BIN`, else `opencode` (F.9).
//!
//! The Rust client is not a server (user Q2). It starts the TypeScript `opencode` for the background
//! service and the standalone server, as the TypeScript client runs `selfCommand()`
//! (`packages/cli/src/services/service-config.ts:150`, `standalone.ts:18-20`).

use std::ffi::OsString;

/// The program that runs the TypeScript CLI, with the arguments that come before a command.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TsCommand {
    pub program: OsString,
    pub args: Vec<OsString>,
}

impl TsCommand {
    /// The variable that names the TypeScript binary.
    pub const VAR: &str = "OPENCODE_TS_BIN";

    pub fn from_env() -> Self {
        Self::from_vars(|name| std::env::var_os(name))
    }

    /// `OPENCODE_TS_BIN` (one executable path; an empty value counts as unset), else `opencode`,
    /// found on `PATH` when it runs.
    pub fn from_vars(var: impl Fn(&str) -> Option<OsString>) -> Self {
        Self::new(
            var(Self::VAR)
                .filter(|program| !program.is_empty())
                .unwrap_or_else(|| "opencode".into()),
        )
    }

    pub fn new(program: impl Into<OsString>) -> Self {
        Self {
            program: program.into(),
            args: Vec::new(),
        }
    }

    /// `opencode serve --service`.
    pub fn service(&self) -> Vec<OsString> {
        self.with(&["serve", "--service"])
    }

    /// `opencode serve --stdio --port 0`.
    pub fn standalone(&self) -> Vec<OsString> {
        self.with(&["serve", "--stdio", "--port", "0"])
    }

    /// The program, its leading arguments, then `args`.
    pub fn with(&self, args: &[&str]) -> Vec<OsString> {
        [self.program.clone()]
            .into_iter()
            .chain(self.args.iter().cloned())
            .chain(args.iter().map(OsString::from))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_variable_wins_and_empty_means_unset() {
        let from = |value: Option<&str>| {
            TsCommand::from_vars(|name| {
                assert_eq!(name, "OPENCODE_TS_BIN");
                value.map(OsString::from)
            })
        };
        assert_eq!(from(None).program, "opencode");
        assert_eq!(from(Some("")).program, "opencode");
        assert_eq!(from(Some("/x/opencode")).program, "/x/opencode");
        let mut command = TsCommand::new("bun");
        command.args.push("cli.ts".into());
        assert_eq!(command.service(), ["bun", "cli.ts", "serve", "--service"]);
        assert_eq!(
            command.standalone(),
            ["bun", "cli.ts", "serve", "--stdio", "--port", "0"]
        );
    }
}
