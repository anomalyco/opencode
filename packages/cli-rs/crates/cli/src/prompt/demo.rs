//! `opencode-prompt-demo <case>`: the scripts of `parity/oracle/C.p-prompts.ts`, run with this kit, so
//! P-PTY and P-CLI can compare them with `@clack/prompts`.

#[path = "mod.rs"]
mod prompt;

use prompt::{Cancelled, Choice};

fn check<T>(value: Result<T, Cancelled>) -> T {
    value.unwrap_or_else(|Cancelled| {
        prompt::cancel("Cancelled");
        std::process::exit(130)
    })
}

fn show(value: impl std::fmt::Display) {
    prompt::log::step(&format!("value: {value}"));
}

fn providers() -> Vec<Choice<String>> {
    vec![
        Choice::new("anthropic".to_string(), "Anthropic").hint("recommended"),
        Choice::new("openai".to_string(), "OpenAI"),
        Choice::new("google".to_string(), "Google").hint("Gemini"),
        Choice::plain("local".to_string()),
    ]
}

fn many() -> Vec<Choice<String>> {
    (1..=20)
        .map(|index| Choice::new(format!("item-{index}"), format!("Item {index}")))
        .collect()
}

fn main() {
    let name = std::env::args().nth(1).unwrap_or_default();
    match name.as_str() {
        "text" => {
            prompt::intro("Text");
            show(check(
                prompt::text("Your name")
                    .placeholder("Ada Lovelace")
                    .prompt(),
            ));
            prompt::outro("Done");
        }
        "text-validate" => {
            let number = |value: &str| {
                (!value.is_empty() && !value.chars().all(|char| char.is_ascii_digit()))
                    .then(|| "Expected a number".to_string())
            };
            show(check(
                prompt::text("Port")
                    .initial_value("80")
                    .default_value("8080")
                    .validate(number)
                    .prompt(),
            ));
            let required = |value: &str| value.is_empty().then(|| "Required".to_string());
            show(check(prompt::text("Required").validate(required).prompt()));
        }
        "password" => {
            let required = |value: &str| value.is_empty().then(|| "Required".to_string());
            show(check(
                prompt::password("API key").validate(required).prompt(),
            ));
        }
        "confirm" => {
            show(check(prompt::confirm("Continue?").prompt()));
            show(check(
                prompt::confirm("Delete it?")
                    .initial_value(false)
                    .active("Delete")
                    .inactive("Keep")
                    .prompt(),
            ));
        }
        "select" => {
            show(check(
                prompt::select("Provider", providers())
                    .initial_value("openai".to_string())
                    .prompt(),
            ));
        }
        "select-long" => {
            show(check(
                prompt::select("Pick one", many()).max_items(7).prompt(),
            ));
        }
        "multiselect" => {
            let chosen = check(
                prompt::multiselect("Providers", providers())
                    .initial_values(vec!["google".into()])
                    .prompt(),
            );
            show(chosen.join(","));
            let chosen = check(
                prompt::multiselect("Optional", providers()[..2].to_vec())
                    .required(false)
                    .prompt(),
            );
            show(chosen.join(","));
        }
        "autocomplete" => {
            let options = providers().into_iter().chain(many()).collect();
            let chosen = check(
                prompt::autocomplete("Search", options)
                    .max_items(6)
                    .prompt(),
            );
            show(chosen.unwrap_or_else(|| "undefined".to_string()));
        }
        "spinner" => {
            prompt::intro("Spinner");
            let mut progress = prompt::spinner();
            progress.start("Installing...");
            std::thread::sleep(std::time::Duration::from_millis(300));
            progress.message("Linking");
            std::thread::sleep(std::time::Duration::from_millis(300));
            progress.stop("Installed");
            let mut failing = prompt::spinner();
            failing.start("Connecting");
            std::thread::sleep(std::time::Duration::from_millis(200));
            failing.stop_with("Connection failed", 1);
            prompt::outro("Done");
        }
        "spinner-wait" => {
            let mut progress = prompt::spinner();
            progress.start("Waiting");
            std::thread::sleep(std::time::Duration::from_secs(20));
            progress.stop("Finished");
        }
        "messages" => {
            prompt::intro("Messages");
            prompt::log::message("Plain message\nsecond line\n\nafter a blank");
            prompt::log::info("Info");
            prompt::log::success("Success");
            prompt::log::step("Step");
            prompt::log::warn("Warning");
            prompt::log::error("Error");
            prompt::note("First line of the note\nsecond", "A title");
            prompt::note("Short", "A much longer title than the body");
            prompt::outro("Bye");
            prompt::cancel("Cancelled");
        }
        _ => {
            eprintln!("unknown case: {name}");
            std::process::exit(2);
        }
    }
}
