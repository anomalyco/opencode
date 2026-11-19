//! Bytecode: a compact stack-machine instruction set and compiled function prototypes.

use std::sync::Arc;

use crate::object::Atom;

/// One instruction. Operands are slot, constant, atom or jump-target indexes.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Op {
    Nop,
    Pop,
    Dup,
    /// `a b` -> `a b a b`
    Dup2,
    /// `a b` -> `b a`
    Swap,
    /// `a b c` -> `c a b`
    Rot3,
    /// `a b c` -> `b c a`
    Rot3Back,
    Undef,
    Null,
    True,
    False,
    Uninit,
    Int(i32),
    Const(u32),

    GetLocal(u32),
    /// Two `GetLocal`s.
    GetLocal2(u32, u32),
    SetLocal(u32),
    /// Reads a local that may be in its temporal dead zone; the second operand is the name's atom.
    GetLocalChk(u32, Atom),
    /// Allocates a fresh closure cell into a local slot; the cell instructions take that slot.
    NewCell(u32),
    GetCell(u32),
    GetCellChk(u32, Atom),
    SetCell(u32),
    GetUpval(u32),
    GetUpvalChk(u32, Atom),
    SetUpval(u32),
    GetGlobal(u32),
    TypeofGlobal(u32),
    ThrowConst(Atom),
    ThrowRef(Atom),
    /// Throws a `TypeError` with a constant message, for syntax that is only rejected when it runs.
    ThrowType(u32),
    /// Throws the `UnsupportedSyntax` `SyntaxError` for the syntax whose ESTree node type is the string constant: the
    /// reference compiles unsupported syntax to a throw where it stands, so code that never reaches it still runs.
    ThrowUnsupported(u32),
    /// Throws a `SyntaxError` with a constant message, for syntax that is only rejected when it runs.
    ThrowSyntax(u32),
    This,
    Callee,
    Arguments,
    Rest(u32),

    GetProp(Atom),
    SetProp(Atom),
    GetElem,
    SetElem,
    /// A destructuring pattern's read of `key`: a member read that lets a promise's missing key read as undefined.
    DestructProp(Atom),
    /// `obj key` -> `value`: [`Op::DestructProp`] with a key that `ToKey` made.
    DestructElem,
    /// `obj` -> `value`: the read of a member an assignment or update then writes, which fails first unless the member
    /// can be written (`Vm::check_writable`).
    GetPropW(Atom),
    /// `obj key` -> `obj key`: a computed member's key as a write target (`Vm::write_key`).
    WriteKey,
    /// `obj` -> `f obj`
    GetMethod(Atom),
    DelProp(Atom),
    DelElem,
    In,
    InstanceOf,
    DefineField(Atom),
    DefineElem,
    NewObject,
    NewArray(u32),
    ArrayPush,
    ArraySpread,
    ObjectSpread,
    /// `src k1..kn` -> `rest`
    ObjRest(u32),
    RequireCoercible,
    /// ToPropertyKey on the top, so a key converts once when it is both read and written.
    ToKey,

    Add,
    Sub,
    Mul,
    Div,
    Mod,
    Pow,
    BitAnd,
    BitOr,
    BitXor,
    Shl,
    Shr,
    UShr,
    Eq,
    Ne,
    StrictEq,
    StrictNe,
    Lt,
    Le,
    Gt,
    Ge,
    /// A binary operator whose right operand is an integer immediate.
    ArithI(Arith, i32),
    Neg,
    ToNumber,
    ToNumeric,
    Not,
    BitNot,
    Typeof,
    /// Pops the pattern and flags strings, pushes a new RegExp.
    RegExp,
    Inc,
    Dec,
    ToStr,
    Concat(u32),
    /// Pushes the strings array of a tagged template site, made once per run.
    Template(u32),
    /// `local += pop()` in statement position, appending in place to a string only this local holds.
    AddLocal(u32),
    /// `local++` on a plain local in statement position.
    IncLocal(u32),

    Jump(u32),
    JumpIfFalse(u32),
    JumpIfTrue(u32),
    /// A comparison fused with the `JumpIfFalse` after it: `a b` -> ``, jumping when `a op b` is false.
    JumpUnless(Arith, u32),
    /// `JumpUnless` with an integer immediate as the right operand: `a` -> ``.
    JumpUnlessI(Arith, i32, u32),
    JumpIfFalseKeep(u32),
    JumpIfTrueKeep(u32),
    JumpIfNotNullishKeep(u32),
    JumpIfNotUndef(u32),
    /// If the top is nullish, replace it with `undefined` and jump.
    OptChain(u32),
    /// If the callee under the receiver is nullish, replace both with `undefined` and jump.
    OptCall(u32),

    Closure(u32),
    Call(u32),
    CallSpread,
    New(u32),
    NewSpread,
    Return,
    GeneratorStart,
    Await,
    /// Suspends a generator. `next(v)` resumes at the operand with `v` pushed; `return(v)` resumes just after the
    /// `yield`, at its inline return path, with `v` pushed; `throw(e)` throws at the `yield`.
    Yield(u32),
    /// A `yield` whose result is unused: `next` resumes it without pushing.
    YieldDrop(u32),
    /// The `yield` of a `yield*`: like `Yield`, but `throw(e)` resumes two instructions after it with `e` pushed.
    YieldStar(u32),

    Throw,
    PushCatch(u32),
    PushFinally(u32),
    PopTry,

    /// Opens an iterator into a slot; the context (`ITER_*`) words the error for a value that is not iterable.
    GetIter(u32, u8),
    IterNext(u32, u32),
    /// One `yield*` step: `received` -> `result`, calling the iterator's `next`, `throw` or `return` (the flag's low
    /// bits 0, 1, 2) with it. Jumps with `received` when `throw` or `return` is missing. Without the async flag, an
    /// iterator the VM runs itself skips the result: it pushes the value and continues after the `DelegateResult`
    /// that follows, or at that instruction's target when done.
    DelegateCall(u32, u8, u32),
    /// `result` -> `value`, jumping when the iterator result is done.
    DelegateResult(u32, u8),
    /// Opens an async iterator into a slot: `Symbol.asyncIterator`, or a sync iterator adapted to async; the
    /// context is `ITER_FOR_AWAIT` or `ITER_DELEGATE`.
    GetAsyncIter(u32, u8),
    /// Pushes the result of calling the iterator's `return()`, or jumps when it has none.
    AsyncClose(u32, u32),
    /// Throws a `TypeError` unless the top is an object.
    CheckObject,
    IterStep(u32),
    IterRest(u32),
    IterClose(u32),
    IterCloseQuiet(u32),
    ForIn(u32),
}

