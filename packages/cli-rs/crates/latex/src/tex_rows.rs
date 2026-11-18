//! Rows ported from opentui-tex (`src/math-parser.test.ts`, `math-layout.test.ts`, `unicode-tex-backend.test.ts`),
//! in strict mode and complete input, the plugin's modes, on this crate's layout: TS's radical and matrix rows,
//! which the P-ORACLE holds. `steps/latex-inline.md` lists what is not ported. Then the inline rows.

use crate::layout::{self, Options};
use crate::parse::{Accent, Environment, Node, Role, Variant, parse};

fn display(source: &str) -> String {
    crate::render(source).unwrap_or_else(|error| panic!("{source:?}: {error}")).to_string()
}

fn inline(source: &str) -> String {
    crate::inline::render(source).unwrap_or_else(|error| panic!("{source:?}: {error}")).to_string()
}

fn sym(value: &str) -> Node {
    Node::Symbol { value: value.into(), role: Some(Role::Ordinary) }
}

const EMPTY: Node = Node::Row(Vec::new());

/// A matrix's cells: `""` for an empty one, a symbol's value, `*` for anything else.
fn cells(node: &Node) -> Vec<Vec<String>> {
    let Node::Matrix { rows, .. } = node else { panic!("not a matrix: {node:?}") };
    let cell = |node: &Node| match node {
        Node::Row(body) if body.is_empty() => String::new(),
        Node::Symbol { value, .. } => value.clone(),
        _ => "*".into(),
    };
    rows.iter().map(|row| row.iter().map(cell).collect()).collect()
}

#[test]
fn comments_end_at_any_line_break_and_leave_raw_groups() {
    for (source, expected) in [
        ("x% ignored }\\unknown\ny", "xy"),
        ("x% ignored\ry", "xy"),
        ("x% ignored at EOF", "x"),
        ("\\frac% ignored\n{x}{y}", "\\frac{x}{y}"),
        ("\\begin{array}{l% ignored }\ncr}x&y&z\\end{array}", "\\begin{array}{lcr}x&y&z\\end{array}"),
        ("\\textcolor{re% ignored\r\nd}{x}", "\\textcolor{red}{x}"),
    ] {
        assert_eq!(parse(source), parse(expected), "{source:?}");
    }
}

#[test]
fn matrices_keep_empty_cells() {
    for (source, rows) in [
        ("a&&\\\\&b&", vec![vec!["a", "", ""], vec!["", "b", ""]]),
        ("&=x\\\\&=y", vec![vec!["", "*"], vec!["", "*"]]),
        ("&&", vec![vec!["", "", ""]]),
        ("a\\\\", vec![vec!["a"]]),
        ("\\\\", vec![vec![""]]),
        ("", vec![vec![]]),
    ] {
        for environment in ["matrix", "aligned", "align*"] {
            let node = parse(&format!("\\begin{{{environment}}}{source}\\end{{{environment}}}")).unwrap();
            assert_eq!(cells(&node), rows, "{environment} {source:?}");
        }
    }
    let nested = parse("\\begin{aligned}&\\begin{matrix}a&&b\\end{matrix}\\\\c&\\end{aligned}").unwrap();
    assert_eq!(cells(&nested), [vec!["", "*"], vec!["c", ""]]);
    let Node::Matrix { rows, .. } = &nested else { unreachable!() };
    assert_eq!(cells(&rows[0][1]), [vec!["a", "", "b"]]);
    assert_eq!(cells(&parse("\\displaylines{a&\\\\&b}").unwrap()), [vec!["a", ""], vec!["", "b"]]);
    let Node::Row(body) = parse("\\displaylines{\\frac{1}{2}\\\\{y}}+z").unwrap() else { panic!() };
    assert!(matches!(&body[0], Node::Matrix { environment: Environment::Gathered, .. }), "{body:?}");
    assert_eq!(body.len(), 3);
}

