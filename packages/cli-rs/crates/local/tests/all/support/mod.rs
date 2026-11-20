//! What the oracle-driven tests share: the TypeScript checkout and the `bun` command that runs an oracle in it.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

pub fn ts_root() -> PathBuf {
    std::env::var_os("OPENCODE_TS_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../..").canonicalize().unwrap())
}

pub fn available() -> bool {
    let present = ts_root().join("node_modules").is_dir() && Command::new("bun").arg("--version").output().is_ok();
    if !present {
        assert!(
            std::env::var_os("OPENCODE_RS_REQUIRE_TS").is_none(),
            "OPENCODE_RS_REQUIRE_TS is set, but skipped: needs bun and {}/node_modules; set OPENCODE_TS_ROOT",
            ts_root().display()
        );
        eprintln!("skipped: needs bun and {}/node_modules; set OPENCODE_TS_ROOT", ts_root().display());
    }
    present
}

/// `parity/oracle/<script>` with `args`, run from the TypeScript CLI package with piped standard streams.
pub fn bun(script: &str, args: &[&str]) -> Command {
    let mut command = Command::new("bun");
    command
        .arg("--cwd")
        .arg(ts_root().join("packages/cli"))
        .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../parity/oracle").join(script))
        .arg(ts_root())
        .args(args)
        // Keep Bun's transpiler cache out of the temporary homes and warm across runs.
        .env("BUN_RUNTIME_TRANSPILER_CACHE_PATH", std::env::temp_dir().join("opencode-rs-f5-bun-cache"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command
}
