use clap::{Parser, Subcommand};
use std::path::PathBuf;
use worktree::{Create, Link, Manager};

#[derive(Parser)]
#[command(name = "worktree")]
struct Cli {
    #[arg(long, hide = true)]
    database: Option<PathBuf>,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    Create {
        from: Option<PathBuf>,
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        into: Option<PathBuf>,
    },
    Remove {
        at: PathBuf,
    },
    Link {
        at: PathBuf,
        #[arg(long)]
        to: Option<PathBuf>,
    },
    Children {
        of: PathBuf,
    },
    Ancestors {
        of: PathBuf,
    },
}

fn main() {
    if let Err(error) = run() {
        eprintln!("worktree: {error}");
        std::process::exit(1);
    }
}

fn run() -> worktree::Result<()> {
    let cli = Cli::parse();
    let mut manager = match cli.database {
        Some(path) => Manager::open(path)?,
        None => Manager::open_default()?,
    };
    match cli.command {
        Command::Create { from, name, into } => {
            println!(
                "{}",
                manager
                    .create(Create {
                        from: from.unwrap_or(std::env::current_dir()?),
                        name,
                        into,
                    })?
                    .display()
            );
        }
        Command::Remove { at } => manager.remove(at)?,
        Command::Link { at, to } => manager.link(Link { at, to })?,
        Command::Children { of } => {
            for path in manager.children(of)? {
                println!("{}", path.display());
            }
        }
        Command::Ancestors { of } => {
            for path in manager.ancestors(of)? {
                println!("{}", path.display());
            }
        }
    }
    Ok(())
}
