//! The resolved semantic tokens of one theme view (`ResolvedThemeTokens` in `packages/theme/src/tui/types.ts`).
//! Field names follow the TypeScript tokens; [`Tokens::visit`] lists every token under its TypeScript path.

use opentui::style::Color;

/// Which states an action or form field is in. [`Stateful::state`] picks the first set state in the order
/// disabled, pressed, focused, selected, hovered.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ActionStates {
    pub disabled: bool,
    pub pressed: bool,
    pub focused: bool,
    pub selected: bool,
    pub hovered: bool,
}

/// Declares a token struct and its blank value; `Color` has no `Default`.
macro_rules! tokens {
    ($($(#[$meta:meta])* pub struct $name:ident { $(pub $field:ident: $ty:ty,)* })*) => {$(
        $(#[$meta])*
        #[derive(Clone, Copy, Debug, PartialEq, Eq)]
        pub struct $name {
            $(pub $field: $ty,)*
        }

        impl Blank for $name {
            fn blank() -> Self {
                Self { $($field: Blank::blank(),)* }
            }
        }

        impl Colors for $name {
            fn colors<'a>(&'a self, f: &mut impl FnMut(&'a Color)) {
                $(self.$field.colors(f);)*
            }
        }
    )*};
}

trait Blank {
    fn blank() -> Self;
}

impl Blank for Color {
    fn blank() -> Self {
        Color::TRANSPARENT
    }
}

/// Every color in field order, which is [`Tokens::visit`] order, without building paths.
trait Colors {
    fn colors<'a>(&'a self, f: &mut impl FnMut(&'a Color));
}

impl Colors for Color {
    fn colors<'a>(&'a self, f: &mut impl FnMut(&'a Color)) {
        f(self);
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Feedback<T> {
    pub error: T,
    pub warning: T,
    pub success: T,
    pub info: T,
}

impl<T: Blank> Blank for Feedback<T> {
    fn blank() -> Self {
        Self { error: T::blank(), warning: T::blank(), success: T::blank(), info: T::blank() }
    }
}

impl<T: Colors> Colors for Feedback<T> {
    fn colors<'a>(&'a self, f: &mut impl FnMut(&'a Color)) {
        for feedback in [&self.error, &self.warning, &self.success, &self.info] {
            feedback.colors(f);
        }
    }
}

tokens! {
    /// A color per action state.
    pub struct Stateful {
        pub base: Color,
        pub disabled: Color,
        pub pressed: Color,
        pub focused: Color,
        pub selected: Color,
        pub hovered: Color,
    }

    pub struct Actions {
        pub primary: Stateful,
        pub secondary: Stateful,
        pub destructive: Stateful,
    }

    pub struct TextFeedback {
        pub base: Color,
        pub muted: Color,
    }

    /// A token group with one color, such as `border.base`.
    pub struct Base {
        pub base: Color,
    }

    pub struct Text {
        pub base: Color,
        pub muted: Color,
        pub faint: Color,
        pub action: Actions,
        pub formfield: Stateful,
        pub feedback: Feedback<TextFeedback>,
    }

    pub struct Raised {
        pub base: Color,
        pub high: Color,
        pub max: Color,
    }

    pub struct Background {
        pub base: Color,
        pub raised: Raised,
        pub action: Actions,
        pub formfield: Stateful,
        pub feedback: Feedback<Base>,
    }

    pub struct DiffText {
        pub added: Color,
        pub removed: Color,
        pub context: Color,
        pub hunk_header: Color,
    }

    pub struct DiffBackground {
        pub added: Color,
        pub removed: Color,
        pub context: Color,
    }

    pub struct DiffPair {
        pub added: Color,
        pub removed: Color,
    }

    pub struct DiffLineNumber {
        pub text: Color,
        pub background: DiffPair,
    }

    pub struct Diff {
        pub text: DiffText,
        pub background: DiffBackground,
        pub highlight: DiffPair,
        pub line_number: DiffLineNumber,
    }

    pub struct Syntax {
        pub comment: Color,
        pub keyword: Color,
        pub function: Color,
        pub variable: Color,
        pub string: Color,
        pub number: Color,
        pub r#type: Color,
        pub operator: Color,
        pub punctuation: Color,
    }

    pub struct Markdown {
        pub text: Color,
        pub heading: Color,
        pub link: Color,
        pub link_text: Color,
        pub code: Color,
        pub block_quote: Color,
        pub emphasis: Color,
        pub strong: Color,
        pub horizontal_rule: Color,
        pub list_item: Color,
        pub list_enumeration: Color,
        pub image: Color,
        pub image_text: Color,
        pub code_block: Color,
    }

    /// The semantic tokens of one surface.
    pub struct Tokens {
        pub text: Text,
        pub background: Background,
        pub border: Base,
        pub scrollbar: Base,
        pub diff: Diff,
        pub syntax: Syntax,
        pub markdown: Markdown,
    }
}

impl Stateful {
    pub fn state(&self, states: ActionStates) -> Color {
        [
            (states.disabled, self.disabled),
            (states.pressed, self.pressed),
            (states.focused, self.focused),
            (states.selected, self.selected),
            (states.hovered, self.hovered),
        ]
        .into_iter()
        .find_map(|(set, color)| set.then_some(color))
        .unwrap_or(self.base)
    }
}

/// The body of [`Tokens::visit`] and [`Tokens::visit_ref`]: every token with its TypeScript path, borrowed
/// mutably when `mut` is given.
macro_rules! visit_tokens {
    ($tokens:expr, $f:expr, $($m:tt)*) => {{
        let f = $f;
        let text = & $($m)* $tokens.text;
        f("text.base", & $($m)* text.base);
        f("text.muted", & $($m)* text.muted);
        f("text.faint", & $($m)* text.faint);
        visit_actions!("text.action", & $($m)* text.action, f, $($m)*);
        visit_stateful!("text.formfield", & $($m)* text.formfield, f, $($m)*);
        for (kind, feedback) in [("error", & $($m)* text.feedback.error), ("warning", & $($m)* text.feedback.warning), ("success", & $($m)* text.feedback.success), ("info", & $($m)* text.feedback.info)] {
            f(&format!("text.feedback.{kind}.base"), & $($m)* feedback.base);
            f(&format!("text.feedback.{kind}.muted"), & $($m)* feedback.muted);
        }
        let background = & $($m)* $tokens.background;
        f("background.base", & $($m)* background.base);
        f("background.raised.base", & $($m)* background.raised.base);
        f("background.raised.high", & $($m)* background.raised.high);
        f("background.raised.max", & $($m)* background.raised.max);
        visit_actions!("background.action", & $($m)* background.action, f, $($m)*);
        visit_stateful!("background.formfield", & $($m)* background.formfield, f, $($m)*);
        for (kind, feedback) in [("error", & $($m)* background.feedback.error), ("warning", & $($m)* background.feedback.warning), ("success", & $($m)* background.feedback.success), ("info", & $($m)* background.feedback.info)] {
            f(&format!("background.feedback.{kind}.base"), & $($m)* feedback.base);
        }
        f("border.base", & $($m)* $tokens.border.base);
        f("scrollbar.base", & $($m)* $tokens.scrollbar.base);
        let diff = & $($m)* $tokens.diff;
        f("diff.text.added", & $($m)* diff.text.added);
        f("diff.text.removed", & $($m)* diff.text.removed);
        f("diff.text.context", & $($m)* diff.text.context);
        f("diff.text.hunkHeader", & $($m)* diff.text.hunk_header);
        f("diff.background.added", & $($m)* diff.background.added);
        f("diff.background.removed", & $($m)* diff.background.removed);
        f("diff.background.context", & $($m)* diff.background.context);
        f("diff.highlight.added", & $($m)* diff.highlight.added);
        f("diff.highlight.removed", & $($m)* diff.highlight.removed);
        f("diff.lineNumber.text", & $($m)* diff.line_number.text);
        f("diff.lineNumber.background.added", & $($m)* diff.line_number.background.added);
        f("diff.lineNumber.background.removed", & $($m)* diff.line_number.background.removed);
        let syntax = & $($m)* $tokens.syntax;
        f("syntax.comment", & $($m)* syntax.comment);
        f("syntax.keyword", & $($m)* syntax.keyword);
        f("syntax.function", & $($m)* syntax.function);
        f("syntax.variable", & $($m)* syntax.variable);
        f("syntax.string", & $($m)* syntax.string);
        f("syntax.number", & $($m)* syntax.number);
        f("syntax.type", & $($m)* syntax.r#type);
        f("syntax.operator", & $($m)* syntax.operator);
        f("syntax.punctuation", & $($m)* syntax.punctuation);
        let markdown = & $($m)* $tokens.markdown;
        f("markdown.text", & $($m)* markdown.text);
        f("markdown.heading", & $($m)* markdown.heading);
        f("markdown.link", & $($m)* markdown.link);
        f("markdown.linkText", & $($m)* markdown.link_text);
        f("markdown.code", & $($m)* markdown.code);
        f("markdown.blockQuote", & $($m)* markdown.block_quote);
        f("markdown.emphasis", & $($m)* markdown.emphasis);
        f("markdown.strong", & $($m)* markdown.strong);
        f("markdown.horizontalRule", & $($m)* markdown.horizontal_rule);
        f("markdown.listItem", & $($m)* markdown.list_item);
        f("markdown.listEnumeration", & $($m)* markdown.list_enumeration);
        f("markdown.image", & $($m)* markdown.image);
        f("markdown.imageText", & $($m)* markdown.image_text);
        f("markdown.codeBlock", & $($m)* markdown.code_block);
    }};
}

macro_rules! visit_actions {
    ($prefix:expr, $actions:expr, $f:expr, $($m:tt)*) => {{
        let actions = $actions;
        visit_stateful!(&format!("{}.primary", $prefix), & $($m)* actions.primary, $f, $($m)*);
        visit_stateful!(&format!("{}.secondary", $prefix), & $($m)* actions.secondary, $f, $($m)*);
        visit_stateful!(&format!("{}.destructive", $prefix), & $($m)* actions.destructive, $f, $($m)*);
    }};
}

macro_rules! visit_stateful {
    ($prefix:expr, $color:expr, $f:expr, $($m:tt)*) => {{
        let (prefix, color) = ($prefix, $color);
        $f(&format!("{prefix}.base"), & $($m)* color.base);
        $f(&format!("{prefix}.disabled"), & $($m)* color.disabled);
        $f(&format!("{prefix}.pressed"), & $($m)* color.pressed);
        $f(&format!("{prefix}.focused"), & $($m)* color.focused);
        $f(&format!("{prefix}.selected"), & $($m)* color.selected);
        $f(&format!("{prefix}.hovered"), & $($m)* color.hovered);
    }};
}

impl Tokens {
    /// Every token transparent; the resolver fills it through [`Tokens::visit`].
    pub(crate) fn blank() -> Self {
        Blank::blank()
    }

    /// Calls `f` with every token and its TypeScript path, such as `text.action.primary.hovered`.
    pub fn visit(&mut self, f: &mut impl FnMut(&str, &mut Color)) {
        visit_tokens!(self, f, mut);
    }

    /// [`Tokens::visit`] without mutation.
    pub fn visit_ref<'a>(&'a self, f: &mut impl FnMut(&str, &'a Color)) {
        visit_tokens!(self, f,);
    }

    /// Every token in [`Tokens::visit`] order, without its path.
    pub(crate) fn visit_colors<'a>(&'a self, f: &mut impl FnMut(&'a Color)) {
        self.colors(f);
    }

    /// The token at a TypeScript path.
    pub fn get(&self, path: &str) -> Option<&Color> {
        let mut found = None;
        self.visit_ref(&mut |name, color| {
            if name == path {
                found = Some(color);
            }
        });
        found
    }

    /// Every token with its TypeScript path, in [`Tokens::visit`] order.
    pub fn list(&self) -> Vec<(String, Color)> {
        let mut list = Vec::new();
        self.visit_ref(&mut |path, color| list.push((path.to_owned(), *color)));
        list
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn colors_walk_the_tokens_in_visit_order() {
        let tokens = Tokens::blank();
        let (mut named, mut nameless) = (Vec::new(), Vec::new());
        tokens.visit_ref(&mut |_, color| named.push(std::ptr::from_ref(color)));
        tokens.visit_colors(&mut |color| nameless.push(std::ptr::from_ref(color)));
        assert_eq!(named, nameless);
    }
}
