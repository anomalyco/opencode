//! Minimal test for user process spawning.
//!
//! Run with: sudo cargo run --features test-spawn-bin --bin test-spawn
//!
//! Note: This binary fails to compile in an Ubuntu Docker image. Sample log:
//! https://gist.github.com/pRizz/b663e8359b21a1723b41e17bc4950dcc
//!
//! This tests each step of the spawn process to identify where it fails.

use std::ffi::CString;
use std::os::unix::process::CommandExt;
use std::process::Command;

fn main() {
    let uid: u32 = 501; // Change to your UID
    let gid: u32 = 20; // Change to your GID
    let username = "peterryszkiewicz"; // Change to your username
    let shell = "/bin/zsh";
    let home = "/Users/peterryszkiewicz";

    println!("=== Spawn Diagnostic ===\n");
    println!(
        "Current process: uid={}, euid={}",
        unsafe { libc::getuid() },
        unsafe { libc::geteuid() }
    );
    println!("Target: uid={}, gid={}, user={}\n", uid, gid, username);

    #[cfg(target_os = "macos")]
    let base_gid: libc::c_int = match gid.try_into() {
        Ok(value) => value,
        Err(_) => {
            eprintln!("gid out of range: {}", gid);
            return;
        }
    };
    #[cfg(not(target_os = "macos"))]
    let base_gid: libc::gid_t = match gid.try_into() {
        Ok(value) => value,
        Err(_) => {
            eprintln!("gid out of range: {}", gid);
            return;
        }
    };
    let c_username = match CString::new(username) {
        Ok(value) => value,
        Err(error) => {
            eprintln!("invalid username: {}", error);
            return;
        }
    };

    // Test 1: Can we call initgroups?
    println!("Test 1: initgroups...");
    let ret = unsafe { libc::initgroups(c_username.as_ptr(), base_gid) };
    if ret == 0 {
        println!("  initgroups: OK");
    } else {
        let err = std::io::Error::last_os_error();
        println!("  initgroups: FAILED - {}", err);
    }

    // Test 2: Simple spawn without setuid
    println!("\nTest 2: Simple spawn (no setuid)...");
    match Command::new("id").output() {
        Ok(output) => {
            println!("  spawn: OK");
            println!(
                "  output: {}",
                String::from_utf8_lossy(&output.stdout).trim()
            );
        }
        Err(e) => println!("  spawn: FAILED - {}", e),
    }

    // Test 3: Spawn with setuid/setgid
    println!("\nTest 3: Spawn with setuid/setgid...");
    let result = Command::new("id").uid(uid).gid(gid).output();
    match result {
        Ok(output) => {
            println!("  spawn with uid/gid: OK");
            println!(
                "  output: {}",
                String::from_utf8_lossy(&output.stdout).trim()
            );
        }
        Err(e) => println!("  spawn with uid/gid: FAILED - {}", e),
    }

    // Test 4: Spawn with pre_exec (initgroups + setsid)
    println!("\nTest 4: Spawn with pre_exec (initgroups + setsid)...");
    let username_clone = c_username.clone();
    let mut cmd = Command::new("id");
    cmd.uid(uid);
    cmd.gid(gid);
    unsafe {
        cmd.pre_exec(move || {
            // initgroups
            if libc::initgroups(username_clone.as_ptr(), base_gid) != 0 {
                return Err(std::io::Error::last_os_error());
            }
            // setsid
            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    match cmd.output() {
        Ok(output) => {
            println!("  spawn with pre_exec: OK");
            println!(
                "  output: {}",
                String::from_utf8_lossy(&output.stdout).trim()
            );
        }
        Err(e) => println!("  spawn with pre_exec: FAILED - {}", e),
    }

    // Test 5: Spawn with pre_exec (initgroups ONLY - no setsid)
    println!("\nTest 5: Spawn with pre_exec (initgroups only)...");
    let username_clone2 = c_username.clone();
    let mut cmd5 = Command::new("id");
    cmd5.uid(uid);
    cmd5.gid(gid);
    unsafe {
        cmd5.pre_exec(move || {
            if libc::initgroups(username_clone2.as_ptr(), base_gid) != 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    match cmd5.output() {
        Ok(output) => {
            println!("  spawn with initgroups only: OK");
            println!(
                "  output: {}",
                String::from_utf8_lossy(&output.stdout).trim()
            );
        }
        Err(e) => println!("  spawn with initgroups only: FAILED - {}", e),
    }

    // Test 6: Spawn with pre_exec (setsid ONLY - no initgroups)
    println!("\nTest 6: Spawn with pre_exec (setsid only)...");
    let mut cmd6 = Command::new("id");
    cmd6.uid(uid);
    cmd6.gid(gid);
    unsafe {
        cmd6.pre_exec(move || {
            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    match cmd6.output() {
        Ok(output) => {
            println!("  spawn with setsid only: OK");
            println!(
                "  output: {}",
                String::from_utf8_lossy(&output.stdout).trim()
            );
        }
        Err(e) => println!("  spawn with setsid only: FAILED - {}", e),
    }

    // Test 7: Spawn with pre_exec (setsid first, then initgroups)
    println!("\nTest 7: Spawn with pre_exec (setsid first, then initgroups)...");
    let username_clone3 = c_username.clone();
    let mut cmd7 = Command::new("id");
    cmd7.uid(uid);
    cmd7.gid(gid);
    unsafe {
        cmd7.pre_exec(move || {
            // setsid first
            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            // then initgroups
            if libc::initgroups(username_clone3.as_ptr(), base_gid) != 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    match cmd7.output() {
        Ok(output) => {
            println!("  spawn with setsid then initgroups: OK");
            println!(
                "  output: {}",
                String::from_utf8_lossy(&output.stdout).trim()
            );
        }
        Err(e) => println!("  spawn with setsid then initgroups: FAILED - {}", e),
    }

    // Test 8: Just setuid without setgid
    println!("\nTest 8: Spawn with uid only (no gid)...");
    match Command::new("id").uid(uid).output() {
        Ok(output) => {
            println!("  spawn with uid only: OK");
            println!(
                "  output: {}",
                String::from_utf8_lossy(&output.stdout).trim()
            );
        }
        Err(e) => println!("  spawn with uid only: FAILED - {}", e),
    }

    // Test 9: Spawn the shell
    println!("\nTest 9: Spawn shell with -c 'id'...");
    let result = Command::new(shell)
        .args(["-c", "id"])
        .uid(uid)
        .gid(gid)
        .current_dir(home)
        .output();
    match result {
        Ok(output) => {
            println!("  spawn shell: OK");
            println!(
                "  output: {}",
                String::from_utf8_lossy(&output.stdout).trim()
            );
        }
        Err(e) => println!("  spawn shell: FAILED - {}", e),
    }

    println!("\n=== Done ===");
}
