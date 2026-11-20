// `cfg(native)`: the `native` feature outside a static musl build (O-188).
#[path = "../plugin/native_cfg.rs"]
mod native_cfg;

fn main() {
    // A deeply nested plugin tree can exceed the Windows main thread's default 1 MiB stack in a debug build.
    let stack = 8 << 20;
    match std::env::var("CARGO_CFG_TARGET_ENV").as_deref() {
        Ok("msvc") => println!("cargo:rustc-link-arg-bin=opencode-native=/STACK:{stack}"),
        Ok("gnu") if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") => {
            println!("cargo:rustc-link-arg-bin=opencode-native=-Wl,--stack,{stack}");
        }
        _ => {}
    }
    native_cfg::emit();
}
