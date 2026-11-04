//! Command tables, as `packages/latex/src/symbols.ts`.

use crate::parse::Role;

/// The symbol a command names and its spacing role (`symbolTable`).
pub fn symbol(command: &str) -> Option<(&'static str, Role)> {
    let role = |table: &[(&str, &'static str)], role: Role| {
        table
            .iter()
            .find(|(name, _)| *name == command)
            .map(|(_, value)| (*value, role))
    };
    role(ORDINARY, Role::Ordinary)
        .or_else(|| role(BINARY, Role::Binary))
        .or_else(|| role(RELATION, Role::Relation))
        .or_else(|| role(ARROWS, Role::Relation))
        .or_else(|| role(PUNCTUATION, Role::Punctuation))
}

pub fn large_operator(command: &str) -> Option<&'static str> {
    lookup(LARGE_OPERATORS, command)
}

pub fn is_named_operator(command: &str) -> bool {
    NAMED_OPERATORS.contains(&command)
}

/// The glyph of a delimiter token or command name (`delimiterTable`).
pub fn delimiter(name: &str) -> Option<&'static str> {
    lookup(DELIMITERS, name)
}

/// The width in cells of a spacing command (`spacingCommands`).
pub fn spacing(command: &str) -> Option<usize> {
    SPACING
        .iter()
        .find(|(name, _)| *name == command)
        .map(|(_, width)| *width)
}

