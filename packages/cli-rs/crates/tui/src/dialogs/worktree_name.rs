//! Name worktree dialog (E.11b, row DLG27): `component/dialog-worktree-name.tsx`.
//!
//! "Name worktree" asks for a name; `tab` (`dialog.worktree.generate`) fills in a generated one, and an empty
//! or symbol-only name becomes a generated one on Enter.

use std::cell::Cell;
use std::rc::Rc;

use opencode_ui::dialog::DialogOptions;
use opencode_ui::prompt::{PromptAction, PromptProps, prompt};

use crate::app::Tui;

/// `DialogWorktreeName.show`: `on_name` gets the name, or `None` when the dialog closes without one.
pub fn show(tui: &Tui, on_name: Rc<dyn Fn(Option<String>)>) {
    // `resolve` runs once: a confirm resolves first, and the close that follows does nothing.
    let done = Rc::new(Cell::new(false));
    let resolve = {
        let done = done.clone();
        Rc::new(move |name: Option<String>| {
            if !done.replace(true) {
                on_name(name);
            }
        })
    };
    let confirm = resolve.clone();
    tui.dialogs.replace(
        move |cx| {
            prompt(
                cx,
                PromptProps {
                    title: "Name worktree".into(),
                    placeholder: Some("Worktree name".into()),
                    actions: vec![PromptAction {
                        title: "generate name".into(),
                        command: "dialog.worktree.generate".into(),
                        command_title: Some("Generate worktree name".into()),
                        run: Rc::new(|prompt| prompt.set_value(&slug())),
                    }],
                    on_confirm: Some(Rc::new(move |value: &str| {
                        let name = slugify(value);
                        confirm(Some(if name.is_empty() { slug() } else { name }));
                    })),
                    ..PromptProps::default()
                },
            )
            .0
        },
        Some(Box::new(move || resolve(None))),
        DialogOptions::default(),
    );
}

/// `slugify`: lower case, runs of anything but `a-z0-9` become one `-`, no `-` at either end.
pub fn slugify(input: &str) -> String {
    let mut out = String::new();
    for char in input.trim().to_lowercase().chars() {
        if char.is_ascii_lowercase() || char.is_ascii_digit() {
            out.push(char);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    out.trim_matches('-').to_owned()
}

/// `Slug.create` (`packages/core/src/util/slug.ts`): an adjective and a noun.
pub fn slug() -> String {
    const ADJECTIVES: [&str; 29] = [
        "brave", "calm", "clever", "cosmic", "crisp", "curious", "eager", "gentle", "glowing", "happy", "hidden",
        "jolly", "kind", "lucky", "mighty", "misty", "neon", "nimble", "playful", "proud", "quick", "quiet", "shiny",
        "silent", "stellar", "sunny", "swift", "tidy", "witty",
    ];
    const NOUNS: [&str; 31] = [
        "cabin", "cactus", "canyon", "circuit", "comet", "eagle", "engine", "falcon", "forest", "garden", "harbor",
        "island", "knight", "lagoon", "meadow", "moon", "mountain", "nebula", "orchid", "otter", "panda", "pixel",
        "planet", "river", "rocket", "sailor", "squid", "star", "tiger", "wizard", "wolf",
    ];
    let random = uuid::Uuid::new_v4().as_u128();
    format!(
        "{}-{}",
        ADJECTIVES[(random % ADJECTIVES.len() as u128) as usize],
        NOUNS[((random >> 64) % NOUNS.len() as u128) as usize]
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_slugified_as_typescript_does() {
        assert_eq!(slugify("  My Feature!  "), "my-feature");
        assert_eq!(slugify("--a__b--"), "a-b");
        assert_eq!(slugify("Ünïcode 42"), "n-code-42");
        assert_eq!(slugify("!!!"), "");
    }

    #[test]
    fn generated_names_are_an_adjective_and_a_noun() {
        let name = slug();
        let (adjective, noun) = name.split_once('-').unwrap();
        assert!(!adjective.is_empty() && !noun.is_empty());
        assert_eq!(slugify(&name), name);
    }
}
