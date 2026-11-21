//! Ask before running a project plugin. Approval belongs to the displayed artifact, not its path alone.

use opencode_plugin::loader::approval::{Artifact, Decision};
use opencode_ui::confirm::{ConfirmProps, confirm};

use crate::prelude::*;

/// Ask about the held build of `target`; record the answer only while it still identifies the same build.
pub(super) fn ask(tui: &Tui, target: &str, back: impl Fn() + 'static) {
    let Some((held, unsaved)) = super::host::held(tui, target) else { return };
    let artifact = match held {
        Ok(artifact) => artifact,
        Err(error) => return tui.toasts.error(format!("This plugin cannot be approved: {error}")),
    };
    let decide = |decision: Decision| -> Rc<dyn Fn()> {
        let (weak, target, artifact) = (tui.weak(), target.to_owned(), artifact.clone());
        Rc::new(move || {
            let Some(tui) = weak.upgrade() else { return };
            let (target, artifact) = (target.clone(), artifact.clone());
            // Wait for the off-thread approval check before reopening the list.
            tui.app.defer(bind!(tui, |tui, _| {
                super::host::decide(&tui, &target, &artifact, decision, |tui, recorded| match recorded {
                    Ok(true) => {}
                    Ok(false) => tui.toasts.show(ToastOptions::new(
                        Variant::Warning,
                        "The plugin changed while you were asked, so nothing was saved. Review the new build.",
                    )),
                    Err(error) => tui.toasts.error(format!("The decision was not saved: {error}")),
                });
            }));
        })
    };
    let props = ConfirmProps {
        title: "Run project plugin?".to_owned(),
        message: question(target, &artifact, unsaved.as_deref()),
        on_confirm: Some(decide(Decision::Approved)),
        on_cancel: Some(decide(Decision::Declined)),
        confirm_label: Some("approve".to_owned()),
        cancel_label: Some("decline".to_owned()),
        dismiss: true,
        cancel_first: true,
    };
    let back: Rc<dyn Fn()> = Rc::new(back);
    let closed: Box<dyn FnOnce()> = Box::new(bind!(tui, |tui| {
        let back = back.clone();
        tui.app.defer(move |_| back());
    }));
    let options = DialogOptions::new(DialogSize::Medium).key(super::host::APPROVAL);
    tui.dialogs.replace(move |cx| confirm(cx, props.clone()), Some(closed), options);
}

/// Describe the plugin directory's real path, the hash of its files, and whether the decision can be saved.
fn question(target: &str, artifact: &Artifact, unsaved: Option<&str>) -> String {
    let saved =
        unsaved.map(|reason| format!("\nYour answer lasts until opencode exits: {reason}.")).unwrap_or_default();
    // The real path as a user would type it: Windows' canonical form starts `\\?\` (`\\?\C:\`, `\\?\UNC\`).
    let path = opencode_util::path::strip_verbatim(&artifact.path.to_string_lossy()).into_owned();
    #[cfg(luau)]
    if opencode_plugin::luau::approves(artifact) {
        return format!(
            "This project wants to run a Luau plugin inside opencode:\n\n{target}\nPlugin directory: {path}\
             \nSHA-256 of its files: {}…\n\nIt has no direct access to your files, but it acts through opencode with \
             your permissions. Approve it only if you trust this project.{saved}",
            opencode_plugin::luau::tree_of(artifact).short(),
        );
    }
    format!(
        "This project wants to run TypeScript code in opencode's JS host:\n\n{target}\nModule directory: {path}\
         \nSHA-256 of its files: {}…\n\nIt runs with your permissions. Approve it only if you trust this project.{saved}",
        artifact.short(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_question_names_the_files_and_says_what_is_not_saved() {
        let artifact = Artifact { target: "/p".into(), path: "/real/p".into(), sha256: "ab".repeat(32) };
        let text = question("/p", &artifact, None);
        assert!(text.contains("Module directory: /real/p\n"), "{text}");
        assert!(text.contains(&format!("SHA-256 of its files: {}…", "ab".repeat(8))), "{text}");
        assert!(!text.contains("lasts until"), "{text}");
        let text = question("/p", &artifact, Some("it is shared"));
        assert!(text.contains("Your answer lasts until opencode exits: it is shared."), "{text}");
    }

    // Expected: on Windows the real path is shown as a user would type it, without the verbatim prefix that
    // `canonicalize` gives, for a drive and for a share.
    #[test]
    fn the_question_shows_a_windows_path_without_its_verbatim_prefix() {
        let artifact = |path: &str| Artifact {
            target: r"C:\work\.opencode\plugins\p".into(),
            path: path.into(),
            sha256: "ab".repeat(32),
        };
        let cases = [
            (r"\\?\C:\work\.opencode\plugins\p", r"Module directory: C:\work\.opencode\plugins\p"),
            (r"\\?\UNC\srv\share\p", r"Module directory: \\srv\share\p"),
        ];
        for (path, shown) in cases {
            let text = question(r"C:\work\.opencode\plugins\p", &artifact(path), None);
            assert!(text.contains(&format!("{shown}\n")) && !text.contains(r"\\?\"), "{path}: {text}");
        }
    }

    #[cfg(luau)]
    #[test]
    fn a_luau_plugin_is_asked_about_as_one() {
        let tree = Artifact { target: "/p".into(), path: "/p".into(), sha256: "ab".repeat(32) };
        let text = question("/p", &opencode_plugin::luau::artifact(tree.clone()), None);
        assert!(text.contains("run a Luau plugin") && text.contains(&format!("files: {}…", "ab".repeat(8))), "{text}");
        assert!(question("/p", &tree, None).contains("TypeScript code in opencode's JS host"));
    }
}