fn lookup(table: &[(&str, &'static str)], name: &str) -> Option<&'static str> {
    table
        .iter()
        .find(|(key, _)| *key == name)
        .map(|(_, value)| *value)
}

const ORDINARY: &[(&str, &str)] = &[
    ("alpha", "α"),
    ("beta", "β"),
    ("gamma", "γ"),
    ("delta", "δ"),
    ("epsilon", "ε"),
    ("varepsilon", "ϵ"),
    ("zeta", "ζ"),
    ("eta", "η"),
    ("theta", "θ"),
    ("vartheta", "ϑ"),
    ("iota", "ι"),
    ("kappa", "κ"),
    ("lambda", "λ"),
    ("mu", "μ"),
    ("nu", "ν"),
    ("xi", "ξ"),
    ("omicron", "ο"),
    ("pi", "π"),
    ("varpi", "ϖ"),
    ("rho", "ρ"),
    ("varrho", "ϱ"),
    ("sigma", "σ"),
    ("varsigma", "ς"),
    ("tau", "τ"),
    ("upsilon", "υ"),
    ("phi", "ϕ"),
    ("varphi", "φ"),
    ("chi", "χ"),
    ("psi", "ψ"),
    ("omega", "ω"),
    ("Gamma", "Γ"),
    ("Delta", "Δ"),
    ("Theta", "Θ"),
    ("Lambda", "Λ"),
    ("Xi", "Ξ"),
    ("Pi", "Π"),
    ("Sigma", "Σ"),
    ("Upsilon", "Υ"),
    ("Phi", "Φ"),
    ("Psi", "Ψ"),
    ("Omega", "Ω"),
    ("infty", "∞"),
    ("ell", "ℓ"),
    ("hbar", "ℏ"),
    ("imath", "ı"),
    ("jmath", "ȷ"),
    ("Re", "ℜ"),
    ("Im", "ℑ"),
    ("aleph", "ℵ"),
    ("beth", "ℶ"),
    ("gimel", "ℷ"),
    ("daleth", "ℸ"),
    ("partial", "∂"),
    ("nabla", "∇"),
    ("angle", "∠"),
    ("measuredangle", "∡"),
    ("triangle", "△"),
    ("square", "□"),
    ("lozenge", "◊"),
    ("top", "⊤"),
    ("bot", "⊥"),
    ("emptyset", "∅"),
    ("varnothing", "∅"),
    ("forall", "∀"),
    ("exists", "∃"),
    ("nexists", "∄"),
    ("neg", "¬"),
    ("lnot", "¬"),
    ("prime", "′"),
    ("backprime", "‵"),
    ("clubsuit", "♣"),
    ("diamondsuit", "♢"),
    ("heartsuit", "♡"),
    ("spadesuit", "♠"),
    ("checkmark", "✓"),
];

const BINARY: &[(&str, &str)] = &[
    ("pm", "±"),
    ("mp", "∓"),
    ("times", "×"),
    ("div", "÷"),
    ("cdot", "·"),
    ("ast", "∗"),
    ("star", "⋆"),
    ("circ", "∘"),
    ("bullet", "∙"),
    ("oplus", "⊕"),
    ("ominus", "⊖"),
    ("otimes", "⊗"),
    ("oslash", "⊘"),
    ("odot", "⊙"),
    ("cap", "∩"),
    ("cup", "∪"),
    ("uplus", "⊎"),
    ("sqcap", "⊓"),
    ("sqcup", "⊔"),
    ("vee", "∨"),
    ("lor", "∨"),
    ("wedge", "∧"),
    ("land", "∧"),
    ("setminus", "∖"),
    ("wr", "≀"),
    ("diamond", "⋄"),
    ("bigtriangleup", "△"),
    ("bigtriangledown", "▽"),
    ("triangleleft", "◁"),
    ("triangleright", "▷"),
];

const RELATION: &[(&str, &str)] = &[
    ("equals", "="),
    ("neq", "≠"),
    ("ne", "≠"),
    ("equiv", "≡"),
    ("approx", "≈"),
    ("sim", "∼"),
    ("simeq", "≃"),
    ("cong", "≅"),
    ("asymp", "≍"),
    ("propto", "∝"),
    ("lt", "<"),
    ("gt", ">"),
    ("le", "≤"),
    ("leq", "≤"),
    ("ge", "≥"),
    ("geq", "≥"),
    ("ll", "≪"),
    ("gg", "≫"),
    ("prec", "≺"),
    ("succ", "≻"),
    ("preceq", "⪯"),
    ("succeq", "⪰"),
    ("subset", "⊂"),
    ("supset", "⊃"),
    ("subseteq", "⊆"),
    ("supseteq", "⊇"),
    ("sqsubset", "⊏"),
    ("sqsupset", "⊐"),
    ("sqsubseteq", "⊑"),
    ("sqsupseteq", "⊒"),
    ("in", "∈"),
    ("ni", "∋"),
    ("notin", "∉"),
    ("owns", "∋"),
    ("vdash", "⊢"),
    ("dashv", "⊣"),
    ("models", "⊨"),
    ("mid", "∣"),
    ("parallel", "∥"),
    ("perp", "⊥"),
    ("smile", "⌣"),
    ("frown", "⌢"),
];

const ARROWS: &[(&str, &str)] = &[
    ("leftarrow", "←"),
    ("gets", "←"),
    ("rightarrow", "→"),
    ("to", "→"),
    ("leftrightarrow", "↔"),
    ("Leftarrow", "⇐"),
    ("Rightarrow", "⇒"),
    ("Leftrightarrow", "⇔"),
    ("mapsto", "↦"),
    ("hookleftarrow", "↩"),
    ("hookrightarrow", "↪"),
    ("leftharpoonup", "↼"),
    ("leftharpoondown", "↽"),
    ("rightharpoonup", "⇀"),
    ("rightharpoondown", "⇁"),
    ("rightleftharpoons", "⇌"),
    ("longleftarrow", "⟵"),
    ("longrightarrow", "⟶"),
    ("longleftrightarrow", "⟷"),
    ("Longleftarrow", "⟸"),
    ("Longrightarrow", "⟹"),
    ("Longleftrightarrow", "⟺"),
    ("longmapsto", "⟼"),
    ("uparrow", "↑"),
    ("downarrow", "↓"),
    ("updownarrow", "↕"),
    ("Uparrow", "⇑"),
    ("Downarrow", "⇓"),
    ("Updownarrow", "⇕"),
    ("nearrow", "↗"),
    ("searrow", "↘"),
    ("swarrow", "↙"),
    ("nwarrow", "↖"),
];

const PUNCTUATION: &[(&str, &str)] = &[
    ("cdots", "⋯"),
    ("ldots", "…"),
    ("dots", "…"),
    ("vdots", "⋮"),
    ("ddots", "⋱"),
    ("colon", ":"),
];

const LARGE_OPERATORS: &[(&str, &str)] = &[
    ("sum", "∑"),
    ("prod", "∏"),
    ("coprod", "∐"),
    ("int", "∫"),
    ("iint", "∬"),
    ("iiint", "∭"),
    ("oint", "∮"),
    ("bigcap", "⋂"),
    ("bigcup", "⋃"),
    ("bigvee", "⋁"),
    ("bigwedge", "⋀"),
    ("bigoplus", "⨁"),
    ("bigotimes", "⨂"),
    ("bigodot", "⨀"),
];

const NAMED_OPERATORS: &[&str] = &[
    "arccos", "arcsin", "arctan", "arg", "cos", "cosh", "cot", "coth", "csc", "deg", "det", "dim",
    "exp", "gcd", "hom", "inf", "ker", "lg", "lim", "liminf", "limsup", "ln", "log", "max", "min",
    "mod", "Pr", "sec", "sin", "sinh", "sup", "tan", "tanh",
];

const DELIMITERS: &[(&str, &str)] = &[
    ("(", "("),
    (")", ")"),
    ("[", "["),
    ("]", "]"),
    ("\\{", "{"),
    ("\\}", "}"),
    ("{", "{"),
    ("}", "}"),
    ("|", "│"),
    ("\\|", "║"),
    ("vert", "│"),
    ("Vert", "║"),
    ("lvert", "│"),
    ("rvert", "│"),
    ("lVert", "║"),
    ("rVert", "║"),
    ("lbrace", "{"),
    ("rbrace", "}"),
    ("langle", "⟨"),
    ("rangle", "⟩"),
    ("lfloor", "⌊"),
    ("rfloor", "⌋"),
    ("lceil", "⌈"),
    ("rceil", "⌉"),
    (".", ""),
];

const SPACING: &[(&str, usize)] = &[
    (",", 0),
    (":", 1),
    (";", 1),
    ("!", 0),
    ("quad", 2),
    ("qquad", 4),
    ("enspace", 1),
    ("thinspace", 0),
];
