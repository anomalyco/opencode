//! The harness of the seeded model tests (O-124), in the shape of OpenTUI's
//! `packages/rust/crates/opentui/tests/support/model.rs`: generate a command list from a seed, run it against the
//! real host and its oracles, and on a failure shrink the list (drop chunks of n/2 down to 1, then simplify each
//! command) and print the trace.
//!
//! Environment: `MODEL_SEED=<n>` runs one seed, `MODEL_SEEDS=<n>` sets how many seeds run, `MODEL_SKIP=<property,...>`
//! ignores failures of the named properties.

use std::fmt::Debug;

/// xorshift64*: small, fast, and the same sequence on every platform.
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Self(seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1)
    }

    pub fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }

    /// A number below `n` (which is nonzero).
    pub fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }

    pub fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[self.below(items.len())]
    }
}

/// A check that failed: its property, its check site, the command after which it did, and what differed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Failure {
    /// The property, the same name in every client and the fixture.
    pub property: &'static str,
    /// The check site within the property; the shrinker keeps a candidate only when it fails the same one.
    pub site: &'static str,
    pub step: usize,
    pub detail: String,
}

pub trait Model {
    type Command: Clone + Debug;

    fn generate(&self, rng: &mut Rng, steps: usize) -> Vec<Self::Command>;

    /// Runs the commands from a fresh start; the first check that fails, if any. A model asks [`skipped`] at each
    /// check site, so a property that is turned off does not hide the checks after it.
    fn run(&self, commands: &[Self::Command]) -> Option<Failure>;

    /// Smaller versions of a command to try while shrinking. None may lead back to the command.
    fn simplify(&self, _command: &Self::Command) -> Vec<Self::Command> {
        Vec::new()
    }
}

fn environment(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|value| !value.is_empty())
}

/// Whether `MODEL_SKIP` turns `property` off.
pub fn skipped(property: &str) -> bool {
    static SKIP: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();
    SKIP.get_or_init(|| environment("MODEL_SKIP").unwrap_or_default().split(',').map(str::to_owned).collect())
        .iter()
        .any(|name| name == property)
}

/// Runs `seeds` seeds of `steps` commands (or the environment's), and panics with the original and the shrunk trace of
/// a failure.
pub fn check<M: Model>(model: &M, seeds: u64, steps: usize) {
    let seed_value = environment("MODEL_SEED").map(|text| text.parse::<u64>().expect("MODEL_SEED is a number"));
    let seeds = environment("MODEL_SEEDS").map_or(seeds, |text| text.parse().expect("MODEL_SEEDS is a number"));
    let range = match seed_value {
        Some(seed) => seed..seed + 1,
        None => 0..seeds,
    };
    for seed in range {
        let commands = model.generate(&mut Rng::new(seed), steps);
        let Some(failure) = model.run(&commands) else { continue };
        let original = format!(
            "seed {seed}: {} at {} after step {} of {}: {}",
            failure.property,
            failure.site,
            failure.step,
            commands.len(),
            failure.detail
        );
        let shrunk = shrink(model, commands, &failure);
        let last = model.run(&shrunk).unwrap_or(failure);
        let trace: Vec<String> = shrunk.iter().map(|command| format!("  {command:?}")).collect();
        let report = format!(
            "model failure, {original}\nshrunk to {} commands, {} at {} after step {}:\n{}\n{}",
            shrunk.len(),
            last.property,
            last.site,
            last.step,
            trace.join("\n"),
            last.detail
        );
        // A plugin's shims may have silenced the panic hook; the report is printed either way.
        eprintln!("{report}");
        panic!("{report}");
    }
}

/// The shrinker keeps a candidate only when it fails the same check site: two checks of one property can fail for two
/// different defects.
fn fails_like<M: Model>(model: &M, commands: &[M::Command], failure: &Failure) -> bool {
    model.run(commands).is_some_and(|other| other.property == failure.property && other.site == failure.site)
}

/// Drops chunks of n/2 down to 1, then simplifies each command, and repeats both until neither changes the trace. The
/// result is locally irreducible: no command can be dropped or simplified and keep the failure. It is not always the
/// shortest trace.
fn shrink<M: Model>(model: &M, initial: Vec<M::Command>, failure: &Failure) -> Vec<M::Command> {
    let mut current = initial;
    loop {
        let mut changed = false;
        let mut chunk = (current.len() / 2).max(1);
        loop {
            let mut start = 0;
            let mut removed_any = false;
            while start < current.len() {
                let end = current.len().min(start + chunk);
                let candidate: Vec<M::Command> = current[..start].iter().chain(&current[end..]).cloned().collect();
                if fails_like(model, &candidate, failure) {
                    current = candidate;
                    (removed_any, changed) = (true, true);
                } else {
                    start = end;
                }
            }
            if chunk == 1 && !removed_any {
                break;
            }
            if !removed_any {
                chunk /= 2;
            }
        }
        // Simplify each command while the failure stays: the first smaller command that keeps it.
        for index in 0..current.len() {
            'simpler: loop {
                for candidate in model.simplify(&current[index]) {
                    let saved = std::mem::replace(&mut current[index], candidate);
                    if fails_like(model, &current, failure) {
                        changed = true;
                        continue 'simpler;
                    }
                    current[index] = saved;
                }
                break;
            }
        }
        if !changed {
            return current;
        }
    }
}

/// A model of numbers. It fails `p` at site `x` when the trace holds 1 and 2, or 3, and at site `four` when it holds
/// 4; 2 simplifies to 3.
struct Toy;

impl Model for Toy {
    type Command = u8;

    fn generate(&self, _: &mut Rng, _: usize) -> Vec<u8> {
        vec![1, 2]
    }

    fn run(&self, commands: &[u8]) -> Option<Failure> {
        let failure = |site| Some(Failure { property: "p", site, step: commands.len(), detail: String::new() });
        if (commands.contains(&1) && commands.contains(&2)) || commands.contains(&3) {
            return failure("x");
        }
        commands.contains(&4).then(|| failure("four")).flatten()
    }

    fn simplify(&self, command: &u8) -> Vec<u8> {
        if *command == 2 { vec![3] } else { Vec::new() }
    }
}

// Expected (review bigboi-10): the shrinker deletes again after a simplification, to a fixed point, and it keeps the
// check site, so it does not take a failure at another site of the same property for this one.
#[test]
fn the_shrinker_keeps_the_site_and_reaches_a_fixed_point() {
    let x = Failure { property: "p", site: "x", step: 2, detail: String::new() };
    assert_eq!(shrink(&Toy, vec![1, 2], &x), vec![3]);
    let four = Failure { property: "p", site: "four", step: 3, detail: String::new() };
    assert_eq!(shrink(&Toy, vec![4, 1, 2], &four), vec![4]);
}
