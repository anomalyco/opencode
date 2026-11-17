//! Bytecode: a compact stack-machine instruction set and compiled function prototypes.

use std::rc::Rc;

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
    This,
    Callee,
    Arguments,
    Rest(u32),

    GetProp(Atom),
    SetProp(Atom),
    GetElem,
    SetElem,
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
    Inc,
    Dec,
    ToStr,
    Concat(u32),
    /// `local += pop()` in statement position, appending in place to a string only this local holds.
    AddLocal(u32),
    /// `local++` on a plain local in statement position.
    IncLocal(u32),

    Jump(u32),
    JumpIfFalse(u32),
    JumpIfTrue(u32),
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
    Yield,

    Throw,
    PushCatch(u32),
    PushFinally(u32),
    PopTry,

    GetIter(u32),
    IterNext(u32, u32),
    /// Like `IterNext`, but pushes the iterator's completion value before jumping, for `yield*`.
    DelegateNext(u32, u32),
    IterStep(u32),
    IterRest(u32),
    IterClose(u32),
    IterCloseQuiet(u32),
    ForIn(u32),
}

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
    pub ncells: u32,
    pub captures: Vec<Capture>,
    pub is_async: bool,
    pub is_arrow: bool,
    pub is_program: bool,
    /// Keeps arguments beyond `nparams` for rest parameters and `arguments`.
    pub needs_extra: bool,
}

pub struct Program {
    pub protos: Vec<Rc<FuncProto>>,
    pub consts: Vec<crate::value::Value>,
    /// Global names referenced by `GetGlobal`, by slot.
    pub globals: Vec<Atom>,
}
