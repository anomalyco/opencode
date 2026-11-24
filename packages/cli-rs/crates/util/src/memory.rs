//! Gives the system back the memory the allocator keeps after the program freed it.

/// Asks glibc's allocator to return the free pages of every arena to the system (`malloc_trim(0)`). glibc returns
/// freed memory only from the top of its heap, so after many frees below a live allocation the pages stay resident.
/// Returns whether the allocator gave anything back. Elsewhere (musl, macOS, Windows) it does nothing and returns
/// false: their allocators return memory themselves, or have no such call.
#[cfg(all(target_os = "linux", target_env = "gnu"))]
#[allow(unsafe_code)]
pub fn release() -> bool {
    // SAFETY: `malloc_trim` takes no pointers; glibc serializes it with every other allocator call.
    unsafe { libc::malloc_trim(0) == 1 }
}

#[cfg(not(all(target_os = "linux", target_env = "gnu")))]
pub fn release() -> bool {
    false
}