pub const ITER_FOR_OF: u8 = 0;
pub const ITER_DESTRUCTURE: u8 = 1;
pub const ITER_DELEGATE: u8 = 2;
pub const ITER_SPREAD: u8 = 3;
pub const ITER_FOR_AWAIT: u8 = 4;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Arith {
    Add,
    Sub,
    Mul,
    Div,
    Mod,
    Lt,
    Le,
    Gt,
    Ge,
    StrictEq,
    StrictNe,
}

impl Arith {
    pub fn is_comparison(self) -> bool {
        !matches!(
            self,
            Arith::Add | Arith::Sub | Arith::Mul | Arith::Div | Arith::Mod
        )
    }

    pub fn of(op: Op) -> Option<Arith> {
        Some(match op {
            Op::Add => Arith::Add,
            Op::Sub => Arith::Sub,
            Op::Mul => Arith::Mul,
            Op::Div => Arith::Div,
            Op::Mod => Arith::Mod,
            Op::Lt => Arith::Lt,
            Op::Le => Arith::Le,
            Op::Gt => Arith::Gt,
            Op::Ge => Arith::Ge,
            Op::StrictEq => Arith::StrictEq,
            Op::StrictNe => Arith::StrictNe,
            _ => return None,
        })
    }
}

#[derive(Clone, Copy, Debug)]
pub enum Capture {
    /// A cell of the enclosing frame.
    Cell(u32),
    /// An upvalue of the enclosing closure.
    Upval(u32),
}

#[derive(Debug)]
pub struct FuncProto {
    pub name: Atom,
    pub code: Vec<Op>,
    /// Source offset of each instruction, for diagnostics.
    pub pos: Vec<u32>,
    pub nparams: u32,
    pub length: u32,
    pub nlocals: u32,
    pub captures: Vec<Capture>,
    pub is_async: bool,
    pub is_generator: bool,
    pub is_arrow: bool,
    pub is_program: bool,
    /// Keeps arguments beyond `nparams` for rest parameters and `arguments`.
    pub needs_extra: bool,
    /// How each call or `new` names its callee in errors (`o.f`, `f(...)`), by the instruction's index, ascending.
    /// A callee that cannot be named is not listed.
    pub callees: Vec<(u32, Box<str>)>,
    /// The source offsets of the object and the key of each member instruction whose errors may point at them
    /// instead of at the member, by the instruction's index, ascending.
    pub sites: Vec<(u32, [u32; 2])>,
}

impl FuncProto {
    /// The name of the callee of the call or `new` instruction at `at`.
    pub fn callee(&self, at: usize) -> Option<&str> {
        let i = self
            .callees
            .binary_search_by_key(&(at as u32), |(pc, _)| *pc)
            .ok()?;
        Some(&self.callees[i].1)
    }

    /// Where an error the instruction at `at` raised points, for an error that names the part `site` of its member
    /// expression; `None` when the instruction has no member site.
    pub fn site(&self, at: usize, site: Site) -> Option<u32> {
        let i = self
            .sites
            .binary_search_by_key(&(at as u32), |(pc, _)| *pc)
            .ok()?;
        match site {
            Site::Instruction => None,
            Site::Object => Some(self.sites[i].1[0]),
            Site::Key => Some(self.sites[i].1[1]),
        }
    }
}

/// The part of a member expression an error points at, as the reference locates each failure at a node: a base that
/// cannot be read at the object, a namespace path's non-string key at the key, anything else at the instruction.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Site {
    #[default]
    Instruction,
    Object,
    Key,
}

pub struct Program {
    pub protos: Vec<Arc<FuncProto>>,
    pub consts: Vec<crate::value::Value>,
    /// Global names referenced by `GetGlobal`, by slot.
    pub globals: Vec<Atom>,
    /// The strings of each tagged template site, for `Template`.
    pub templates: Vec<TemplateSite>,
}

/// A tagged template's text: each part cooked (`None` for an invalid escape) and raw, as string constants.
pub struct TemplateSite {
    pub cooked: Vec<Option<crate::value::Value>>,
    pub raw: Vec<crate::value::Value>,
}
