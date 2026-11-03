use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=ghostty-revision");
    println!("cargo:rerun-if-changed=src/ghostty/ffi.rs");
    println!("cargo:rerun-if-env-changed=GHOSTTY_SOURCE_DIR");
    println!("cargo:rerun-if-env-changed=OPENCODE_ZIG_CPU");

    let revision = include_str!("ghostty-revision").trim();
    assert_eq!(
        include_str!("src/ghostty/ffi.rs")
            .lines()
            .find_map(|line| line.strip_prefix("// Ghostty revision: ")),
        Some(revision),
        "regenerate the bindings with script/ghostty-bindings"
    );
    let out = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR"));
    let source = match env::var_os("GHOSTTY_SOURCE_DIR") {
        Some(path) => {
            let path = PathBuf::from(path);
            for relative in ["src", "pkg", "include", "build.zig", "build.zig.zon"] {
                println!("cargo:rerun-if-changed={}", path.join(relative).display());
            }
            path
        }
        None => {
            let path = out.join(format!("ghostty-{revision}"));
            if !path.join(".checkout-complete").exists() {
                if !path.join(".git").exists() {
                    run(Command::new("git").args(["init"]).arg(&path));
                }
                run(Command::new("git").arg("-C").arg(&path).args([
                    "fetch",
                    "--depth=1",
                    "https://github.com/ghostty-org/ghostty.git",
                    revision,
                ]));
                run(Command::new("git").arg("-C").arg(&path).args([
                    "-c",
                    "core.longpaths=true",
                    "checkout",
                    "--detach",
                    revision,
                ]));
                std::fs::write(path.join(".checkout-complete"), revision)
                    .expect("record Ghostty checkout");
            }
            path
        }
    };

    // The checked-in declarations must match the native headers exactly.
    // Local overrides are useful for builds, but not for silently changing ABI.
    let head = Command::new("git")
        .arg("-C")
        .arg(&source)
        .args(["rev-parse", "HEAD"])
        .output()
        .expect("read Ghostty revision");
    assert!(
        head.status.success(),
        "GHOSTTY_SOURCE_DIR must be a Git checkout"
    );
    assert_eq!(
        String::from_utf8(head.stdout)
            .expect("Ghostty revision UTF-8")
            .trim(),
        revision,
        "Ghostty headers and bindings are pinned together; regenerate before changing the revision"
    );
    run(Command::new("git").arg("-C").arg(&source).args([
        "-c",
        "core.longpaths=true",
        "diff",
        "--quiet",
        "HEAD",
        "--",
        "include/ghostty",
    ]));

    let target = env::var("TARGET").expect("TARGET");
    let install = out.join("ghostty-install");
    let mut build = Command::new("zig");
    build.current_dir(&source).args([
        "build",
        "-Demit-lib-vt=true",
        "-Demit-xcframework=false",
        "-Dapp-runtime=none",
    ]);
    build.arg(if env::var("DEBUG").as_deref() == Ok("true") {
        "-Doptimize=Debug"
    } else if matches!(env::var("OPT_LEVEL").as_deref(), Ok("s" | "z")) {
        "-Doptimize=ReleaseSmall"
    } else {
        "-Doptimize=ReleaseFast"
    });
    // Release builds pin a portable CPU. Unix releases use script/release-bin/zig;
    // Windows cannot run that shell wrapper, so it sets this instead.
    if let Ok(cpu) = env::var("OPENCODE_ZIG_CPU") {
        build.arg(format!("-Dcpu={cpu}"));
    }
    build.arg("--prefix").arg(&install);
    build.arg("--cache-dir").arg(out.join("zig-cache"));
    if env::var("HOST").as_deref() != Ok(target.as_str()) {
        let zig_target = match target.as_str() {
            "x86_64-unknown-linux-gnu" => "x86_64-linux-gnu",
            "aarch64-unknown-linux-gnu" => "aarch64-linux-gnu",
            "x86_64-unknown-linux-musl" => "x86_64-linux-musl",
            "aarch64-unknown-linux-musl" => "aarch64-linux-musl",
            "x86_64-apple-darwin" => "x86_64-macos",
            "aarch64-apple-darwin" => "aarch64-macos",
            "x86_64-pc-windows-msvc" => "x86_64-windows-msvc",
            "aarch64-pc-windows-msvc" => "aarch64-windows-msvc",
            _ => panic!("unsupported Ghostty target: {target}"),
        };
        build.arg(format!("-Dtarget={zig_target}"));
    }
    run(&mut build);

    let library = install.join("lib");
    let windows = target.contains("windows");
    assert!(
        library
            .join(if windows {
                "ghostty-vt-static.lib"
            } else {
                "libghostty-vt.a"
            })
            .is_file()
    );
    println!("cargo:rustc-link-search=native={}", library.display());
    // ghostty-vt.lib is the Windows DLL import library, not the static archive.
    println!(
        "cargo:rustc-link-lib={}",
        if windows {
            "static:+verbatim=ghostty-vt-static.lib"
        } else {
            "static=ghostty-vt"
        }
    );
}

fn run(command: &mut Command) {
    let status = command
        .status()
        .unwrap_or_else(|error| panic!("{command:?}: {error}"));
    assert!(status.success(), "{command:?} failed: {status}");
}
