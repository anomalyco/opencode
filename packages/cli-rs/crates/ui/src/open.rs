//! The system opener for URLs and paths, shared by the TUI and mini: what the `open` package runs for `openUrl` and
//! `openPath` (`packages/util/src/open.ts`).

use base64::Engine;
use std::process::Command;

/// A command that opens `target` in the system's default app. The caller sets stdio and spawns it.
pub fn command(target: &str) -> Command {
    let system_root = std::env::var("SYSTEMROOT").or_else(|_| std::env::var("windir")).ok();
    let (program, args) = opener(std::env::consts::OS, target, system_root.as_deref());
    let mut command = Command::new(program);
    // `open` detaches `xdg-open`, so a browser it starts does not stop with this client's group on Ctrl+Z.
    #[cfg(all(unix, not(target_os = "macos")))]
    std::os::unix::process::CommandExt::process_group(&mut command, 0);
    command.args(args);
    command
}

/// The program and arguments for `os`. On Windows, `open` runs PowerShell's `Start` on the target, single-quoted and
/// Base64-encoded, so no shell parses `&`, `|`, `^` or `%VAR%` in it.
fn opener(os: &str, target: &str, system_root: Option<&str>) -> (String, Vec<String>) {
    match os {
        "macos" => ("open".to_owned(), vec![target.to_owned()]),
        "windows" => {
            // `powerShellPath` and `executePowerShell` of `powershell-utils`.
            let root = system_root.unwrap_or(r"C:\Windows");
            let script = format!("$ProgressPreference = 'SilentlyContinue'; Start '{}'", target.replace('\'', "''"));
            let utf16: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
            let encoded = base64::engine::general_purpose::STANDARD.encode(utf16);
            let args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand"];
            let mut args: Vec<String> = args.iter().map(|arg| (*arg).to_owned()).collect();
            args.push(encoded);
            (format!(r"{root}\System32\WindowsPowerShell\v1.0\powershell.exe"), args)
        }
        _ => ("xdg-open".to_owned(), vec![target.to_owned()]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decode(encoded: &str) -> String {
        let bytes = base64::engine::general_purpose::STANDARD.decode(encoded).unwrap();
        let units: Vec<u16> = bytes.chunks(2).map(|pair| u16::from_le_bytes([pair[0], pair[1]])).collect();
        String::from_utf16(&units).unwrap()
    }

    #[test]
    fn unix_passes_the_target_as_one_argument() {
        assert_eq!(opener("linux", "a b&c", None), ("xdg-open".to_owned(), vec!["a b&c".to_owned()]));
        assert_eq!(opener("macos", "https://x.y", None), ("open".to_owned(), vec!["https://x.y".to_owned()]));
    }

    #[test]
    fn windows_starts_the_target_through_encoded_powershell() {
        let (program, args) = opener("windows", "https://opencode.ai", Some(r"D:\Win"));
        assert_eq!(program, r"D:\Win\System32\WindowsPowerShell\v1.0\powershell.exe");
        assert_eq!(args[..5], ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand"]);
        // The `open` package's encoding of the same command.
        assert_eq!(
            args[5],
            "JABQAHIAbwBnAHIAZQBzAHMAUAByAGUAZgBlAHIAZQBuAGMAZQAgAD0AIAAnAFMAaQBsAGUAbgB0AGwAeQBDAG8AbgB0AGkAbgB1AGUAJwA7ACAAUwB0AGEAcgB0ACAAJwBoAHQAdABwAHMAOgAvAC8AbwBwAGUAbgBjAG8AZABlAC4AYQBpACcA"
        );
        assert_eq!(opener("windows", "x", None).0, r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe");
    }

    #[test]
    fn windows_quotes_the_target_for_powershell() {
        let cases = [
            (r"C:\Users\A B\file.md", r"'C:\Users\A B\file.md'"),
            ("https://x.y/?a=1&b=2", "'https://x.y/?a=1&b=2'"),
            (r"C:\a^b\%TEMP%\c", r"'C:\a^b\%TEMP%\c'"),
            (r#"it's "here""#, r#"'it''s "here"'"#),
            ("$(calc)", "'$(calc)'"),
        ];
        for (target, quoted) in cases {
            let args = opener("windows", target, None).1;
            assert_eq!(args.len(), 6);
            assert_eq!(decode(&args[5]), format!("$ProgressPreference = 'SilentlyContinue'; Start {quoted}"));
        }
    }
}
