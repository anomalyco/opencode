//! Shared by the performance scenarios of the TUI (`tests/all/perf.rs`) and of mini (`src/perf.rs`): the measured
//! region and its `PERF` line, and the long session both replay.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use serde_json::{Value, json};

use super::heap;

/// Turns of the long session: a user message and an assistant message of [`PARTS`] parts each, so 500 messages
/// and 5,000 parts.
pub const TURNS: usize = 250;
pub const PARTS: usize = 20;
pub const LONG: &str = "ses_long";

/// One measured region: the counts start at [`Probe::start`] and print at [`Probe::finish`].
pub struct Probe {
    heap: heap::Measure,
    instructions: Option<Instructions>,
    start: Instant,
    cpu: Option<Duration>,
}

impl Probe {
    pub fn start() -> Self {
        let instructions = Instructions::open();
        let cpu = process_cpu();
        let heap = heap::measure();
        // `OPENCODE_PERF_SITES=N` records the stack of every Nth allocation, which slows the region down.
        let every = std::env::var("OPENCODE_PERF_SITES").ok().and_then(|every| every.parse().ok()).unwrap_or(0);
        heap::sample_every(every);
        Self { heap, instructions, start: Instant::now(), cpu }
    }

    /// Prints the counts of the region as one `PERF` line; `units` is the scenario's unit of work (events, keys,
    /// frames), for per-unit figures.
    pub fn finish(self, scenario: &str, units: u64) {
        let wall = self.start.elapsed();
        let thread = self.heap.thread();
        let all = self.heap.all();
        let instructions = self.instructions.as_ref().map(Instructions::read);
        let cpu = self.cpu.zip(process_cpu()).map(|(before, after)| after.saturating_sub(before));
        heap::sample_every(0);
        drop(self.heap);
        let samples = heap::samples();
        let line = json!({
            "scenario": scenario,
            "units": units,
            "allocations": thread.allocations,
            "bytes": thread.bytes,
            "peak": thread.peak,
            "kept": thread.kept,
            "all_allocations": all.allocations,
            "all_bytes": all.bytes,
            "all_peak": all.peak,
            "instructions": instructions,
            "wall_ms": wall.as_secs_f64() * 1e3,
            "cpu_ms": cpu.map(|cpu| cpu.as_secs_f64() * 1e3),
        });
        println!("PERF {line}");
        print_sites(samples);
    }
}

/// Prints the sampled allocation sites, the most frequent first, as `PERF-SITE` lines: the share of the samples, the
/// innermost client function on the stack (a function of a crate `opencode_*`, or a method of its type), and the
/// innermost function outside the standard library, which allocated for it.
fn print_sites(samples: Vec<std::backtrace::Backtrace>) {
    let total = samples.len();
    let mut sites: HashMap<(String, String), usize> = HashMap::new();
    for trace in samples {
        let text = trace.to_string();
        let frames: Vec<&str> = text
            .lines()
            .filter_map(|line| line.trim_start().split_once(": ").map(|(_, name)| name))
            .filter(|name| {
                !name.contains("support::heap") && !name.contains("backtrace") && !name.starts_with("__rust")
            })
            .map(|name| name.rsplit_once("::h").filter(|(_, hash)| hash.len() == 16).map_or(name, |(name, _)| name))
            .collect();
        let standard = ["alloc::", "<alloc::", "core::", "<core::", "std::", "<std::", "hashbrown::", "<hashbrown::"];
        let via = frames.iter().find(|name| !standard.iter().any(|prefix| name.starts_with(prefix)));
        let client = frames.iter().find(|name| name.trim_start_matches('<').starts_with("opencode_"));
        let key = (client.unwrap_or(&"?").to_string(), via.unwrap_or(&"?").to_string());
        *sites.entry(key).or_default() += 1;
    }
    let mut sites: Vec<_> = sites.into_iter().collect();
    sites.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    for ((client, via), count) in sites.into_iter().take(15) {
        println!("PERF-SITE {:5.1}% {client} <- {via}", count as f64 * 100.0 / total as f64);
    }
}

/// The user-space instructions this thread retires, from a hardware counter. `None` where the kernel does not let
/// the process count its own thread (`perf_event_paranoid` above 2, a container, a virtual machine without a PMU).
#[cfg(target_os = "linux")]
struct Instructions {
    file: std::fs::File,
    start: u64,
}

