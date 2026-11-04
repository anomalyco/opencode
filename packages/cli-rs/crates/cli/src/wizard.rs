//! `--wizard`. Step C.15; until then the flag is accepted and reports that it is not supported (O-11).

pub fn run() -> anyhow::Result<()> {
    anyhow::bail!("--wizard is not supported yet (plan step C.15)")
}
