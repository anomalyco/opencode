//! `cfg(luau)`: the `luau` feature. Code that runs Luau plugins is behind it. `cfg(native)`: the `native` feature
//! outside a static musl build (`native_cfg.rs`). Code that opens native plugin libraries is behind it.

#[path = "../plugin/native_cfg.rs"]
mod native_cfg;

fn main() {
    println!("cargo::rustc-check-cfg=cfg(luau)");
    println!("cargo::rerun-if-changed=build.rs");
    println!("cargo::rerun-if-changed=../plugin/native_cfg.rs");
    if std::env::var_os("CARGO_FEATURE_LUAU").is_some() {
        println!("cargo::rustc-cfg=luau");
    }
    native_cfg::emit();
}
