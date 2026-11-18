//! The host's question about a project plugin held back for approval (rich-plugins 3.9): a select row that toggles
//! such a plugin asks it, whichever plugin showed the row (the plugin manager's), since only the host decides what
//! runs (synthesis 3.6).

use opencode_plugin::loader::approval::{Artifact, Decision};
use opencode_ui::confirm::{ConfirmProps, confirm};

use crate::prelude::*;

/// Asks whether the build of the project plugin of `target` that the loader holds back now may run. The answer names
/// that build, so it records nothing when the build changed meanwhile (bigboi-1, carbon-1). Approve and Decline keep
/// the answer for this build; Escape, Ctrl+C, the header and the backdrop leave it pending (carbon-6). However the
/// question closes, `back` runs after it, once a library's answer is applied; a TypeScript plugin's tree may still be
/// hashed for its answer then.
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
            // After the confirm has closed, and before the list comes back; a TypeScript plugin's answer applies once its
            // tree is hashed off the UI thread, and the list follows it then.
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

/// The question about `artifact`, found as plugin directory `target`: the library that would run, where it really is
/// when that is outside the directory, and its hash (bigboi-1, carbon-1).
fn question(target: &str, artifact: &Artifact, unsaved: Option<&str>) -> String {
    let inside =
        artifact.script || std::fs::canonicalize(target).is_ok_and(|directory| artifact.path.starts_with(directory));
    let elsewhere = if inside { "" } else { "\nIt is outside this plugin directory." };
    let saved =
        unsaved.map(|reason| format!("\nYour answer lasts until opencode exits: {reason}.")).unwrap_or_default();
    // The real path as a user would type it: Windows' canonical form starts `\\?\` (`\\?\C:\`, `\\?\UNC\`).
    let path = opencode_util::path::strip_verbatim(&artifact.path.to_string_lossy()).into_owned();
    #[cfg(feature = "luau")]
    if opencode_plugin::luau::approves(artifact) {
        return format!(
            "This project wants to run a Luau plugin inside opencode:\n\n{target}\nPlugin directory: {path}\
             {elsewhere}\nSHA-256 of its files: {}…\n\nIt has no direct access to your files, but it acts through \
             opencode with your permissions. Approve it only if you trust this project.{saved}",
            opencode_plugin::luau::tree_of(artifact).short(),
        );
    }
    if artifact.script {
        return format!(
            "This project wants to run TypeScript code in opencode's JS host:\n\n{target}\nModule directory: {path}\
             {elsewhere}\nSHA-256 of its files: {}…\n\nIt runs with your permissions. Approve it only if you trust this \
             project.{saved}",
            artifact.short(),
        );
    }
    format!(
        "This project wants to run native code inside opencode:\n\n{target}\nLibrary: {path}{elsewhere}\nSHA-256: {}…\n\n\
         It runs with your permissions. Approve it only if you trust this project.{saved}",
        artifact.short(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    // Expected (bigboi-1, bigboi-2, carbon-1): the question shows the library that would run and its hash, says when it
    // lies outside the plugin directory, and says when the answer is not saved.
    #[test]
    fn the_question_names_the_library_and_says_what_is_not_saved() {
        let root = opencode_util::temp::tempdir().unwrap();
        let target = root.path().join("plugins").join("p");
        std::fs::create_dir_all(&target).unwrap();
        let inside = std::fs::canonicalize(&target).unwrap().join("plugin.so");
        let artifact = |path: std::path::PathBuf| Artifact {
            target: target.clone(),
            path,
            sha256: "ab".repeat(32),
            script: false,
        };
        let text = question(&target.to_string_lossy(), &artifact(inside.clone()), None);
        // As a user would type it: on Windows `canonicalize` gives `\\?\C:\…`, which the question leaves out.
        let shown = opencode_util::path::strip_verbatim(&inside.to_string_lossy()).into_owned();
        assert!(text.contains(&format!("Library: {shown}")), "{text}");
        assert!(text.contains(&format!("SHA-256: {}…", "ab".repeat(8))), "{text}");
        assert!(!text.contains("outside") && !text.contains("lasts until"), "{text}");
        let text = question(&target.to_string_lossy(), &artifact("/shared/plugin.so".into()), Some("it is shared"));
        assert!(text.contains("It is outside this plugin directory."), "{text}");
        assert!(text.contains("Your answer lasts until opencode exits: it is shared."), "{text}");
    }

    // Expected: on Windows the real path is shown as a user would type it, without the verbatim prefix that
    // `canonicalize` gives, for a drive and for a share, a library and a module directory.
    #[test]
    fn the_question_shows_a_windows_path_without_its_verbatim_prefix() {
        let artifact = |path: &str, script: bool| Artifact {
            target: r"C:\work\.opencode\plugins\p".into(),
            path: path.into(),
            sha256: "ab".repeat(32),
            script,
        };
        let cases = [
            (r"\\?\C:\work\.opencode\plugins\p\plugin.dll", false, r"Library: C:\work\.opencode\plugins\p\plugin.dll"),
            (r"\\?\UNC\srv\share\p\plugin.dll", false, r"Library: \\srv\share\p\plugin.dll"),
            (r"\\?\C:\work\.opencode\plugins\p", true, r"Module directory: C:\work\.opencode\plugins\p"),
            (r"\\?\UNC\srv\share\p", true, r"Module directory: \\srv\share\p"),
        ];
        for (path, script, shown) in cases {
            let text = question(r"C:\work\.opencode\plugins\p", &artifact(path, script), None);
            assert!(text.contains(&format!("{shown}\n")) && !text.contains(r"\\?\"), "{path}: {text}");
        }
    }

    #[cfg(feature = "luau")]
    #[test]
    fn a_luau_plugin_is_asked_about_as_one() {
        let tree = Artifact { target: "/p".into(), path: "/p".into(), sha256: "ab".repeat(32), script: true };
        let text = question("/p", &opencode_plugin::luau::artifact(tree.clone()), None);
        assert!(text.contains("run a Luau plugin") && text.contains(&format!("files: {}…", "ab".repeat(8))), "{text}");
        assert!(question("/p", &tree, None).contains("TypeScript code in opencode's JS host"));
    }
}