#[test]
fn array_columns_keep_alignment_and_rules() {
    let node = parse("\\begin{array}{ | l || c r | }a&b&c\\end{array}").unwrap();
    assert!(matches!(&node, Node::Matrix { columns: Some(columns), .. } if columns == "|l||cr|"), "{node:?}");
}

#[test]
fn variants_braces_and_text() {
    for (command, variant) in [
        ("mathrm", Variant::Normal),
        ("textrm", Variant::Normal),
        ("mathnormal", Variant::Normal),
        ("mathbf", Variant::Bold),
        ("boldsymbol", Variant::Bold),
        ("bm", Variant::Bold),
        ("mathit", Variant::Italic),
        ("mathsf", Variant::Sans),
        ("mathtt", Variant::Monospace),
        ("mathbb", Variant::DoubleStruck),
        ("mathcal", Variant::Script),
        ("mathscr", Variant::Script),
        ("mathfrak", Variant::Fraktur),
    ] {
        let body = if command == "textrm" { Node::Text("x".into()) } else { sym("x") };
        assert_eq!(parse(&format!("\\{command}{{x}}")), Ok(Node::Variant { variant, body: Box::new(body) }));
    }
    for (source, over) in [("\\overbrace{x}^{n}", true), ("\\underbrace{x}_{n}", false)] {
        let Ok(Node::Scripts { base, .. }) = parse(source) else { panic!("{source}") };
        assert_eq!(*base, Node::Brace { body: Box::new(sym("x")), over });
    }
    for (source, value) in [
        ("\\text{left \\{ right \\} \\% \\# \\$ \\& \\_ \\ }", "left { right } % # $ & _  "),
        ("\\text{a\\,b\\:c\\;d\\!e~f\\textbackslash!}", "a b c de f\\!"),
        ("\\mbox{\\quad!\\qquad!\\enspace!\\thinspace!}", "  !    ! ! !"),
        ("\\text{100% raw\ntext}", "100% raw\ntext"),
        ("\\text{\\unknown}", "\\unknown"),
    ] {
        assert_eq!(parse(source), Ok(Node::Text(value.into())), "{source:?}");
    }
    let textrm = Node::Variant { variant: Variant::Normal, body: Box::new(Node::Text(" if ".into())) };
    assert_eq!(parse("\\textrm{ if }"), Ok(textrm));
    for command in ["mod", "bmod"] {
        assert_eq!(parse(&format!("\\{command}")), Ok(Node::Operator { value: "mod".into(), limits: false }));
    }
}

#[test]
fn color_ends_at_its_argument_or_the_cell() {
    let red = |body: Node| Node::Color { color: "red".into(), body: Box::new(body) };
    assert_eq!(parse("\\textcolor{red}{x}+y").unwrap(), Node::Row(vec![red(sym("x")), plus(), sym("y")]));
    assert_eq!(
        parse("{\\color{red}xy}z").unwrap(),
        Node::Row(vec![red(Node::Row(vec![sym("x"), sym("y")])), sym("z")])
    );
    let matrix = parse("\\begin{matrix}\\color{red}x&y\\\\z\\end{matrix}").unwrap();
    let Node::Matrix { rows, .. } = matrix else { panic!() };
    assert_eq!(rows, [vec![red(sym("x")), sym("y")], vec![sym("z")]]);
    let Ok(Node::Delimited { body, right, .. }) = parse("\\left(\\color{red}x\\right)") else { panic!() };
    assert_eq!((*body, right.as_str()), (red(sym("x")), ")"));
    let Ok(Node::Root { index, body }) = parse("\\sqrt[\\color{red}3]{x}") else { panic!() };
    assert_eq!((index.map(|index| *index), *body), (Some(red(sym("3"))), sym("x")));
}

fn plus() -> Node {
    Node::Symbol { value: "+".into(), role: Some(Role::Binary) }
}

