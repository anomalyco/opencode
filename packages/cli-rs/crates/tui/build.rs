//! `cfg(luau)`: the `luau` feature, on a target whose link takes Luau. Code that runs Luau plugins is behind it, not
//! behind the feature alone.

fn main() {
    println!("cargo::rustc-check-cfg=cfg(luau)");
    println!("cargo::rerun-if-changed=build.rs");
    // TODO(OpenTUI past v0.9.2): Luau is off on x86_64 Windows MSVC, the same target Cargo.toml leaves mlua out on.
    // OpenTUI v0.9.2's static library there bundles mingw's gdtoa, whose strtopx.obj (pulled by its sscanf) defines
    // `strtold`; ucrt's strtod.obj, which Luau's `strtod` pulls in, defines it too: LNK2005. Take this out once OpenTUI
    // ships a Windows library without bundled libc symbols.
    let cfg = |key: &str| std::env::var(format!("CARGO_CFG_TARGET_{key}")).unwrap_or_default();
    let windows_x64_msvc = cfg("ARCH") == "x86_64" && cfg("OS") == "windows" && cfg("ENV") == "msvc";
    if std::env::var_os("CARGO_FEATURE_LUAU").is_some() && !windows_x64_msvc {
        println!("cargo::rustc-cfg=luau");
    }
}
