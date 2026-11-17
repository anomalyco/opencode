//! `upgrade` (alias `update`): it never delegates and upgrades nothing (deviation D01-upgrade). It says on stderr how
//! this binary is updated, and exits 1:
//!
//! - a preview build (`0.0.0-native-<run>`): re-run the preview's install script;
//! - an `opencode` bundled beside it: it is updated with that `opencode`, so run `opencode upgrade`. Running that from
//!   here would be the client asking the server binary to replace the client, which Windows cannot do to a running
//!   `opencode-native.exe`;
//! - a source build (`local`): rebuild it;
//! - any other build: it has no updater, and is updated the way it was installed.
//!
//! An `opencode` on `PATH` or named by `OPENCODE_TS_BIN` is a separate TypeScript install; those lookups only start a
//! server.

use std::path::Path;

use opencode_util::error;

use super::Context;
use crate::args::UpgradeArgs;
use crate::help::VERSION;

pub fn run(_context: &Context, _args: &UpgradeArgs) -> error::Result<()> {
    eprint!("{}", message(VERSION, opencode_util::bundle::server().as_deref()));
    Err(crate::output::Exit(1).into())
}

/// What `upgrade` says in a build of `version`, with `bundled` the `opencode` installed beside it.
fn message(version: &str, bundled: Option<&Path>) -> String {
    const SEPARATE: &str = "`opencode upgrade` updates a separate TypeScript install, not this one.\n";
    if version.starts_with("0.0.0-native-") {
        return format!(
            "This is an OpenCode native CLI preview build; re-run the install script to update it and its bundled \
             server.\n{SEPARATE}"
        );
    }
    if let Some(bundled) = bundled {
        return format!(
            "This opencode-native is updated with the opencode installed beside it ({}): run `opencode upgrade`.\n",
            bundled.display()
        );
    }
    if version == "local" {
        return format!("This opencode-native is a source build; rebuild it to update it.\n{SEPARATE}");
    }
    format!("This opencode-native has no updater; update it the way you installed it.\n{SEPARATE}")
}

#[cfg(test)]
mod tests {
    use super::*;

    // Expected (native-upgrade): `upgrade` upgrades nothing and says, for the install it detects, how this binary is
    // updated. A preview build is sent to its install script, bundled or not; a bundled `opencode` beside any other
    // build is the one to upgrade; a source build without one is rebuilt; anything else has no updater. An `opencode`
    // on `PATH` or in `OPENCODE_TS_BIN` is not an input.
    #[test]
    fn upgrade_says_how_this_install_is_updated() {
        const SEPARATE: &str = "`opencode upgrade` updates a separate TypeScript install, not this one.\n";
        let preview = format!(
            "This is an OpenCode native CLI preview build; re-run the install script to update it and its bundled \
             server.\n{SEPARATE}"
        );
        let bundled = Path::new("/opt/opencode/opencode");
        let beside = "This opencode-native is updated with the opencode installed beside it (/opt/opencode/opencode): \
                      run `opencode upgrade`.\n";
        let source = format!("This opencode-native is a source build; rebuild it to update it.\n{SEPARATE}");
        let none = format!("This opencode-native has no updater; update it the way you installed it.\n{SEPARATE}");
        let rows: &[(&str, Option<&Path>, &str)] = &[
            ("0.0.0-native-12", Some(bundled), &preview),
            ("0.0.0-native-12", None, &preview),
            ("2.4.0", Some(bundled), beside),
            ("local", Some(bundled), beside),
            ("local", None, &source),
            ("2.4.0", None, &none),
            ("0.0.0-native", None, &none),
        ];
        for (version, bundled, expected) in rows {
            assert_eq!(message(version, *bundled), *expected, "{version} {bundled:?}");
        }
    }
}