#[test]
fn commands_and_symbols() {
    for command in [
        "arccos", "arcsin", "arctan", "arg", "cosh", "cot", "coth", "csc", "deg", "dim", "hom", "lg", "Pr", "sec",
        "sinh", "tanh", "liminf", "limsup",
    ] {
        let limits = command.starts_with("lim");
        assert_eq!(parse(&format!("\\{command}")), Ok(Node::Operator { value: command.into(), limits }));
    }
    // opentui-tex swaps `\epsilon` and `\varepsilon`; the fences keep TS's, which the P-ORACLE holds.
    for (command, value) in [
        ("imath", "ı"),
        ("jmath", "ȷ"),
        ("beth", "ℶ"),
        ("daleth", "ℸ"),
        ("measuredangle", "∡"),
        ("lozenge", "◊"),
        ("nexists", "∄"),
        ("clubsuit", "♣"),
        ("uplus", "⊎"),
        ("sqcup", "⊔"),
        ("wr", "≀"),
        ("triangleleft", "◁"),
        ("equals", "="),
        ("asymp", "≍"),
        ("preceq", "⪯"),
        ("sqsubseteq", "⊑"),
        ("owns", "∋"),
        ("mid", "∣"),
        ("dashv", "⊣"),
        ("smile", "⌣"),
        ("hookrightarrow", "↪"),
        ("rightharpoonup", "⇀"),
        ("rightleftharpoons", "⇌"),
        ("Longrightarrow", "⟹"),
        ("longmapsto", "⟼"),
        ("Updownarrow", "⇕"),
        ("nwarrow", "↖"),
        ("epsilon", "ε"),
        ("varepsilon", "ϵ"),
        ("degree", "°"),
    ] {
        assert!(matches!(parse(&format!("\\{command}")), Ok(Node::Symbol { value: v, .. }) if v == value), "{command}");
    }
    for (command, value) in [("bigoplus", "⨁"), ("bigotimes", "⨂"), ("bigodot", "⨀")] {
        assert_eq!(parse(&format!("\\{command}")), Ok(Node::Operator { value: value.into(), limits: true }));
    }
    for (source, value) in [
        ("=", "≠"),
        ("<", "≮"),
        (">", "≯"),
        ("\\leq", "≰"),
        ("\\geq", "≱"),
        ("\\in", "∉"),
        ("\\ni", "∌"),
        ("\\subset", "⊄"),
        ("\\supset", "⊅"),
        ("\\equiv", "≢"),
        ("\\approx", "≉"),
        ("\\sim", "≁"),
        ("\\subseteq", "⊈"),
        ("\\supseteq", "⊉"),
        ("\\mid", "∤"),
        ("\\parallel", "∦"),
        ("x", "x\u{338}"),
    ] {
        assert!(
            matches!(parse(&format!("\\not {source}")), Ok(Node::Symbol { value: v, .. }) if v == value),
            "{source}"
        );
    }
    for (left, right, value) in [("lvert", "rvert", "│"), ("lVert", "rVert", "║"), ("lbrace", "rbrace", "{")] {
        let delimited = parse(&format!("\\left\\{left} x\\right\\{right}"));
        assert!(matches!(delimited, Ok(Node::Delimited { left: l, .. }) if l == value), "{left}");
        assert_eq!(parse(&format!("\\{left}")), Ok(Node::Symbol { value: value.into(), role: None }));
    }
}

