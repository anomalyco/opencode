//! `upgrade` (alias `update`), delegated to the TypeScript CLI (D.1).

use opencode_service::delegate;
use opencode_util::error;

use super::Context;
use crate::args::UpgradeArgs;
use crate::help::VERSION;

pub fn run(_context: &Context, _args: &UpgradeArgs) -> error::Result<()> {
    // `opencode upgrade` would update a TypeScript install, not this build (deviation D01-preview-upgrade).
    if let Some(message) = preview_message(VERSION) {
        eprint!("{message}");
        return Err(crate::output::Exit(1).into());
    }
    // The TypeScript binary replaces this process, so this process's queued records go first. It is the one bundled
    // beside this binary when there is one, whose `upgrade` replaces both.
    crate::telemetry::flush();
    Err(delegate::forward().into())
}

/// What `upgrade` prints instead of delegating, for a preview build (`0.0.0-native-<run>`), which bundles its server.
pub(crate) fn preview_message(version: &str) -> Option<&'static str> {
    version.starts_with("0.0.0-native-").then_some(
        "This is an OpenCode native CLI preview build; re-run the install script to update it and its bundled server.\n\
         `opencode upgrade` updates a separate TypeScript install, not this one.\n",
    )
}

#[cfg(test)]
mod tests {
    use super::preview_message;

    #[test]
    fn preview_builds_do_not_delegate() {
        assert_eq!(
            preview_message("0.0.0-native-12"),
            Some(
                "This is an OpenCode native CLI preview build; re-run the install script to update it and its bundled server.\n\
                 `opencode upgrade` updates a separate TypeScript install, not this one.\n"
            )
        );
        for version in ["local", "2.2.7", "0.0.0-dev-1229", "0.0.0-native"] {
            assert_eq!(preview_message(version), None, "{version}");
        }
    }
}
