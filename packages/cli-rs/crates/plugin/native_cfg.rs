//! `cfg(native)` for the crates with a `native` feature, shared by the build scripts of opencode-plugin, opencode-tui
//! and opencode-cli: the feature, except in a static musl build (Rust's default for musl), which has no dynamic loader
//! to open a plugin library with (O-188). Such a build compiles native plugins out, as one without the feature does.

pub fn emit() {
    println!("cargo::rustc-check-cfg=cfg(native)");
    if std::env::var_os("CARGO_FEATURE_NATIVE").is_some() && !static_musl() {
        println!("cargo::rustc-cfg=native");
    }
}

/// Whether the target links musl statically. `CARGO_CFG_TARGET_FEATURE` cannot tell: cargo reads the target's cfg with
/// every crate type, and with `proc-macro` among them rustc leaves `crt-static` out on musl. So ask rustc directly,
/// with the build's flags, as the crates themselves are compiled.
fn static_musl() -> bool {
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() != Ok("musl") {
        return false;
    }
    let flags = std::env::var("CARGO_ENCODED_RUSTFLAGS").unwrap_or_default();
    let output = std::process::Command::new(std::env::var_os("RUSTC").expect("cargo sets RUSTC"))
        .args(flags.split('\x1f').filter(|flag| !flag.is_empty()))
        .args(["--print", "cfg", "--target"])
        .arg(std::env::var_os("TARGET").expect("cargo sets TARGET"))
        .output()
        .expect("rustc --print cfg");
    assert!(output.status.success(), "rustc --print cfg: {}", String::from_utf8_lossy(&output.stderr));
    String::from_utf8_lossy(&output.stdout).lines().any(|line| line == r#"target_feature="crt-static""#)
}