#[test]
fn directives_make_no_atom_and_limits_reach_operators_through_styles() {
    for directive in ["displaystyle", "textstyle", "scriptstyle", "scriptscriptstyle"] {
        assert_eq!(parse(&format!("x^\\{directive}2")), parse("x^2"), "{directive}");
        assert_eq!(parse(&format!("\\sum\\{directive}_1^2")), parse("\\sum_1^2"), "{directive}");
    }
    for (source, expected) in [("\\sum\\limits_1^2", true), ("\\sum^2\\nolimits_1", false), ("\\int\\limits_1^2", true)]
    {
        let Ok(Node::Scripts { base, .. }) = parse(source) else { panic!("{source}") };
        assert!(matches!(*base, Node::Operator { limits, .. } if limits == expected), "{source}");
    }
    let Ok(Node::Scripts { base, .. }) = parse("\\mathbf{\\sum}\\limits_1^2") else { panic!() };
    assert!(matches!(&*base, Node::Variant { body, .. } if matches!(**body, Node::Operator { limits: true, .. })));
    {
        for (source, expected) in [
            ("\\sum\\limits_1^2", "2\n∑\n1"),
            ("\\sum\\nolimits_1^2", "∑²₁"),
            ("\\int\\limits_1^2", "2\n∫\n1"),
            ("\\sum^2\\nolimits_1", "∑²₁"),
            ("\\sum\\limits\\nolimits_1^2", "∑²₁"),
            ("\\sum\\nolimits\\limits_1^2", "2\n∑\n1"),
            ("\\sum_1^2", "2\n∑\n1"),
            ("\\int_1^2", "∫²₁"),
            ("\\sum\\displaystyle_1^2", "2\n∑\n1"),
            ("x^\\displaystyle2", "x²"),
            ("\\mathbf{\\sum}\\limits_1^2", "2\n∑\n1"),
            ("\\textcolor{red}{\\sum}\\nolimits_1^2", "∑²₁"),
            ("\\mathbf{\\sum}_1^2", "2\n∑\n1"),
            ("\\mathbf{\\sin}x", "sin x"),
            ("\\mathbf{\\underbrace{abcd}}_{n}", "abcd\n╰┬─╯\n n"),
            ("\\mathbf{\\sum_1^2}\\nolimits", "∑²₁"),
            ("\\textcolor{red}{\\mathbf{\\sum_1^2}}\\limits", "2\n∑\n1"),
            ("\\mathbf{\\sum_1}\\limits^2", "2\n∑\n1"),
            ("\\mathbf{\\sum^2}\\limits_1", "2\n∑\n1"),
            ("\\textcolor{red}{\\sum_1}\\limits^2", "2\n∑\n1"),
            // TS draws a space before the fraction for the directive (`parity/deviations/P2-latex-inline.md`).
            ("\\displaystyle \\frac{a}{b} \\textstyle c \\scriptstyle d", " a\n─── cd\n b"),
        ] {
            assert_eq!(display(source), expected, "{source:?}");
        }
    }
}

#[test]
fn styled_atoms_keep_their_meaning() {
    for (source, expected) in [
        ("a\\not\\mathbf{=}b", "a ≠ b"),
        ("x\\not\\mathrm{\\in}S", "x ∉ S"),
        ("\\not\\textcolor{red}{\\mathit{\\subseteq}}", "⊈"),
        ("\\mathbf{x}\u{305}", "x\u{305}"),
        ("\\mathrm{x}\u{20d7}", "x\u{20d7}"),
        ("\\textcolor{red}{\\mathit{x}}\u{305}", "x\u{305}"),
        ("\\mathbb{R}+\\mathcal{F}", "ℝ + ℱ"),
        ("\\arctan x", "arctan x"),
        ("x\\pmod{n}", "x (mod n)"),
        ("\\operatorname{arg\\,max} x", "arg max x"),
        ("x % comment\n+y", "x + y"),
        ("\\mathrm{d}\\mathbf{x}+\\alpha", "dx + α"),
        ("\\hat{x}+\\overline{yz}", "^   ──\nx + yz"),
        ("\\frac{x+1}{y-1}", " x + 1\n───────\n y - 1"),
        ("\\sum_{i=1}^{n} i^2", "  n\n  ∑   i²\ni = 1"),
    ] {
        assert_eq!(display(source), expected, "{source:?}");
    }
    let layout = crate::render("\\mathbf{x+\\mathit{y}}+\\textcolor{red}{z}").unwrap();
    assert_eq!(layout.to_string(), "x + y + z");
    let style = |x: usize| &layout.cells[0][x].as_ref().unwrap().style;
    assert!(style(4).bold && style(4).italic);
    assert_eq!(style(8).color.as_deref(), Some("red"));
}

