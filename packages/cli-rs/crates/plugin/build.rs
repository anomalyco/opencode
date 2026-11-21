//! `cfg(luau)`: the `luau` feature. Code that runs Luau plugins is behind it.

fn main() {
    println!("cargo::rustc-check-cfg=cfg(luau)");
    println!("cargo::rerun-if-changed=build.rs");
    if std::env::var_os("CARGO_FEATURE_LUAU").is_some() {
        println!("cargo::rustc-cfg=luau");
    }
}
