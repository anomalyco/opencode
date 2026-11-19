//! Process counters for the benchmarks: instructions retired, physical footprint and its peak. macOS only, through
//! `proc_pid_rusage`; elsewhere every counter reads `None`. Shared by the bench binary and examples, which each use
//! part of it.
#![allow(dead_code)]

#[derive(Clone, Copy, Debug, Default)]
pub struct Usage {
    pub instructions: u64,
    pub cycles: u64,
    /// Bytes of physical memory the process is charged for now, and at most since it started.
    pub footprint: u64,
    pub peak_footprint: u64,
}

#[cfg(target_os = "macos")]
pub fn usage() -> Option<Usage> {
    // `struct rusage_info_v4` of <sys/resource.h>: a 16-byte UUID and 35 u64 fields up to `ri_runnable_time`.
    #[repr(C)]
    struct RusageInfoV4 {
        uuid: [u8; 16],
        fields: [u64; 35],
    }
    const RUSAGE_INFO_V4: i32 = 4;
    const PHYS_FOOTPRINT: usize = 7;
    const LIFETIME_MAX_PHYS_FOOTPRINT: usize = 28;
    const INSTRUCTIONS: usize = 29;
    const CYCLES: usize = 30;
    unsafe extern "C" {
        fn proc_pid_rusage(pid: i32, flavor: i32, buffer: *mut RusageInfoV4) -> i32;
    }
    let mut info = RusageInfoV4 {
        uuid: [0; 16],
        fields: [0; 35],
    };
    // SAFETY: the kernel fills at most `sizeof(struct rusage_info_v4)` bytes, which `RusageInfoV4` has, for our own
    // pid. Only the benchmarks use this; the language crate stays free of `unsafe`.
    let r = unsafe { proc_pid_rusage(std::process::id() as i32, RUSAGE_INFO_V4, &mut info) };
    (r == 0).then(|| Usage {
        instructions: info.fields[INSTRUCTIONS],
        cycles: info.fields[CYCLES],
        footprint: info.fields[PHYS_FOOTPRINT],
        peak_footprint: info.fields[LIFETIME_MAX_PHYS_FOOTPRINT],
    })
}

#[cfg(not(target_os = "macos"))]
pub fn usage() -> Option<Usage> {
    None
}

/// Instructions retired by the process so far, or 0 where they can't be read.
pub fn instructions() -> u64 {
    usage().map_or(0, |u| u.instructions)
}