#[test]
fn graphemes_and_combining_marks_stay_whole() {
    for suffix in ["{x}", "^2", "_2", "\\alpha", "~x", "% ignored\nx"] {
        assert_eq!(parse(&format!("\u{600}{suffix}")), parse(&format!("\u{600} {suffix}")), "{suffix:?}");
    }
    let Ok(Node::Fraction { numerator, denominator, .. }) = parse("\\frac x\u{305}\u{1f469}\u{200d}\u{1f52c}") else {
        panic!()
    };
    assert_eq!((*numerator, *denominator), (sym("x\u{305}"), sym("\u{1f469}\u{200d}\u{1f52c}")));
    let Ok(Node::Scripts { base, .. }) = parse("\\alpha\u{305}^2") else { panic!() };
    assert!(matches!(*base, Node::Symbol { value, .. } if value == "α\u{305}"));
    let Ok(Node::Delimited { left, right, .. }) = parse("\\left\\langle\u{305}x\\right\\rangle\u{305}") else {
        panic!()
    };
    assert_eq!((left.as_str(), right.as_str()), ("⟨\u{305}", "⟩\u{305}"));
    assert_eq!(parse("\\%\u{305}"), Ok(Node::Symbol { value: "%\u{305}".into(), role: None }));
    assert_eq!(cells(&parse("\\begin{matrix}\u{600}&&x\\end{matrix}").unwrap()), [vec!["\u{600}", "", "x"]]);
    for (source, expected) in [
        ("a=\u{338}b", "a =\u{338} b"),
        ("x\u{305}+y", "x\u{305} + y"),
        ("x\u{305}^2", "x\u{305}²"),
        ("\\frac x\u{305}y", " x\u{305}\n───\n y"),
        ("\u{1f469}\u{200d}\u{1f52c}^2+\u{1f1e9}\u{1f1f0}", "\u{1f469}\u{200d}\u{1f52c}² + \u{1f1e9}\u{1f1f0}"),
        ("[\u{305}x]\u{305}", "[\u{305}x]\u{305}"),
        ("\\big[\u{305}x\\big]\u{305}", "[\u{305}x]\u{305}"),
        ("\\left[\u{305}x\\right]\u{305}", "[\u{305}x]\u{305}"),
        ("\\left\\langle\u{305}x\\right\\rangle\u{305}", "⟨\u{305}x⟩\u{305}"),
        ("\\%\u{305}x", "%\u{305}x"),
        ("\\{\u{305}x\\}\u{305}", "{\u{305}x}\u{305}"),
        ("\\alpha\u{305}\u{301}\\beta", "α\u{305}\u{301}β"),
        ("\\alpha\u{1d167}^2", "α\u{1d167}²"),
        ("\\#\u{fe0f}\u{20e3}^2", "#\u{fe0f}\u{20e3}²"),
        ("{\\alpha\u{305}}^2_1", "α\u{305}²₁"),
        ("\\frac\\alpha\u{305}x", " α\u{305}\n───\n x"),
        ("x^\\alpha\u{305}y", " α\u{305}\nx y"),
        ("\\sum\u{305}\\limits_1^2", "2\n∑\u{305}\n1"),
        ("\\left.\u{305}x\\right.\u{305}", "x"),
        ("\\left[\u{305}\\frac{1}{2}\\right]\u{305}", "⎡ 1 ⎤\n⎢\u{305}───⎥\u{305}\n⎣ 2 ⎦"),
        ("\\left\\{\u{305}\\frac{1}{2}\\right\\}\u{305}", "⎧ 1 ⎫\n⎨\u{305}───⎬\u{305}\n⎩ 2 ⎭"),
        ("\\|x\\|", "║x║"),
        ("\\left\\|x\\right\\|", "║x║"),
        ("\\left\\|\\frac{1}{2}\\right\\|", "║ 1 ║\n║───║\n║ 2 ║"),
        ("|x|", "|x|"),
        ("\\left|x\\right|", "│x│"),
        ("\\left.x\\right\\|", "x║"),
        ("\\left\\.x\\right\\.", "x"),
        ("x\\.", "x"),
    ] {
        assert_eq!(display(source), expected, "{source:?}");
    }
}

