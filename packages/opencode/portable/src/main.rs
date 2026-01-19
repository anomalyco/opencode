use std::fs::{self, File};
use std::io::Write;
use std::os::unix::fs::{symlink, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};
use tempfile::TempDir;

const EXE: &str = "opencode";
const PATCHELF: &str = "patchelf";
#[cfg(target_arch = "x86_64")]
const LIBC_MUSL: &str = "libc.musl-x86_64.so.1";
#[cfg(target_arch = "aarch64")]
const LIBC_MUSL: &str = "libc.musl-aarch64.so.1";
#[cfg(target_arch = "x86_64")]
const LD_MUSL: &str = "ld-musl-x86_64.so.1";
#[cfg(target_arch = "aarch64")]
const LD_MUSL: &str = "ld-musl-aarch64.so.1";
const LIBSTDCPP: &str = "libstdc++.so.6";
const LIBGCC: &str = "libgcc_s.so.1";

// Embed the files at compile time
static EMBEDDED_EXE: &[u8] = include_bytes!(concat!("../embedded/", "opencode"));
static EMBEDDED_PATCHELF: &[u8] = include_bytes!(concat!("../embedded/", "patchelf"));
#[cfg(target_arch = "x86_64")]
static EMBEDDED_LIBC_MUSL: &[u8] = include_bytes!(concat!("../embedded/", "libc.musl-x86_64.so.1"));
#[cfg(target_arch = "aarch64")]
static EMBEDDED_LIBC_MUSL: &[u8] = include_bytes!(concat!("../embedded/", "libc.musl-aarch64.so.1"));
static EMBEDDED_LIBSTDCPP: &[u8] = include_bytes!(concat!("../embedded/", "libstdc++.so.6"));
static EMBEDDED_LIBGCC: &[u8] = include_bytes!(concat!("../embedded/", "libgcc_s.so.1"));

fn main() -> std::process::ExitCode {
    // Create temporary directory with automatic cleanup
    let tmp_dir = match TempDir::with_prefix("opencode-tmp-") {
        Ok(dir) => dir,
        Err(e) => {
            eprintln!("Error: {}", e);
            return ExitCode::FAILURE;
        }
    };

    let result = (|| -> Result<ExitCode, Box<dyn std::error::Error>> {
        // Extract embedded files
        let exe_path = extract_file(tmp_dir.path(), EXE, EMBEDDED_EXE)?;
        let patchelf_path = extract_file(tmp_dir.path(), PATCHELF, EMBEDDED_PATCHELF)?;
        extract_file(tmp_dir.path(), LIBC_MUSL, EMBEDDED_LIBC_MUSL)?;
        extract_file(tmp_dir.path(), LIBSTDCPP, EMBEDDED_LIBSTDCPP)?;
        extract_file(tmp_dir.path(), LIBGCC, EMBEDDED_LIBGCC)?;

        // Create symlink for ld-musl (same as libc)
        let ld_path = tmp_dir.path().join(LD_MUSL);
        symlink(LIBC_MUSL, &ld_path)?;

        // Make executables executable (libraries don't need +x)
        set_executable(&exe_path)?;
        set_executable(&ld_path)?;
        set_executable(&patchelf_path)?;

        // Patch the ELF binary to use our embedded interpreter
        patch_elf(
            patchelf_path.to_str().ok_or("Invalid patchelf path")?,
            exe_path.to_str().ok_or("Invalid exe path")?,
            ld_path.to_str().ok_or("Invalid ld path")?,
        )?;

        // Collect command-line arguments (skip argv[0] which is this launcher)
        let args: Vec<String> = std::env::args().skip(1).collect();

        // Launch the embedded exe
        let mut child = Command::new(&exe_path).args(&args).spawn()?;

        // Wait for the child process to complete
        let status = child.wait()?;

        Ok(ExitCode::from(status.code().unwrap_or(1) as u8))
    })();

    match result {
        Ok(code) => code,
        Err(e) => {
            eprintln!("Error: {}", e);
            ExitCode::FAILURE
        }
    }
}

fn extract_file(
    dir: &Path,
    name: &str,
    data: &[u8],
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let path = dir.join(name);
    let mut file = File::create(&path)?;
    file.write_all(data)?;
    Ok(path)
}

fn set_executable(path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let mut perms = fs::metadata(path)?.permissions();
    perms.set_mode(0o755);
    fs::set_permissions(path, perms)?;
    Ok(())
}

fn patch_elf(
    patchelf_path: &str,
    elf_path: &str,
    ld_path: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let status = Command::new(ld_path)
        .arg(patchelf_path)
        .arg("--set-interpreter")
        .arg(ld_path)
        .arg(elf_path)
        .status()?;

    if status.success() {
        return Ok(());
    }

    Err("patchelf failed".into())
}