#[cfg(target_os = "linux")]
impl Instructions {
    #[allow(unsafe_code)]
    fn open() -> Option<Self> {
        use std::os::fd::FromRawFd;
        /// The first 64 bytes of `struct perf_event_attr` (`PERF_ATTR_SIZE_VER0`).
        #[repr(C)]
        struct Attr {
            kind: u32,
            size: u32,
            config: u64,
            sample_period: u64,
            sample_type: u64,
            read_format: u64,
            flags: u64,
            wakeup_events: u32,
            bp_type: u32,
            config1: u64,
        }
        const HARDWARE: u32 = 0;
        const INSTRUCTIONS: u64 = 1;
        const EXCLUDE_KERNEL: u64 = 1 << 5;
        const EXCLUDE_HV: u64 = 1 << 6;
        const CLOEXEC: libc::c_ulong = 1 << 3;
        let attr = Attr {
            kind: HARDWARE,
            size: size_of::<Attr>() as u32,
            config: INSTRUCTIONS,
            sample_period: 0,
            sample_type: 0,
            read_format: 0,
            flags: EXCLUDE_KERNEL | EXCLUDE_HV,
            wakeup_events: 0,
            bp_type: 0,
            config1: 0,
        };
        // SAFETY: `attr` is a valid `perf_event_attr` of the size it declares, which the call only reads; pid 0 and
        // cpu -1 count this thread on any CPU.
        let fd = unsafe {
            libc::syscall(
                libc::SYS_perf_event_open,
                &raw const attr,
                0 as libc::pid_t,
                -1 as libc::c_int,
                -1 as libc::c_int,
                CLOEXEC,
            )
        };
        if fd < 0 {
            return None;
        }
        // SAFETY: the call returned a new descriptor that nothing else owns.
        let file = unsafe { std::fs::File::from_raw_fd(fd as i32) };
        let mut counter = Self { file, start: 0 };
        counter.start = counter.value();
        Some(counter)
    }

    fn value(&self) -> u64 {
        use std::io::Read;
        let mut bytes = [0u8; 8];
        (&self.file).read_exact(&mut bytes).expect("an instruction count");
        u64::from_ne_bytes(bytes)
    }

    fn read(&self) -> u64 {
        self.value() - self.start
    }
}

#[cfg(not(target_os = "linux"))]
struct Instructions;

#[cfg(not(target_os = "linux"))]
impl Instructions {
    fn open() -> Option<Self> {
        None
    }

    fn read(&self) -> u64 {
        0
    }
}

/// User and system CPU time of the whole process, all threads.
#[cfg(unix)]
#[allow(unsafe_code)]
fn process_cpu() -> Option<Duration> {
    let mut usage = std::mem::MaybeUninit::<libc::rusage>::uninit();
    // SAFETY: `getrusage` fills the `rusage` it is given and reads nothing from it.
    if unsafe { libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()) } != 0 {
        return None;
    }
    // SAFETY: `getrusage` returned 0, so it filled `usage`.
    let usage = unsafe { usage.assume_init() };
    let time = |time: libc::timeval| Duration::new(time.tv_sec as u64, time.tv_usec as u32 * 1000);
    Some(time(usage.ru_utime) + time(usage.ru_stime))
}

#[cfg(not(unix))]
fn process_cpu() -> Option<Duration> {
    None
}

/// `turns` turns, oldest first: a user question, then an assistant answer of `parts` parts that cycle through
/// reasoning, Markdown text and finished tool calls.
pub fn long_messages(turns: usize, parts: usize) -> Vec<Value> {
    (1..=turns)
        .flat_map(|turn| {
            let created = turn as u64 * 100_000;
            let content: Vec<Value> = (0..parts)
                .map(|part| match part % 4 {
                    0 => json!({
                        "type": "reasoning", "text": format!("Reasoning {turn}.{part}: check the parser and the tests first."),
                        "time": { "created": created + 1000, "completed": created + 2000 },
                    }),
                    1 => json!({
                        "type": "tool", "id": format!("call_{turn}_{part}"), "name": "read",
                        "state": {
                            "status": "completed", "input": { "filePath": format!("/project/src/module_{part}.rs") },
                            "metadata": {}, "content": [{ "type": "text", "text": "fn main() {\n    println!(\"hello\");\n}\n" }],
                        },
                        "time": { "created": created + 2000, "ran": created + 2000, "completed": created + 2500 },
                    }),
                    2 => json!({
                        "type": "tool", "id": format!("call_{turn}_{part}"), "name": "grep",
                        "state": {
                            "status": "completed", "input": { "pattern": "TODO", "path": "/project/src" },
                            "metadata": { "matches": 3 },
                            "content": [{ "type": "text", "text": "src/a.rs:1: TODO\nsrc/b.rs:2: TODO\nsrc/c.rs:3: TODO" }],
                        },
                        "time": { "created": created + 2500, "ran": created + 2500, "completed": created + 2600 },
                    }),
                    _ => json!({
                        "type": "text",
                        "text": format!(
                            "Answer {turn}.{part}: the parser now handles **nested** groups and `escapes`.\n\n\
                             - first point about the change\n- second point, with a [link](https://opencode.ai)\n\n\
                             ```rust\nfn parse(input: &str) -> Tree {{\n    Tree::new(input)\n}}\n```"
                        ),
                    }),
                })
                .collect();
            [
                json!({
                    "id": format!("msg_{turn:04}a"), "type": "user", "text": format!("Question {turn} about the parser"),
                    "time": { "created": created },
                }),
                json!({
                    "id": format!("msg_{turn:04}b"), "type": "assistant", "agent": "build",
                    "model": { "providerID": "provider-0", "id": "model-0-0" },
                    "time": { "created": created + 1000, "completed": created + 3000 }, "finish": "stop",
                    "tokens": { "input": 1200, "output": 50, "reasoning": 0, "cache": { "read": 3000, "write": 0 } },
                    "content": content,
                }),
            ]
        })
        .collect()
}