#[test]
fn malformed_input_fails() {
    let deep =
        |prefix: &str, middle: &str, suffix: &str| format!("{}{middle}{}", prefix.repeat(257), suffix.repeat(257));
    for source in [
        "\\unknown",
        "\\constructor",
        "\\toString",
        "\\left\\unknown x\\right)",
        "\\left(x\\right\\unknown",
        "\\big\\unknown",
        "\\left(x\\middle\\unknown y\\right)",
        "a}b",
        "\\frac}",
        "\\not}",
        "\\end{matrix}",
        "\\begin{unknown}x",
        "\\begin{matrix}x}",
        "\\begin{matrix}&}",
        "\\begin{matrix}1\\end{pmatrix}",
        "\\begin{array}x",
        "\\begin{array}{}x",
        "\\begin{array}{||}x",
        "\\begin{array}{p{2cm}}x",
        "\\begin{array}{*{2}{c}}x",
        "\\begin{array}{c@{}c}x",
        "\\begin{array}{lXr}x",
        "\\cfrac[c]12",
        "\\cfrac[lr]12",
        "\\cfrac[l{1}{2}",
        "\\cfrac[l\n",
        "\\begin{array}{% comment\n}",
        "\\displaylines[l]{x}",
        "\\left(x\\right}",
        "\\frac",
        "\\frac{1}{",
        "x^",
        "x^\\displaystyle",
        "\\left(x",
        "\\left(x\\right",
        "\\left(x\\rightfoo",
        "\\sqrt[3",
        "\\text{abc",
        "\\overbrace{",
        "\\mathbb",
        "\\textcolor{red}{",
        "\\displaylines{a\\\\b",
        "\\begin{matrix}1&&",
        "\\cfrac[",
        "{ab",
        "\\left[\u{305}x",
        "\\sqrt[\\frac{1}{2}",
    ] {
        assert!(parse(source).is_err(), "{source:?} parsed");
    }
    // 256 levels of commands take about 4 MB of a debug build's stack: the main thread's 8 MB, where the TUI parses,
    // not a test thread's 2 MB.
    let deep = [
        deep("{", "", "}"),
        deep("\\frac", "x", ""),
        deep("\\mathbb{", "x", "}"),
        deep("\\displaylines{", "x", "}"),
        deep("\\color{red}", "x", ""),
        deep("\\text{", "", "}"),
    ];
    let parsed = std::thread::Builder::new()
        .stack_size(8 << 20)
        .spawn(move || deep.iter().map(|source| parse(source).is_err()).collect::<Vec<_>>());
    assert_eq!(parsed.unwrap().join().unwrap(), [true; 6]);
    assert_eq!(parse(&format!("{}{}", "{".repeat(256), "}".repeat(256))), Ok(EMPTY));
    assert_eq!(parse(&format!("{}x{}", "{".repeat(255), "}".repeat(255))), Ok(sym("x")));
}

#[test]
fn empty_scripts_add_no_geometry() {
    let text = |value: &str| Node::Text(value.into());
    let fraction =
        Node::Fraction { numerator: Box::new(text("1")), denominator: Box::new(text("2")), bar: true, align: None };
    let bases = [
        text("x"),
        fraction,
        Node::Root { body: Box::new(text("x")), index: None },
        Node::Matrix { rows: vec![vec![text("a")], vec![text("b")]], environment: Environment::Pmatrix, columns: None },
        Node::Brace { body: Box::new(text("abcd")), over: true },
        Node::Brace { body: Box::new(text("abcd")), over: false },
        Node::Operator { value: "∑".into(), limits: true },
    ];
    let empties = [EMPTY, text(""), Node::Color { color: "red".into(), body: Box::new(text("")) }];
    let options = Options { display: false, ..Options::default() };
    let draw = |node: Node| layout::layout(&node, &options).unwrap();
    for base in &bases {
        for empty in &empties {
            let scripts = |superscript: Option<&Node>, subscript: Option<&Node>| Node::Scripts {
                base: Box::new(base.clone()),
                superscript: superscript.cloned().map(Box::new),
                subscript: subscript.cloned().map(Box::new),
            };
            for (superscript, subscript) in [(Some(empty), None), (None, Some(empty)), (Some(empty), Some(empty))] {
                assert_eq!(draw(scripts(superscript, subscript)), draw(base.clone()), "{base:?} {empty:?}");
            }
            let q = text("q");
            assert_eq!(draw(scripts(Some(empty), Some(&q))), draw(scripts(None, Some(&q))), "{base:?} {empty:?}");
        }
    }
}

