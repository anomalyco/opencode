//! The binary's link options.

fn main() {
    // The TUI runs on the main thread, whose stack holds the reconcile of a plugin tree of 64 levels (P1's depth
    // limit): more than Windows' default of 1 MiB in a debug build. 8 MiB, as Linux and macOS give the main thread
    // (review carbon 5.1).
    let stack = 8 << 20;
    match std::env::var("CARGO_CFG_TARGET_ENV").as_deref() {
        Ok("msvc") => println!("cargo:rustc-link-arg-bin=opencode-native=/STACK:{stack}"),
        Ok("gnu") if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") => {
            println!("cargo:rustc-link-arg-bin=opencode-native=-Wl,--stack,{stack}");
        }
        _ => {}
    }
}