#[test]
fn inline_math_takes_one_row() {
    for (source, expected) in [
        ("x^2", "x²"),
        ("E = mc^2", "E = mc²"),
        ("a_n + b_{ij}", "aₙ + bᵢⱼ"),
        ("\\alpha + \\beta = \\gamma", "α + β = γ"),
        ("x^{ab}", "xᵃᵇ"),
        ("e^{i\\pi}", "e^(iπ)"),
        ("x_{\\alpha}", "x_α"),
        ("\\frac{a}{b}", "a/b"),
        ("\\frac{1}{2}", "1/2"),
        ("\\frac{x+1}{y}", "(x + 1)/y"),
        ("\\frac{1}{1+\\frac{1}{x}}", "1/(1 + 1/x)"),
        ("\\sqrt{2}", "√2"),
        ("\\sqrt{x+1}", "√(x + 1)"),
        ("\\sqrt[3]{x}", "∛x"),
        ("\\sqrt[n]{x}", "ⁿ√x"),
        ("\\sum_{i=1}^{n} i^2", "∑ⁿᵢ₌₁ i²"),
        ("\\sum\\limits_{i=1}^{n} i", "∑ⁿᵢ₌₁ i"),
        ("\\int_0^1 f(x)\\,dx", "∫¹₀ f(x)dx"),
        ("\\lim_{x \\to 0}", "lim_(x → 0)"),
        ("\\hat{x}", "x\u{302}"),
        ("\\vec{v} \\cdot \\bar{u}", "v\u{20d7} · u\u{304}"),
        ("\\overline{AB}", "A\u{305}B\u{305}"),
        ("\\hat{\\frac{a}{b}}", "(a/b)^"),
        ("\\mathbb{R}^n", "ℝⁿ"),
        ("\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}", "(a, b; c, d)"),
        ("\\begin{aligned}x &= 1 \\\\ y &= 2\\end{aligned}", "x = 1; y = 2"),
        ("\\binom{n}{k}", "(n k)"),
        ("\\overset{def}{=}", "=ᵈᵉᶠ"),
        ("\\underbrace{a+b}_{n}", "a + bₙ"),
        ("\\left(\\frac{a}{b}\\right)", "(a/b)"),
        ("f'(x) \\le \\infty", "f'(x) ≤ ∞"),
    ] {
        assert_eq!(inline(source), expected, "{source:?}");
    }
    // Styles stay: relations bold, as display math draws them.
    let line = crate::inline_line("a \\le \\mathit{b}").unwrap();
    assert!(line.iter().any(|span| span.text.contains('≤') && span.bold), "{line:?}");
    assert!(line.iter().any(|span| span.text == "b" && span.italic), "{line:?}");
    assert!(line.iter().all(|span| span.fg.is_none()), "{line:?}");
    // TeX that does not parse shows as typed: the renderer returns nothing.
    for source in ["\\frac{1}{", "x^", "\\unknown", "", " "] {
        assert_eq!(crate::inline_line(source), None, "{source:?}");
    }
}

#[test]
fn accents_on_styled_text() {
    let node = parse("\\hat{\\mathbf{x}}").unwrap();
    let Node::Accent { accent: Accent::Hat, .. } = &node else { panic!() };
    assert_eq!(inline("\\hat{\\mathbf{x}}"), "x\u{302}");
    assert_eq!(inline("\\tilde{\\mathbb{R}}"), "ℝ\u{303}");
}
