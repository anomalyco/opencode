//! Parses with oxc, resolves bindings with oxc_semantic, rejects syntax outside the subset, and emits bytecode.

use std::rc::Rc;

use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_ast_visit::{Visit, walk};
use oxc_parser::{ParseOptions, Parser};
use oxc_semantic::{AstNodes, Scoping, SemanticBuilder};
use oxc_span::{GetSpan, SourceType};
use oxc_syntax::operator::{
    AssignmentOperator, BinaryOperator, LogicalOperator, UnaryOperator, UpdateOperator,
};
use oxc_syntax::scope::ScopeId;
use oxc_syntax::symbol::{SymbolFlags, SymbolId};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::DiagnosticKind;
use crate::bytecode::{Arith, Capture, FuncProto, Op, Program};
use crate::strings::{Atom, Strings};
use crate::value::{Value, num_to_string};

pub struct CompileError {
    pub kind: DiagnosticKind,
    pub message: String,
    pub offset: Option<u32>,
}

type R<T> = Result<T, CompileError>;

/// Deepest syntactic nesting a program may have; it bounds the recursion of analysis and compilation.
const MAX_NESTING: u32 = 2_000;
/// Largest program accepted, which bounds the parser's own recursion.
const MAX_SOURCE_BYTES: usize = 256 * 1024;

pub fn compile(source: &str, atoms: &mut Strings) -> R<Program> {
    if source.len() > MAX_SOURCE_BYTES {
        return Err(CompileError {
            kind: DiagnosticKind::ParseError,
            message: format!("Program is larger than {MAX_SOURCE_BYTES} bytes."),
            offset: None,
        });
    }
    if source.trim().is_empty() {
        return Err(CompileError {
            kind: DiagnosticKind::ParseError,
            message: "Source is empty.".into(),
            offset: None,
        });
    }
    let allocator = Allocator::default();
    let options = ParseOptions {
        allow_return_outside_function: true,
        preserve_parens: false,
        ..ParseOptions::default()
    };
    let parsed = Parser::new(&allocator, source, SourceType::mjs())
        .with_options(options)
        .parse();
    if let Some(d) = parsed.diagnostics.errors().next() {
        return Err(parse_error(d));
    }
    if parsed.fatal_error {
        return Err(CompileError {
            kind: DiagnosticKind::ParseError,
            message: "Unexpected token.".into(),
            offset: None,
        });
    }
    let program = &parsed.program;
    let mut depth = DepthCheck {
        depth: 0,
        deepest: None,
    };
    depth.visit_program(program);
    if let Some(offset) = depth.deepest {
        return Err(CompileError {
            kind: DiagnosticKind::ParseError,
            message: format!("SyntaxError: Program is nested more than {MAX_NESTING} levels deep."),
            offset: Some(offset),
        });
    }
    let semantic = SemanticBuilder::new()
        .with_check_syntax_error(true)
        .with_build_nodes(true)
        .build(program);
    if let Some(d) = semantic.diagnostics.errors().next() {
        return Err(parse_error(d));
    }
    let scoping = semantic.semantic.scoping();
    let mut c = Compiler::new(scoping, semantic.semantic.nodes(), atoms);
    c.compute_captured();
    c.compile_program(program)?;
    Ok(Program {
        protos: c.protos.into_iter().map(Rc::new).collect(),
        consts: c.consts,
        globals: c.globals,
    })
}

/// Measures nesting without recursing past the limit.
struct DepthCheck {
    depth: u32,
    deepest: Option<u32>,
}

impl DepthCheck {
    fn enter(&mut self, offset: u32) -> bool {
        self.depth += 1;
        if self.depth > MAX_NESTING {
            self.deepest.get_or_insert(offset);
            return false;
        }
        true
    }
}

impl<'a> Visit<'a> for DepthCheck {
    fn visit_expression(&mut self, it: &Expression<'a>) {
        if self.enter(it.span().start) {
            walk::walk_expression(self, it);
        }
        self.depth -= 1;
    }

    fn visit_statement(&mut self, it: &Statement<'a>) {
        if self.enter(it.span().start) {
            walk::walk_statement(self, it);
        }
        self.depth -= 1;
    }

    fn visit_binding_pattern(&mut self, it: &BindingPattern<'a>) {
        if self.enter(it.span().start) {
            walk::walk_binding_pattern(self, it);
        }
        self.depth -= 1;
    }

    fn visit_assignment_target(&mut self, it: &AssignmentTarget<'a>) {
        if self.enter(it.span().start) {
            walk::walk_assignment_target(self, it);
        }
        self.depth -= 1;
    }
}

fn parse_error(d: &oxc_diagnostics::OxcDiagnostic) -> CompileError {
    CompileError {
        kind: DiagnosticKind::ParseError,
        message: format!("SyntaxError: {}", d.message),
        offset: d.labels.first().map(|l| l.offset()),
    }
}

fn unsupported(what: &str, span: oxc_span::Span) -> CompileError {
    CompileError {
        kind: DiagnosticKind::UnsupportedSyntax,
        message: format!(
            "{what} is not supported. This is a restricted JavaScript-like language: use plain functions and data objects instead."
        ),
        offset: Some(span.start),
    }
}

#[derive(Clone, Copy)]
enum Store {
    Local(u32),
    Cell(u32),
}

#[derive(Clone, Copy)]
struct SymInfo {
    depth: usize,
    store: Store,
    tdz: bool,
    is_const: bool,
    decl_end: u32,
    switch_scoped: bool,
    name: Atom,
}

enum Control<'a> {
    Loop {
        labels: Vec<&'a str>,
        breaks: Vec<usize>,
        continues: Vec<usize>,
        iter: Option<u32>,
    },
    Label {
        label: &'a str,
        breaks: Vec<usize>,
    },
    Switch {
        labels: Vec<&'a str>,
        breaks: Vec<usize>,
    },
    Try,
    Finally {
        body: &'a BlockStatement<'a>,
    },
}

struct FnState<'a> {
    code: Vec<Op>,
    pos: Vec<u32>,
    nlocals: u32,
    ncells: u32,
    captures: Vec<Capture>,
    upval_of: FxHashMap<SymbolId, u32>,
    controls: Vec<Control<'a>>,
    is_arrow: bool,
    needs_extra: bool,
    /// The instruction index a jump may land on; no instruction fuses across it.
    barrier: usize,
}

struct Compiler<'a, 's> {
    scoping: &'s Scoping,
    nodes: &'s AstNodes<'a>,
    atoms: &'s mut Strings,
    fns: Vec<FnState<'a>>,
    syms: FxHashMap<SymbolId, SymInfo>,
    captured: FxHashSet<SymbolId>,
    protos: Vec<FuncProto>,
    consts: Vec<Value>,
    str_consts: FxHashMap<String, u32>,
    num_consts: FxHashMap<u64, u32>,
    globals: Vec<Atom>,
    global_of: FxHashMap<Atom, u32>,
    pos: u32,
    chains: Vec<Vec<usize>>,
    switch_scopes: FxHashSet<ScopeId>,
}

#[derive(Clone, Copy, PartialEq)]
enum BindMode {
    /// A declaration's initialization: no TDZ check, `const` allowed.
    Init,
    /// A plain assignment.
    Assign,
}

impl<'a, 's> Compiler<'a, 's> {
    fn new(scoping: &'s Scoping, nodes: &'s AstNodes<'a>, atoms: &'s mut Strings) -> Self {
        Compiler {
            scoping,
            nodes,
            atoms,
            fns: Vec::new(),
            syms: FxHashMap::default(),
            captured: FxHashSet::default(),
            protos: Vec::new(),
            consts: Vec::new(),
            str_consts: FxHashMap::default(),
            num_consts: FxHashMap::default(),
            globals: Vec::new(),
            global_of: FxHashMap::default(),
            pos: 0,
            chains: Vec::new(),
            switch_scopes: FxHashSet::default(),
        }
    }

    fn fn_scope_of(&self, mut scope: ScopeId) -> ScopeId {
        loop {
            let flags = self.scoping.scope_flags(scope);
            if flags.is_function() || flags.is_top() {
                return scope;
            }
            match self.scoping.scope_parent_id(scope) {
                Some(p) => scope = p,
                None => return scope,
            }
        }
    }

    /// A binding is captured when any reference to it sits in a different function than its declaration.
    fn compute_captured(&mut self) {
        let mut memo: FxHashMap<ScopeId, ScopeId> = FxHashMap::default();
        for sym in self.scoping.symbol_ids() {
            let decl_scope = self.scoping.symbol_scope_id(sym);
            let decl_fn = *memo
                .entry(decl_scope)
                .or_insert_with(|| self.fn_scope_of(decl_scope));
            for rid in self.scoping.get_resolved_reference_ids(sym) {
                let rs = self.scoping.get_reference(*rid).scope_id();
                let ref_fn = match memo.get(&rs) {
                    Some(f) => *f,
                    None => {
                        let f = self.fn_scope_of(rs);
                        memo.insert(rs, f);
                        f
                    }
                };
                if ref_fn != decl_fn {
                    self.captured.insert(sym);
                    break;
                }
            }
        }
    }

    // ---------- emission helpers ----------

    fn f(&mut self) -> &mut FnState<'a> {
        self.fns.last_mut().expect("function state")
    }

    fn emit(&mut self, op: Op) -> usize {
        let pos = self.pos;
        let f = self.f();
        // Peephole fusion with the previous instruction, unless a jump lands between the two.
        if f.barrier != f.code.len()
            && let Some(prev) = f.code.last_mut()
        {
            let fused = match (*prev, op) {
                (Op::Int(k), op) => Arith::of(op).map(|a| Op::ArithI(a, k)),
                (Op::GetLocal(a), Op::GetLocal(b)) => Some(Op::GetLocal2(a, b)),
                _ => None,
            };
            if let Some(fused) = fused {
                *prev = fused;
                return f.code.len() - 1;
            }
        }
        f.code.push(op);
        f.pos.push(pos);
        f.code.len() - 1
    }

    fn here(&mut self) -> u32 {
        let f = self.f();
        f.barrier = f.code.len();
        f.code.len() as u32
    }

    fn patch(&mut self, at: usize) {
        let target = self.here();
        let op = &mut self.f().code[at];
        *op = match *op {
            Op::Jump(_) => Op::Jump(target),
            Op::JumpIfFalse(_) => Op::JumpIfFalse(target),
            Op::JumpIfTrue(_) => Op::JumpIfTrue(target),
            Op::JumpIfFalseKeep(_) => Op::JumpIfFalseKeep(target),
            Op::JumpIfTrueKeep(_) => Op::JumpIfTrueKeep(target),
            Op::JumpIfNotNullishKeep(_) => Op::JumpIfNotNullishKeep(target),
            Op::JumpIfNotUndef(_) => Op::JumpIfNotUndef(target),
            Op::OptChain(_) => Op::OptChain(target),
            Op::OptCall(_) => Op::OptCall(target),
            Op::PushCatch(_) => Op::PushCatch(target),
            Op::PushFinally(_) => Op::PushFinally(target),
            Op::IterNext(s, _) => Op::IterNext(s, target),
            Op::DelegateNext(s, _) => Op::DelegateNext(s, target),
            other => other,
        };
    }

    fn new_local(&mut self) -> u32 {
        let f = self.f();
        f.nlocals += 1;
        f.nlocals - 1
    }

    fn new_cell(&mut self) -> u32 {
        let f = self.f();
        f.ncells += 1;
        f.ncells - 1
    }

    fn atom(&mut self, s: &str) -> Atom {
        self.atoms.intern(s)
    }

    fn str_const(&mut self, s: &str) -> u32 {
        if let Some(i) = self.str_consts.get(s) {
            return *i;
        }
        let i = self.consts.len() as u32;
        let id = self.atoms.alloc(s.to_owned());
        self.consts.push(Value::Str(id));
        self.str_consts.insert(s.to_owned(), i);
        i
    }

    fn push_num(&mut self, n: f64) {
        if n.fract() == 0.0 && n.abs() <= i32::MAX as f64 && !(n == 0.0 && n.is_sign_negative()) {
            self.emit(Op::Int(n as i32));
            return;
        }
        let bits = n.to_bits();
        let i = match self.num_consts.get(&bits) {
            Some(i) => *i,
            None => {
                let i = self.consts.len() as u32;
                self.consts.push(Value::Num(n));
                self.num_consts.insert(bits, i);
                i
            }
        };
        self.emit(Op::Const(i));
    }

    fn push_str(&mut self, s: &str) {
        let i = self.str_const(s);
        self.emit(Op::Const(i));
    }

    fn global_slot(&mut self, name: &str) -> u32 {
        let a = self.atom(name);
        if let Some(s) = self.global_of.get(&a) {
            return *s;
        }
        let s = self.globals.len() as u32;
        self.globals.push(a);
        self.global_of.insert(a, s);
        s
    }

    fn depth(&self) -> usize {
        self.fns.len() - 1
    }

    // ---------- scopes and bindings ----------

    /// Allocates storage for a scope's bindings and returns them in declaration order.
    fn declare_scope(&mut self, scope: ScopeId) -> Vec<SymbolId> {
        let mut syms: Vec<SymbolId> = self.scoping.get_bindings(scope).values().copied().collect();
        syms.sort();
        let switch_scoped = self.switch_scopes.contains(&scope);
        for s in &syms {
            if self.syms.contains_key(s) {
                continue;
            }
            self.declare_symbol(*s, None, switch_scoped);
        }
        syms
    }

    fn declare_symbol(&mut self, s: SymbolId, param_slot: Option<u32>, switch_scoped: bool) {
        let flags = self.scoping.symbol_flags(s);
        let store = if self.captured.contains(&s) {
            Store::Cell(self.new_cell())
        } else {
            Store::Local(param_slot.unwrap_or_else(|| self.new_local()))
        };
        let tdz = flags.intersects(SymbolFlags::BlockScopedVariable | SymbolFlags::ConstVariable)
            && !flags.contains(SymbolFlags::Function);
        let decl_end = self.decl_end(s);
        let name = self.atoms.intern(self.scoping.symbol_name(s));
        self.syms.insert(
            s,
            SymInfo {
                depth: self.depth(),
                store,
                tdz,
                is_const: flags.contains(SymbolFlags::ConstVariable),
                decl_end,
                switch_scoped,
                name,
            },
        );
    }

    fn decl_end(&self, s: SymbolId) -> u32 {
        // The end of the whole declaration, so references from inside the initializer stay checked.
        self.nodes
            .kind(self.scoping.symbol_declaration(s))
            .span()
            .end
    }

    /// Emits a scope's entry: fresh cells, TDZ markers, `var` initial values.
    fn init_scope(&mut self, syms: &[SymbolId]) {
        for s in syms {
            let Some(info) = self.syms.get(s).copied() else {
                continue;
            };
            if info.depth != self.depth() {
                continue;
            }
            let flags = self.scoping.symbol_flags(*s);
            if flags.contains(SymbolFlags::CatchVariable) {
                continue;
            }
            match info.store {
                Store::Cell(c) => {
                    self.emit(Op::NewCell(c));
                    if !info.tdz && !flags.contains(SymbolFlags::Function) {
                        self.emit(Op::Undef);
                        self.emit(Op::SetCell(c));
                    }
                }
                Store::Local(l) => {
                    if info.tdz {
                        self.emit(Op::Uninit);
                        self.emit(Op::SetLocal(l));
                    }
                }
            }
        }
    }

    fn hoist_functions(&mut self, stmts: &'a [Statement<'a>]) -> R<()> {
        for st in stmts {
            if let Statement::FunctionDeclaration(f) = st {
                self.closure_for_function(f, None)?;
                let id = f.id.as_ref().and_then(|id| id.symbol_id.get());
                match id {
                    Some(s) => self.store_symbol(s, BindMode::Init, f.span.start)?,
                    None => {
                        self.emit(Op::Pop);
                    }
                }
            }
        }
        Ok(())
    }

    fn needs_check(&self, info: &SymInfo, ref_pos: u32) -> bool {
        info.tdz && (info.depth != self.depth() || info.switch_scoped || ref_pos < info.decl_end)
    }

    fn resolve_upval(&mut self, depth: usize, s: SymbolId) -> R<u32> {
        if let Some(i) = self.fns[depth].upval_of.get(&s) {
            return Ok(*i);
        }
        let info = self.syms[&s];
        let cap = if depth - 1 == info.depth {
            match info.store {
                Store::Cell(c) => Capture::Cell(c),
                Store::Local(_) => {
                    return Err(CompileError {
                        kind: DiagnosticKind::ExecutionFailure,
                        message: "internal: captured binding has no cell".into(),
                        offset: Some(self.pos),
                    });
                }
            }
        } else {
            Capture::Upval(self.resolve_upval(depth - 1, s)?)
        };
        let f = &mut self.fns[depth];
        f.captures.push(cap);
        let i = f.captures.len() as u32 - 1;
        f.upval_of.insert(s, i);
        Ok(i)
    }

    fn symbol_info(&self, s: SymbolId) -> R<SymInfo> {
        self.syms.get(&s).copied().ok_or_else(|| CompileError {
            kind: DiagnosticKind::UnsupportedSyntax,
            message: format!(
                "'{}' is used before its scope is entered.",
                self.scoping.symbol_name(s)
            ),
            offset: Some(self.pos),
        })
    }

    fn load_symbol(&mut self, s: SymbolId, ref_pos: u32) -> R<()> {
        let info = self.symbol_info(s)?;
        let chk = self.needs_check(&info, ref_pos);
        if info.depth == self.depth() {
            match (info.store, chk) {
                (Store::Local(l), false) => self.emit(Op::GetLocal(l)),
                (Store::Local(l), true) => self.emit(Op::GetLocalChk(l, info.name)),
                (Store::Cell(c), false) => self.emit(Op::GetCell(c)),
                (Store::Cell(c), true) => self.emit(Op::GetCellChk(c, info.name)),
            };
        } else {
            let u = self.resolve_upval(self.depth(), s)?;
            self.emit(if chk {
                Op::GetUpvalChk(u, info.name)
            } else {
                Op::GetUpval(u)
            });
        }
        Ok(())
    }

    /// Pops the top of the stack into the binding.
    fn store_symbol(&mut self, s: SymbolId, mode: BindMode, ref_pos: u32) -> R<()> {
        let info = self.symbol_info(s)?;
        if mode == BindMode::Assign {
            if info.is_const {
                self.emit(Op::Pop);
                self.emit(Op::ThrowConst(info.name));
                return Ok(());
            }
            if self.needs_check(&info, ref_pos) {
                self.load_symbol(s, ref_pos)?;
                self.emit(Op::Pop);
            }
        }
        if info.depth == self.depth() {
            match info.store {
                Store::Local(l) => self.emit(Op::SetLocal(l)),
                Store::Cell(c) => self.emit(Op::SetCell(c)),
            };
        } else {
            let u = self.resolve_upval(self.depth(), s)?;
            self.emit(Op::SetUpval(u));
        }
        Ok(())
    }

    fn ident_symbol(&self, id: &IdentifierReference) -> Option<SymbolId> {
        id.reference_id
            .get()
            .and_then(|r| self.scoping.get_reference(r).symbol_id())
    }

    fn load_ident(&mut self, id: &IdentifierReference) -> R<()> {
        if let Some(s) = self.ident_symbol(id) {
            return self.load_symbol(s, id.span.start);
        }
        match id.name.as_str() {
            "undefined" => {
                self.emit(Op::Undef);
            }
            "arguments" if !self.f().is_arrow && self.fns.len() > 1 => {
                self.f().needs_extra = true;
                self.emit(Op::Arguments);
            }
            name => {
                let g = self.global_slot(name);
                self.emit(Op::GetGlobal(g));
            }
        }
        Ok(())
    }

    fn store_ident(&mut self, id: &IdentifierReference) -> R<()> {
        match self.ident_symbol(id) {
            Some(s) => self.store_symbol(s, BindMode::Assign, id.span.start),
            None => {
                let a = self.atom(id.name.as_str());
                self.emit(Op::Pop);
                if self.global_of.contains_key(&a) || is_builtin_global(id.name.as_str()) {
                    self.emit(Op::ThrowConst(a));
                } else {
                    self.emit(Op::ThrowRef(a));
                }
                Ok(())
            }
        }
    }

    /// A plain, initialized-for-sure local of the current function, for fused instructions.
    fn plain_local(&self, id: &IdentifierReference) -> Option<u32> {
        let s = self.ident_symbol(id)?;
        let info = self.syms.get(&s)?;
        if info.depth != self.depth() || info.is_const || self.needs_check(info, id.span.start) {
            return None;
        }
        match info.store {
            Store::Local(l) => Some(l),
            Store::Cell(_) => None,
        }
    }

    // ---------- functions ----------

    fn compile_program(&mut self, program: &'a oxc_ast::ast::Program<'a>) -> R<()> {
        self.fns.push(FnState::new(false));
        let name = self.atom("");
        let syms = match program.scope_id.get() {
            Some(scope) => self.declare_scope(scope),
            None => Vec::new(),
        };
        self.init_scope(&syms);
        self.hoist_functions(&program.body)?;
        if program.body.is_empty()
            && let Some(d) = program.directives.last()
        {
            let text = js_str(&d.expression.value);
            self.push_str(&text);
            self.emit(Op::Return);
        }
        let n = program.body.len();
        for (i, st) in program.body.iter().enumerate() {
            if i + 1 == n
                && let Statement::ExpressionStatement(e) = st
            {
                self.pos = e.span.start;
                self.expr(&e.expression)?;
                self.emit(Op::Return);
                break;
            }
            self.stmt(st)?;
        }
        self.emit(Op::Undef);
        self.emit(Op::Return);
        let f = self.fns.pop().expect("program state");
        self.protos.insert(
            0,
            FuncProto {
                name,
                code: f.code,
                pos: f.pos,
                nparams: 0,
                length: 0,
                nlocals: f.nlocals,
                ncells: f.ncells,
                captures: Vec::new(),
                is_async: true,
                is_arrow: false,
                is_program: true,
                needs_extra: false,
            },
        );
        // Closure instructions index `protos` assuming the program is not in the list; shift them.
        for p in self.protos.iter_mut() {
            for op in p.code.iter_mut() {
                if let Op::Closure(i) = op {
                    *i += 1;
                }
            }
        }
        Ok(())
    }

    fn closure_for_function(&mut self, f: &'a Function<'a>, name: Option<&str>) -> R<()> {
        if f.r#async && f.generator {
            return Err(unsupported("Async generator functions", f.span));
        }
        let Some(body) = &f.body else {
            return Err(unsupported("Function declarations without a body", f.span));
        };
        let own_name =
            f.id.as_ref()
                .map(|id| id.name.as_str())
                .or(name)
                .unwrap_or("");
        let self_sym = match f.r#type {
            FunctionType::FunctionExpression => f.id.as_ref().and_then(|id| id.symbol_id.get()),
            _ => None,
        };
        let idx = self.compile_function(FnSpec {
            name: own_name,
            params: &f.params,
            body: FnBody::Block(body),
            scope: f.scope_id.get(),
            is_async: f.r#async,
            is_generator: f.generator,
            is_arrow: false,
            self_sym,
        })?;
        self.emit(Op::Closure(idx));
        Ok(())
    }

    fn closure_for_arrow(
        &mut self,
        f: &'a ArrowFunctionExpression<'a>,
        name: Option<&str>,
    ) -> R<()> {
        let body = match &f.body {
            ArrowFunctionBody::FunctionBody(b) => FnBody::Block(b),
            other => match other.as_expression() {
                Some(e) => FnBody::Expr(e),
                None => return Err(unsupported("This arrow function body", f.span)),
            },
        };
        let idx = self.compile_function(FnSpec {
            name: name.unwrap_or(""),
            params: &f.params,
            body,
            scope: f.scope_id.get(),
            is_async: f.r#async,
            is_generator: false,
            is_arrow: true,
            self_sym: None,
        })?;
        self.emit(Op::Closure(idx));
        Ok(())
    }

    fn compile_function(&mut self, spec: FnSpec<'a, '_>) -> R<u32> {
        let saved_pos = self.pos;
        let saved_chains = std::mem::take(&mut self.chains);
        self.fns.push(FnState::new(spec.is_arrow));
        let params = spec.params;
        let nparams = params.items.len() as u32;
        self.f().nlocals = nparams;
        let length = params
            .items
            .iter()
            .take_while(|p| p.initializer.is_none())
            .count() as u32;
        if params.rest.is_some() {
            self.f().needs_extra = true;
        }
        // Simple parameters bind straight to their argument slot.
        for (i, p) in params.items.iter().enumerate() {
            if p.initializer.is_none()
                && let BindingPattern::BindingIdentifier(id) = &p.pattern
                && let Some(s) = id.symbol_id.get()
            {
                self.declare_symbol(s, Some(i as u32), false);
            }
        }
        let syms = match spec.scope {
            Some(scope) => self.declare_scope(scope),
            None => Vec::new(),
        };
        self.init_scope(&syms);
        for (i, p) in params.items.iter().enumerate() {
            if p.initializer.is_none()
                && let BindingPattern::BindingIdentifier(id) = &p.pattern
                && let Some(s) = id.symbol_id.get()
            {
                if let Some(Store::Cell(c)) = self.syms.get(&s).map(|i| i.store) {
                    self.emit(Op::GetLocal(i as u32));
                    self.emit(Op::SetCell(c));
                }
                continue;
            }
            self.pos = p.span.start;
            self.emit(Op::GetLocal(i as u32));
            if let Some(init) = &p.initializer {
                let j = self.emit(Op::JumpIfNotUndef(0));
                self.emit(Op::Pop);
                let hint = pattern_name(&p.pattern);
                self.expr_named(init, hint)?;
                self.patch(j);
            }
            self.bind_pattern(&p.pattern, BindMode::Init)?;
        }
        if let Some(rest) = &params.rest {
            self.emit(Op::Rest(nparams));
            self.bind_pattern(&rest.rest.argument, BindMode::Init)?;
        }
        if let Some(s) = spec.self_sym
            && self.syms.get(&s).is_some_and(|i| i.depth == self.depth())
        {
            self.emit(Op::Callee);
            self.store_symbol(s, BindMode::Init, 0)?;
        }
        if spec.is_generator {
            self.emit(Op::GeneratorStart);
        }
        match spec.body {
            FnBody::Block(b) => {
                self.hoist_functions(&b.statements)?;
                for st in &b.statements {
                    self.stmt(st)?;
                }
                self.emit(Op::Undef);
                self.emit(Op::Return);
            }
            FnBody::Expr(e) => {
                self.expr(e)?;
                self.emit(Op::Return);
            }
        }
        let f = self.fns.pop().expect("function state");
        self.chains = saved_chains;
        self.pos = saved_pos;
        let name = self.atom(spec.name);
        self.protos.push(FuncProto {
            name,
            code: f.code,
            pos: f.pos,
            nparams,
            length,
            nlocals: f.nlocals,
            ncells: f.ncells,
            captures: f.captures,
            is_async: spec.is_async,
            is_arrow: spec.is_arrow,
            is_program: false,
            needs_extra: f.needs_extra,
        });
        Ok(self.protos.len() as u32 - 1)
    }

    // ---------- statements ----------

    fn stmts(&mut self, stmts: &'a [Statement<'a>]) -> R<()> {
        for s in stmts {
            self.stmt(s)?;
        }
        Ok(())
    }

    fn block(&mut self, b: &'a BlockStatement<'a>) -> R<()> {
        let syms = match b.scope_id.get() {
            Some(scope) => self.declare_scope(scope),
            None => Vec::new(),
        };
        self.init_scope(&syms);
        self.hoist_functions(&b.body)?;
        self.stmts(&b.body)
    }

    fn stmt(&mut self, st: &'a Statement<'a>) -> R<()> {
        self.pos = st.span().start;
        match st {
            Statement::BlockStatement(b) => self.block(b),
            Statement::EmptyStatement(_) | Statement::DebuggerStatement(_) => Ok(()),
            Statement::ExpressionStatement(e) => self.expr_stmt(&e.expression),
            Statement::VariableDeclaration(d) => self.var_decl(d),
            Statement::FunctionDeclaration(_) => Ok(()),
            Statement::IfStatement(s) => {
                self.expr(&s.test)?;
                let j = self.emit(Op::JumpIfFalse(0));
                self.stmt(&s.consequent)?;
                match &s.alternate {
                    Some(alt) => {
                        let end = self.emit(Op::Jump(0));
                        self.patch(j);
                        self.stmt(alt)?;
                        self.patch(end);
                    }
                    None => self.patch(j),
                }
                Ok(())
            }
            Statement::ReturnStatement(r) => {
                match &r.argument {
                    Some(a) => self.expr(a)?,
                    None => {
                        self.emit(Op::Undef);
                    }
                }
                self.emit_return()
            }
            Statement::ThrowStatement(t) => {
                self.expr(&t.argument)?;
                self.emit(Op::Throw);
                Ok(())
            }
            Statement::WhileStatement(w) => self.while_loop(w, Vec::new()),
            Statement::DoWhileStatement(w) => self.do_while(w, Vec::new()),
            Statement::ForStatement(f) => self.for_loop(f, Vec::new()),
            Statement::ForOfStatement(f) => self.for_of(f, Vec::new()),
            Statement::ForInStatement(f) => self.for_in(f, Vec::new()),
            Statement::BreakStatement(b) => {
                self.jump_out(true, b.label.as_ref().map(|l| l.name.as_str()))
            }
            Statement::ContinueStatement(c) => {
                self.jump_out(false, c.label.as_ref().map(|l| l.name.as_str()))
            }
            Statement::LabeledStatement(l) => self.labeled(l),
            Statement::SwitchStatement(s) => self.switch(s, Vec::new()),
            Statement::TryStatement(t) => self.try_stmt(t),
            Statement::ClassDeclaration(c) => Err(unsupported("Classes", c.span)),
            Statement::WithStatement(w) => Err(unsupported("`with`", w.span)),
            Statement::ImportDeclaration(d) => Err(unsupported("`import`", d.span)),
            Statement::ExportAllDeclaration(d) => Err(unsupported("`export`", d.span)),
            Statement::ExportDefaultDeclaration(d) => Err(unsupported("`export`", d.span)),
            Statement::ExportNamedDeclaration(d) => Err(unsupported("`export`", d.span)),
            Statement::ExportDeclaration(d) => Err(unsupported("`export`", d.span)),
            Statement::ExportFromDeclaration(d) => Err(unsupported("`export`", d.span)),
            other => Err(unsupported("TypeScript syntax", other.span())),
        }
    }

    fn expr_stmt(&mut self, e: &'a Expression<'a>) -> R<()> {
        if let Expression::UpdateExpression(u) = e
            && u.operator == UpdateOperator::Increment
            && let SimpleAssignmentTarget::AssignmentTargetIdentifier(id) = &u.argument
            && let Some(l) = self.plain_local(id)
        {
            self.pos = u.span.start;
            self.emit(Op::IncLocal(l));
            return Ok(());
        }
        if let Expression::AssignmentExpression(a) = e
            && a.operator == AssignmentOperator::Assign
            && let AssignmentTarget::AssignmentTargetIdentifier(id) = &a.left
        {
            self.pos = a.span.start;
            self.expr_named(&a.right, Some(id.name.as_str()))?;
            return self.store_ident(id);
        }
        if let Expression::AssignmentExpression(a) = e
            && a.operator == AssignmentOperator::Addition
            && let AssignmentTarget::AssignmentTargetIdentifier(id) = &a.left
            && let Some(l) = self.plain_local(id)
        {
            self.pos = a.span.start;
            self.expr(&a.right)?;
            self.emit(Op::AddLocal(l));
            return Ok(());
        }
        self.expr(e)?;
        self.emit(Op::Pop);
        Ok(())
    }

    fn var_decl(&mut self, d: &'a VariableDeclaration<'a>) -> R<()> {
        match d.kind {
            VariableDeclarationKind::Var
            | VariableDeclarationKind::Let
            | VariableDeclarationKind::Const => {}
            _ => return Err(unsupported("`using` declarations", d.span)),
        }
        for decl in &d.declarations {
            self.pos = decl.span.start;
            match &decl.init {
                Some(init) => {
                    self.expr_named(init, pattern_name(&decl.id))?;
                    self.bind_pattern(&decl.id, BindMode::Init)?;
                }
                None => {
                    if d.kind != VariableDeclarationKind::Var {
                        self.emit(Op::Undef);
                        self.bind_pattern(&decl.id, BindMode::Init)?;
                    }
                }
            }
        }
        Ok(())
    }

    fn emit_return(&mut self) -> R<()> {
        let unwinding = self.f().controls.iter().any(|c| {
            matches!(
                c,
                Control::Try | Control::Finally { .. } | Control::Loop { iter: Some(_), .. }
            )
        });
        if !unwinding {
            self.emit(Op::Return);
            return Ok(());
        }
        let tmp = self.new_local();
        self.emit(Op::SetLocal(tmp));
        let n = self.f().controls.len();
        self.unwind_to(0, n)?;
        self.emit(Op::GetLocal(tmp));
        self.emit(Op::Return);
        Ok(())
    }

    /// Emits the cleanup for leaving controls `from..to` (innermost first).
    fn unwind_to(&mut self, from: usize, to: usize) -> R<()> {
        for i in (from..to).rev() {
            match &self.f().controls[i] {
                Control::Try => {
                    self.emit(Op::PopTry);
                }
                Control::Loop {
                    iter: Some(slot), ..
                } => {
                    let slot = *slot;
                    self.emit(Op::PopTry);
                    self.emit(Op::IterClose(slot));
                }
                Control::Finally { body } => {
                    let body: &'a BlockStatement<'a> = body;
                    self.emit(Op::PopTry);
                    let tail = self.f().controls.split_off(i);
                    let r = self.block(body);
                    self.f().controls.extend(tail);
                    r?;
                }
                _ => {}
            }
        }
        Ok(())
    }

    fn jump_out(&mut self, is_break: bool, label: Option<&str>) -> R<()> {
        let controls = &self.f().controls;
        let mut target = None;
        for (i, c) in controls.iter().enumerate().rev() {
            let hit = match (c, label) {
                (Control::Loop { .. }, None) => true,
                (Control::Switch { .. }, None) => is_break,
                (Control::Loop { labels, .. }, Some(l)) => labels.contains(&l),
                (Control::Switch { labels, .. }, Some(l)) => is_break && labels.contains(&l),
                (Control::Label { label: x, .. }, Some(l)) => is_break && *x == l,
                _ => false,
            };
            if hit {
                target = Some(i);
                break;
            }
        }
        let Some(t) = target else {
            return Err(CompileError {
                kind: DiagnosticKind::ParseError,
                message: "SyntaxError: Illegal break or continue statement".into(),
                offset: Some(self.pos),
            });
        };
        let n = self.f().controls.len();
        self.unwind_to(t + 1, n)?;
        if is_break
            && let Control::Loop {
                iter: Some(slot), ..
            } = self.f().controls[t]
        {
            self.emit(Op::PopTry);
            self.emit(Op::IterClose(slot));
        }
        let j = self.emit(Op::Jump(0));
        match &mut self.f().controls[t] {
            Control::Loop {
                breaks, continues, ..
            } => {
                if is_break {
                    breaks.push(j)
                } else {
                    continues.push(j)
                }
            }
            Control::Switch { breaks, .. } | Control::Label { breaks, .. } => breaks.push(j),
            _ => {}
        }
        Ok(())
    }

    fn push_loop(&mut self, labels: Vec<&'a str>, iter: Option<u32>) {
        self.f().controls.push(Control::Loop {
            labels,
            breaks: Vec::new(),
            continues: Vec::new(),
            iter,
        });
    }

    /// Pops the loop control, patching continues to `cont` and breaks to here.
    fn pop_loop_continues(&mut self, cont: u32) -> Vec<usize> {
        let Some(Control::Loop {
            breaks, continues, ..
        }) = self.f().controls.pop()
        else {
            return Vec::new();
        };
        for c in continues {
            if let Op::Jump(_) = self.f().code[c] {
                self.f().code[c] = Op::Jump(cont);
            }
        }
        breaks
    }

    fn while_loop(&mut self, w: &'a WhileStatement<'a>, labels: Vec<&'a str>) -> R<()> {
        let top = self.here();
        self.expr(&w.test)?;
        let exit = self.emit(Op::JumpIfFalse(0));
        self.push_loop(labels, None);
        self.stmt(&w.body)?;
        self.emit(Op::Jump(top));
        let breaks = self.pop_loop_continues(top);
        self.patch(exit);
        for b in breaks {
            self.patch(b);
        }
        Ok(())
    }

    fn do_while(&mut self, w: &'a DoWhileStatement<'a>, labels: Vec<&'a str>) -> R<()> {
        let top = self.here();
        self.push_loop(labels, None);
        self.stmt(&w.body)?;
        let cont = self.here();
        let breaks = self.pop_loop_continues(cont);
        self.expr(&w.test)?;
        self.emit(Op::JumpIfTrue(top));
        for b in breaks {
            self.patch(b);
        }
        Ok(())
    }

    fn for_loop(&mut self, f: &'a ForStatement<'a>, labels: Vec<&'a str>) -> R<()> {
        let syms = match f.scope_id.get() {
            Some(scope) => self.declare_scope(scope),
            None => Vec::new(),
        };
        self.init_scope(&syms);
        match &f.init {
            Some(ForStatementInit::VariableDeclaration(d)) => self.var_decl(d)?,
            Some(other) => {
                if let Some(e) = other.as_expression() {
                    self.expr(e)?;
                    self.emit(Op::Pop);
                }
            }
            None => {}
        }
        let per_iteration: Vec<u32> = syms
            .iter()
            .filter_map(|s| match self.syms.get(s) {
                Some(SymInfo {
                    store: Store::Cell(c),
                    depth,
                    ..
                }) if *depth == self.depth() => Some(*c),
                _ => None,
            })
            .collect();
        let top = self.here();
        let exit = match &f.test {
            Some(t) => {
                self.expr(t)?;
                Some(self.emit(Op::JumpIfFalse(0)))
            }
            None => None,
        };
        self.push_loop(labels, None);
        self.stmt(&f.body)?;
        let cont = self.here();
        let breaks = self.pop_loop_continues(cont);
        for c in &per_iteration {
            self.emit(Op::GetCell(*c));
            self.emit(Op::NewCell(*c));
            self.emit(Op::SetCell(*c));
        }
        if let Some(u) = &f.update {
            self.expr_stmt(u)?;
        }
        self.emit(Op::Jump(top));
        if let Some(e) = exit {
            self.patch(e);
        }
        for b in breaks {
            self.patch(b);
        }
        Ok(())
    }

    /// Binds the loop variable of a `for...of`/`for...in` head from the value on the stack.
    fn bind_for_left(&mut self, left: &'a ForStatementLeft<'a>, syms: &[SymbolId]) -> R<()> {
        self.init_scope(syms);
        match left {
            ForStatementLeft::VariableDeclaration(d) => {
                let Some(decl) = d.declarations.first() else {
                    return Ok(());
                };
                self.bind_pattern(&decl.id, BindMode::Init)
            }
            other => match other.as_assignment_target() {
                Some(t) => self.assign_target(t),
                None => Err(unsupported("This loop head", other.span())),
            },
        }
    }

    fn for_of(&mut self, f: &'a ForOfStatement<'a>, labels: Vec<&'a str>) -> R<()> {
        if f.r#await {
            return Err(unsupported("`for await`", f.span));
        }
        let syms = match f.scope_id.get() {
            Some(scope) => self.declare_scope(scope),
            None => Vec::new(),
        };
        self.expr(&f.right)?;
        let slot = self.new_local();
        self.emit(Op::GetIter(slot));
        let handler = self.emit(Op::PushFinally(0));
        let top = self.here();
        let exit = self.emit(Op::IterNext(slot, 0));
        self.push_loop(labels, Some(slot));
        self.bind_for_left(&f.left, &syms)?;
        self.stmt(&f.body)?;
        self.emit(Op::Jump(top));
        let breaks = self.pop_loop_continues(top);
        self.patch(exit);
        self.emit(Op::PopTry);
        let end = self.emit(Op::Jump(0));
        self.patch(handler);
        let exc = self.new_local();
        self.emit(Op::SetLocal(exc));
        self.emit(Op::IterCloseQuiet(slot));
        self.emit(Op::GetLocal(exc));
        self.emit(Op::Throw);
        self.patch(end);
        for b in breaks {
            self.patch(b);
        }
        Ok(())
    }

    fn for_in(&mut self, f: &'a ForInStatement<'a>, labels: Vec<&'a str>) -> R<()> {
        let syms = match f.scope_id.get() {
            Some(scope) => self.declare_scope(scope),
            None => Vec::new(),
        };
        self.expr(&f.right)?;
        let slot = self.new_local();
        self.emit(Op::ForIn(slot));
        let top = self.here();
        let exit = self.emit(Op::IterNext(slot, 0));
        self.push_loop(labels, None);
        self.bind_for_left(&f.left, &syms)?;
        self.stmt(&f.body)?;
        self.emit(Op::Jump(top));
        let breaks = self.pop_loop_continues(top);
        self.patch(exit);
        for b in breaks {
            self.patch(b);
        }
        Ok(())
    }

    fn labeled(&mut self, l: &'a LabeledStatement<'a>) -> R<()> {
        let mut labels = vec![l.label.name.as_str()];
        let mut body = &l.body;
        while let Statement::LabeledStatement(inner) = body {
            labels.push(inner.label.name.as_str());
            body = &inner.body;
        }
        match body {
            Statement::WhileStatement(w) => self.while_loop(w, labels),
            Statement::DoWhileStatement(w) => self.do_while(w, labels),
            Statement::ForStatement(f) => self.for_loop(f, labels),
            Statement::ForOfStatement(f) => self.for_of(f, labels),
            Statement::ForInStatement(f) => self.for_in(f, labels),
            Statement::SwitchStatement(s) => self.switch(s, labels),
            other => {
                for label in &labels {
                    self.f().controls.push(Control::Label {
                        label,
                        breaks: Vec::new(),
                    });
                }
                self.stmt(other)?;
                for _ in &labels {
                    if let Some(Control::Label { breaks, .. }) = self.f().controls.pop() {
                        for b in breaks {
                            self.patch(b);
                        }
                    }
                }
                Ok(())
            }
        }
    }

    fn switch(&mut self, s: &'a SwitchStatement<'a>, labels: Vec<&'a str>) -> R<()> {
        self.expr(&s.discriminant)?;
        let tmp = self.new_local();
        self.emit(Op::SetLocal(tmp));
        let syms = match s.scope_id.get() {
            Some(scope) => {
                self.switch_scopes.insert(scope);
                self.declare_scope(scope)
            }
            None => Vec::new(),
        };
        self.init_scope(&syms);
        for case in &s.cases {
            self.hoist_functions(&case.consequent)?;
        }
        let mut jumps = Vec::new();
        for case in &s.cases {
            if let Some(t) = &case.test {
                self.emit(Op::GetLocal(tmp));
                self.expr(t)?;
                self.emit(Op::StrictEq);
                jumps.push(Some(self.emit(Op::JumpIfTrue(0))));
            } else {
                jumps.push(None);
            }
        }
        let to_default = self.emit(Op::Jump(0));
        self.f().controls.push(Control::Switch {
            labels,
            breaks: Vec::new(),
        });
        let mut default_at = None;
        for (case, j) in s.cases.iter().zip(jumps) {
            match j {
                Some(j) => self.patch(j),
                None => default_at = Some(self.here()),
            }
            self.stmts(&case.consequent)?;
        }
        let Some(Control::Switch { breaks, .. }) = self.f().controls.pop() else {
            return Ok(());
        };
        match default_at {
            Some(d) => self.f().code[to_default] = Op::Jump(d),
            None => self.patch(to_default),
        }
        for b in breaks {
            self.patch(b);
        }
        Ok(())
    }

    fn try_stmt(&mut self, t: &'a TryStatement<'a>) -> R<()> {
        let fin = if let Some(fb) = &t.finalizer {
            let h = self.emit(Op::PushFinally(0));
            self.f().controls.push(Control::Finally { body: fb });
            Some((h, fb))
        } else {
            None
        };
        match &t.handler {
            Some(h) => {
                let catch_at = self.emit(Op::PushCatch(0));
                self.f().controls.push(Control::Try);
                self.block(&t.block)?;
                self.f().controls.pop();
                self.emit(Op::PopTry);
                let after = self.emit(Op::Jump(0));
                self.patch(catch_at);
                let mut syms = match h.scope_id.get() {
                    Some(scope) => self.declare_scope(scope),
                    None => Vec::new(),
                };
                if let Some(scope) = h.body.scope_id.get() {
                    syms.extend(self.declare_scope(scope));
                }
                self.init_scope(&syms);
                for s in &syms {
                    if self
                        .scoping
                        .symbol_flags(*s)
                        .contains(SymbolFlags::CatchVariable)
                        && let Some(SymInfo {
                            store: Store::Cell(c),
                            ..
                        }) = self.syms.get(s)
                    {
                        let c = *c;
                        self.emit(Op::NewCell(c));
                    }
                }
                match &h.param {
                    Some(p) => self.bind_pattern(&p.pattern, BindMode::Init)?,
                    None => {
                        self.emit(Op::Pop);
                    }
                }
                self.block(&h.body)?;
                self.patch(after);
            }
            None => self.block(&t.block)?,
        }
        if let Some((h, fb)) = fin {
            self.f().controls.pop();
            self.emit(Op::PopTry);
            self.block(fb)?;
            let end = self.emit(Op::Jump(0));
            self.patch(h);
            let exc = self.new_local();
            self.emit(Op::SetLocal(exc));
            self.block(fb)?;
            self.emit(Op::GetLocal(exc));
            self.emit(Op::Throw);
            self.patch(end);
        }
        Ok(())
    }

    // ---------- patterns ----------

    /// Binds a declaration pattern from the value on the stack, consuming it.
    fn bind_pattern(&mut self, p: &'a BindingPattern<'a>, mode: BindMode) -> R<()> {
        match p {
            BindingPattern::BindingIdentifier(id) => match id.symbol_id.get() {
                Some(s) => self.store_symbol(s, mode, id.span.start),
                None => {
                    self.emit(Op::Pop);
                    Ok(())
                }
            },
            BindingPattern::AssignmentPattern(a) => {
                let j = self.emit(Op::JumpIfNotUndef(0));
                self.emit(Op::Pop);
                self.expr_named(&a.right, pattern_name(&a.left))?;
                self.patch(j);
                self.bind_pattern(&a.left, mode)
            }
            BindingPattern::ObjectPattern(o) => {
                self.emit(Op::RequireCoercible);
                let mut saved_keys = Vec::new();
                for prop in &o.properties {
                    self.emit(Op::Dup);
                    match static_key(&prop.key, prop.computed) {
                        Some(k) => {
                            let a = self.atom(&k);
                            self.emit(Op::GetProp(a));
                            saved_keys.push(KeyRef::Static(k));
                        }
                        None => {
                            let Some(e) = prop.key.as_expression() else {
                                return Err(unsupported("Private names", prop.span));
                            };
                            self.expr(e)?;
                            if o.rest.is_some() {
                                let t = self.new_local();
                                self.emit(Op::Dup);
                                self.emit(Op::SetLocal(t));
                                saved_keys.push(KeyRef::Local(t));
                            }
                            self.emit(Op::GetElem);
                        }
                    }
                    self.bind_pattern(&prop.value, mode)?;
                }
                match &o.rest {
                    Some(rest) => {
                        self.push_keys(&saved_keys);
                        self.emit(Op::ObjRest(saved_keys.len() as u32));
                        self.bind_pattern(&rest.argument, mode)
                    }
                    None => {
                        self.emit(Op::Pop);
                        Ok(())
                    }
                }
            }
            BindingPattern::ArrayPattern(a) => {
                let slot = self.new_local();
                self.emit(Op::GetIter(slot));
                for el in &a.elements {
                    self.emit(Op::IterStep(slot));
                    match el {
                        Some(p) => self.bind_pattern(p, mode)?,
                        None => {
                            self.emit(Op::Pop);
                        }
                    }
                }
                if let Some(rest) = &a.rest {
                    self.emit(Op::IterRest(slot));
                    self.bind_pattern(&rest.argument, mode)?;
                }
                self.emit(Op::IterClose(slot));
                Ok(())
            }
        }
    }

    fn push_keys(&mut self, keys: &[KeyRef]) {
        for k in keys {
            match k {
                KeyRef::Static(s) => self.push_str(s),
                KeyRef::Local(l) => {
                    self.emit(Op::GetLocal(*l));
                }
            }
        }
    }

    /// Assigns the value on the stack to an assignment target, consuming it.
    fn assign_target(&mut self, t: &'a AssignmentTarget<'a>) -> R<()> {
        match t {
            AssignmentTarget::ArrayAssignmentTarget(a) => {
                let slot = self.new_local();
                self.emit(Op::GetIter(slot));
                for el in &a.elements {
                    self.emit(Op::IterStep(slot));
                    match el {
                        Some(m) => self.assign_maybe_default(m)?,
                        None => {
                            self.emit(Op::Pop);
                        }
                    }
                }
                if let Some(rest) = &a.rest {
                    self.emit(Op::IterRest(slot));
                    self.assign_target(&rest.target)?;
                }
                self.emit(Op::IterClose(slot));
                Ok(())
            }
            AssignmentTarget::ObjectAssignmentTarget(o) => {
                self.emit(Op::RequireCoercible);
                let mut saved_keys = Vec::new();
                for prop in &o.properties {
                    self.emit(Op::Dup);
                    match prop {
                        AssignmentTargetProperty::AssignmentTargetPropertyIdentifier(p) => {
                            let name = p.binding.name.as_str();
                            let a = self.atom(name);
                            self.emit(Op::GetProp(a));
                            saved_keys.push(KeyRef::Static(name.to_owned()));
                            if let Some(init) = &p.init {
                                let j = self.emit(Op::JumpIfNotUndef(0));
                                self.emit(Op::Pop);
                                self.expr_named(init, Some(name))?;
                                self.patch(j);
                            }
                            self.store_ident(&p.binding)?;
                        }
                        AssignmentTargetProperty::AssignmentTargetPropertyProperty(p) => {
                            match static_key(&p.name, p.computed) {
                                Some(k) => {
                                    let a = self.atom(&k);
                                    self.emit(Op::GetProp(a));
                                    saved_keys.push(KeyRef::Static(k));
                                }
                                None => {
                                    let Some(e) = p.name.as_expression() else {
                                        return Err(unsupported("Private names", p.span));
                                    };
                                    self.expr(e)?;
                                    if o.rest.is_some() {
                                        let t = self.new_local();
                                        self.emit(Op::Dup);
                                        self.emit(Op::SetLocal(t));
                                        saved_keys.push(KeyRef::Local(t));
                                    }
                                    self.emit(Op::GetElem);
                                }
                            }
                            self.assign_maybe_default(&p.binding)?;
                        }
                    }
                }
                match &o.rest {
                    Some(rest) => {
                        self.push_keys(&saved_keys);
                        self.emit(Op::ObjRest(saved_keys.len() as u32));
                        self.assign_target(&rest.target)
                    }
                    None => {
                        self.emit(Op::Pop);
                        Ok(())
                    }
                }
            }
            other => match other.as_simple_assignment_target() {
                Some(s) => self.assign_simple(s),
                None => Err(unsupported("This assignment target", other.span())),
            },
        }
    }

    fn assign_maybe_default(&mut self, m: &'a AssignmentTargetMaybeDefault<'a>) -> R<()> {
        match m {
            AssignmentTargetMaybeDefault::AssignmentTargetWithDefault(d) => {
                let j = self.emit(Op::JumpIfNotUndef(0));
                self.emit(Op::Pop);
                self.expr(&d.init)?;
                self.patch(j);
                self.assign_target(&d.binding)
            }
            other => match other.as_assignment_target() {
                Some(t) => self.assign_target(t),
                None => Err(unsupported("This assignment target", other.span())),
            },
        }
    }

    fn assign_simple(&mut self, s: &'a SimpleAssignmentTarget<'a>) -> R<()> {
        match s {
            SimpleAssignmentTarget::AssignmentTargetIdentifier(id) => self.store_ident(id),
            SimpleAssignmentTarget::StaticMemberExpression(m) => {
                self.expr(&m.object)?;
                self.emit(Op::Swap);
                let a = self.atom(m.property.name.as_str());
                self.emit(Op::SetProp(a));
                self.emit(Op::Pop);
                Ok(())
            }
            SimpleAssignmentTarget::ComputedMemberExpression(m) => {
                self.expr(&m.object)?;
                self.expr(&m.expression)?;
                self.emit(Op::Rot3Back);
                self.emit(Op::SetElem);
                self.emit(Op::Pop);
                Ok(())
            }
            other => Err(unsupported("This assignment target", other.span())),
        }
    }

    // ---------- expressions ----------

    fn expr_named(&mut self, e: &'a Expression<'a>, name: Option<&str>) -> R<()> {
        match e {
            Expression::ArrowFunctionExpression(a) => {
                self.pos = a.span.start;
                self.closure_for_arrow(a, name)
            }
            Expression::FunctionExpression(f) if f.id.is_none() => {
                self.pos = f.span.start;
                self.closure_for_function(f, name)
            }
            _ => self.expr(e),
        }
    }

    fn expr(&mut self, e: &'a Expression<'a>) -> R<()> {
        let saved = self.pos;
        self.pos = e.span().start;
        let r = self.expr_inner(e);
        self.pos = saved;
        r
    }

    fn expr_inner(&mut self, e: &'a Expression<'a>) -> R<()> {
        match e {
            Expression::BooleanLiteral(b) => {
                self.emit(if b.value { Op::True } else { Op::False });
            }
            Expression::NullLiteral(_) => {
                self.emit(Op::Null);
            }
            Expression::NumericLiteral(n) => self.push_num(n.value),
            Expression::StringLiteral(s) => {
                let text = js_str(&s.value);
                self.push_str(&text);
            }
            Expression::TemplateLiteral(t) => self.template(t)?,
            Expression::Identifier(id) => self.load_ident(id)?,
            Expression::ThisExpression(_) => {
                self.emit(Op::This);
            }
            Expression::ArrayExpression(a) => self.array_lit(a)?,
            Expression::ObjectExpression(o) => self.object_lit(o)?,
            Expression::ArrowFunctionExpression(a) => self.closure_for_arrow(a, None)?,
            Expression::FunctionExpression(f) => self.closure_for_function(f, None)?,
            Expression::UnaryExpression(u) => self.unary(u)?,
            Expression::BinaryExpression(b) => {
                self.expr(&b.left)?;
                self.expr(&b.right)?;
                self.emit(binary_op(b.operator));
            }
            Expression::LogicalExpression(l) => {
                self.expr(&l.left)?;
                let j = self.emit(match l.operator {
                    LogicalOperator::And => Op::JumpIfFalseKeep(0),
                    LogicalOperator::Or => Op::JumpIfTrueKeep(0),
                    LogicalOperator::Coalesce => Op::JumpIfNotNullishKeep(0),
                });
                self.expr(&l.right)?;
                self.patch(j);
            }
            Expression::ConditionalExpression(c) => {
                self.expr(&c.test)?;
                let j = self.emit(Op::JumpIfFalse(0));
                self.expr(&c.consequent)?;
                let end = self.emit(Op::Jump(0));
                self.patch(j);
                self.expr(&c.alternate)?;
                self.patch(end);
            }
            Expression::AssignmentExpression(a) => self.assignment(a)?,
            Expression::UpdateExpression(u) => self.update(u)?,
            Expression::SequenceExpression(s) => {
                let n = s.expressions.len();
                for (i, x) in s.expressions.iter().enumerate() {
                    self.expr(x)?;
                    if i + 1 < n {
                        self.emit(Op::Pop);
                    }
                }
            }
            Expression::ParenthesizedExpression(p) => self.expr(&p.expression)?,
            Expression::CallExpression(c) => self.call(c)?,
            Expression::NewExpression(n) => {
                self.expr(&n.callee)?;
                self.emit(Op::Undef);
                match self.args(&n.arguments)? {
                    Some(argc) => self.emit(Op::New(argc)),
                    None => self.emit(Op::NewSpread),
                };
            }
            Expression::StaticMemberExpression(m) => {
                self.expr(&m.object)?;
                if m.optional {
                    self.opt_chain();
                }
                let a = self.atom(m.property.name.as_str());
                self.emit(Op::GetProp(a));
            }
            Expression::ComputedMemberExpression(m) => {
                self.expr(&m.object)?;
                if m.optional {
                    self.opt_chain();
                }
                self.elem_key(&m.expression)?;
            }
            Expression::ChainExpression(c) => {
                self.chains.push(Vec::new());
                match &c.expression {
                    ChainElement::CallExpression(call) => self.call(call)?,
                    other => match other.as_member_expression() {
                        Some(m) => self.expr(m_as_expr(m))?,
                        None => return Err(unsupported("TypeScript syntax", other.span())),
                    },
                }
                let patches = self.chains.pop().unwrap_or_default();
                for p in patches {
                    self.patch(p);
                }
            }
            Expression::AwaitExpression(a) => {
                self.expr(&a.argument)?;
                self.emit(Op::Await);
            }
            Expression::YieldExpression(y) => {
                match &y.argument {
                    Some(a) => self.expr(a)?,
                    None => {
                        self.emit(Op::Undef);
                    }
                }
                if y.delegate {
                    let slot = self.new_local();
                    self.emit(Op::GetIter(slot));
                    let top = self.here();
                    let exit = self.emit(Op::DelegateNext(slot, 0));
                    self.emit(Op::Yield);
                    self.emit(Op::Pop);
                    self.emit(Op::Jump(top));
                    self.patch(exit);
                } else {
                    self.emit(Op::Yield);
                }
            }
            Expression::ClassExpression(c) => return Err(unsupported("Classes", c.span)),
            Expression::RegExpLiteral(r) => return Err(unsupported("Regular expressions", r.span)),
            Expression::BigIntLiteral(_) => {
                let msg = self.str_const("BigInt literals are not supported.");
                self.emit(Op::ThrowType(msg));
            }
            Expression::TaggedTemplateExpression(t) => {
                return Err(unsupported("Tagged templates", t.span));
            }
            Expression::Super(s) => return Err(unsupported("`super`", s.span)),
            Expression::ImportExpression(i) => return Err(unsupported("`import()`", i.span)),
            Expression::ImportMeta(m) => return Err(unsupported("`import.meta`", m.span)),
            Expression::NewTarget(m) => return Err(unsupported("`new.target`", m.span)),
            Expression::PrivateFieldExpression(p) => {
                return Err(unsupported("Private fields", p.span));
            }
            Expression::PrivateInExpression(p) => {
                return Err(unsupported("Private fields", p.span));
            }
            other => return Err(unsupported("This syntax", other.span())),
        }
        Ok(())
    }

    fn opt_chain(&mut self) {
        let j = self.emit(Op::OptChain(0));
        if let Some(c) = self.chains.last_mut() {
            c.push(j);
        }
    }

    fn elem_key(&mut self, key: &'a Expression<'a>) -> R<()> {
        if let Expression::StringLiteral(s) = key {
            let a = self.atom(&js_str(&s.value));
            if self.atoms.index(a).is_none() {
                self.emit(Op::GetProp(a));
                return Ok(());
            }
        }
        self.expr(key)?;
        self.emit(Op::GetElem);
        Ok(())
    }

    fn template(&mut self, t: &'a TemplateLiteral<'a>) -> R<()> {
        let mut parts = 0u32;
        for (i, q) in t.quasis.iter().enumerate() {
            let cooked = q
                .value
                .cooked
                .as_ref()
                .map(js_str)
                .unwrap_or_else(|| q.value.raw.as_str().to_owned());
            if !cooked.is_empty() || (t.expressions.is_empty() && i == 0) {
                self.push_str(&cooked);
                parts += 1;
            }
            if let Some(e) = t.expressions.get(i) {
                self.expr(e)?;
                self.emit(Op::ToStr);
                parts += 1;
            }
        }
        if parts != 1 {
            self.emit(Op::Concat(parts));
        }
        Ok(())
    }

    fn array_lit(&mut self, a: &'a ArrayExpression<'a>) -> R<()> {
        let simple = a.elements.iter().all(|e| e.as_expression().is_some());
        if simple {
            for el in &a.elements {
                if let Some(e) = el.as_expression() {
                    self.expr(e)?;
                }
            }
            self.emit(Op::NewArray(a.elements.len() as u32));
            return Ok(());
        }
        self.emit(Op::NewArray(0));
        for el in &a.elements {
            match el {
                ArrayExpressionElement::SpreadElement(s) => {
                    self.expr(&s.argument)?;
                    self.emit(Op::ArraySpread);
                }
                ArrayExpressionElement::Elision(_) => {
                    self.emit(Op::Undef);
                    self.emit(Op::ArrayPush);
                }
                other => {
                    if let Some(e) = other.as_expression() {
                        self.expr(e)?;
                        self.emit(Op::ArrayPush);
                    }
                }
            }
        }
        Ok(())
    }

    fn object_lit(&mut self, o: &'a ObjectExpression<'a>) -> R<()> {
        self.emit(Op::NewObject);
        for p in &o.properties {
            match p {
                ObjectPropertyKind::SpreadProperty(s) => {
                    self.expr(&s.argument)?;
                    self.emit(Op::ObjectSpread);
                }
                ObjectPropertyKind::ObjectProperty(p) => {
                    if p.kind != PropertyKind::Init {
                        return Err(unsupported("Getters and setters", p.span));
                    }
                    self.pos = p.span.start;
                    match static_key(&p.key, p.computed) {
                        Some(k) => {
                            self.expr_named(&p.value, Some(&k))?;
                            let a = self.atom(&k);
                            self.emit(Op::DefineField(a));
                        }
                        None => {
                            let Some(e) = p.key.as_expression() else {
                                return Err(unsupported("Private names", p.span));
                            };
                            self.expr(e)?;
                            self.expr(&p.value)?;
                            self.emit(Op::DefineElem);
                        }
                    }
                }
            }
        }
        Ok(())
    }

    /// Pushes call arguments; returns the count, or `None` after building one array for spread arguments.
    fn args(&mut self, args: &'a [Argument<'a>]) -> R<Option<u32>> {
        if args.iter().all(|a| a.as_expression().is_some()) {
            for a in args {
                if let Some(e) = a.as_expression() {
                    self.expr(e)?;
                }
            }
            return Ok(Some(args.len() as u32));
        }
        self.emit(Op::NewArray(0));
        for a in args {
            match a {
                Argument::SpreadElement(s) => {
                    self.expr(&s.argument)?;
                    self.emit(Op::ArraySpread);
                }
                other => {
                    if let Some(e) = other.as_expression() {
                        self.expr(e)?;
                        self.emit(Op::ArrayPush);
                    }
                }
            }
        }
        Ok(None)
    }

    fn call(&mut self, c: &'a CallExpression<'a>) -> R<()> {
        match &c.callee {
            Expression::StaticMemberExpression(m) => {
                self.expr(&m.object)?;
                if m.optional {
                    self.opt_chain();
                }
                let a = self.atom(m.property.name.as_str());
                self.emit(Op::GetMethod(a));
            }
            Expression::ComputedMemberExpression(m) => {
                self.expr(&m.object)?;
                if m.optional {
                    self.opt_chain();
                }
                self.emit(Op::Dup);
                self.elem_key(&m.expression)?;
                self.emit(Op::Swap);
            }
            Expression::Super(s) => return Err(unsupported("`super`", s.span)),
            callee => {
                self.expr(callee)?;
                self.emit(Op::Undef);
            }
        }
        if c.optional {
            let j = self.emit(Op::OptCall(0));
            if let Some(ch) = self.chains.last_mut() {
                ch.push(j);
            }
        }
        self.pos = c.span.start;
        match self.args(&c.arguments)? {
            Some(argc) => self.emit(Op::Call(argc)),
            None => self.emit(Op::CallSpread),
        };
        Ok(())
    }

    fn unary(&mut self, u: &'a UnaryExpression<'a>) -> R<()> {
        match u.operator {
            UnaryOperator::Typeof => {
                if let Expression::Identifier(id) = &u.argument
                    && self.ident_symbol(id).is_none()
                    && id.name.as_str() != "undefined"
                    && id.name.as_str() != "arguments"
                {
                    let g = self.global_slot(id.name.as_str());
                    self.emit(Op::TypeofGlobal(g));
                    return Ok(());
                }
                self.expr(&u.argument)?;
                self.emit(Op::Typeof);
            }
            UnaryOperator::Delete => match &u.argument {
                Expression::StaticMemberExpression(m) => {
                    self.expr(&m.object)?;
                    let a = self.atom(m.property.name.as_str());
                    self.emit(Op::DelProp(a));
                }
                Expression::ComputedMemberExpression(m) => {
                    self.expr(&m.object)?;
                    self.expr(&m.expression)?;
                    self.emit(Op::DelElem);
                }
                Expression::ChainExpression(c) => {
                    return Err(unsupported("Optional delete", c.span));
                }
                other => {
                    self.expr(other)?;
                    self.emit(Op::Pop);
                    self.emit(Op::True);
                }
            },
            UnaryOperator::Void => {
                self.expr(&u.argument)?;
                self.emit(Op::Pop);
                self.emit(Op::Undef);
            }
            op => {
                if let (UnaryOperator::UnaryNegation, Expression::NumericLiteral(n)) =
                    (op, &u.argument)
                {
                    self.push_num(-n.value);
                    return Ok(());
                }
                self.expr(&u.argument)?;
                self.emit(match op {
                    UnaryOperator::UnaryPlus => Op::ToNumber,
                    UnaryOperator::UnaryNegation => Op::Neg,
                    UnaryOperator::LogicalNot => Op::Not,
                    _ => Op::BitNot,
                });
            }
        }
        Ok(())
    }

    fn assignment(&mut self, a: &'a AssignmentExpression<'a>) -> R<()> {
        let op = a.operator;
        if op == AssignmentOperator::Assign {
            match &a.left {
                AssignmentTarget::AssignmentTargetIdentifier(id) => {
                    self.expr_named(&a.right, Some(id.name.as_str()))?;
                    self.emit(Op::Dup);
                    return self.store_ident(id);
                }
                AssignmentTarget::StaticMemberExpression(m) => {
                    self.expr(&m.object)?;
                    self.expr(&a.right)?;
                    let at = self.atom(m.property.name.as_str());
                    self.emit(Op::SetProp(at));
                    return Ok(());
                }
                AssignmentTarget::ComputedMemberExpression(m) => {
                    self.expr(&m.object)?;
                    self.expr(&m.expression)?;
                    self.expr(&a.right)?;
                    self.emit(Op::SetElem);
                    return Ok(());
                }
                AssignmentTarget::ArrayAssignmentTarget(_)
                | AssignmentTarget::ObjectAssignmentTarget(_) => {
                    self.expr(&a.right)?;
                    self.emit(Op::Dup);
                    return self.assign_target(&a.left);
                }
                other => return Err(unsupported("This assignment target", other.span())),
            }
        }
        let logical = match op {
            AssignmentOperator::LogicalAnd => Some(Op::JumpIfFalseKeep(0)),
            AssignmentOperator::LogicalOr => Some(Op::JumpIfTrueKeep(0)),
            AssignmentOperator::LogicalNullish => Some(Op::JumpIfNotNullishKeep(0)),
            _ => None,
        };
        match &a.left {
            AssignmentTarget::AssignmentTargetIdentifier(id) => {
                if let Some(jop) = logical {
                    self.load_ident(id)?;
                    let j = self.emit(jop);
                    self.expr_named(&a.right, Some(id.name.as_str()))?;
                    self.emit(Op::Dup);
                    self.store_ident(id)?;
                    self.patch(j);
                    return Ok(());
                }
                self.load_ident(id)?;
                self.expr(&a.right)?;
                self.emit(compound_op(op));
                self.emit(Op::Dup);
                self.store_ident(id)
            }
            AssignmentTarget::StaticMemberExpression(m) => {
                let at = self.atom(m.property.name.as_str());
                self.expr(&m.object)?;
                self.emit(Op::Dup);
                self.emit(Op::GetProp(at));
                if let Some(jop) = logical {
                    let j = self.emit(jop);
                    self.expr(&a.right)?;
                    self.emit(Op::SetProp(at));
                    let end = self.emit(Op::Jump(0));
                    self.patch(j);
                    self.emit(Op::Swap);
                    self.emit(Op::Pop);
                    self.patch(end);
                    return Ok(());
                }
                self.expr(&a.right)?;
                self.emit(compound_op(op));
                self.emit(Op::SetProp(at));
                Ok(())
            }
            AssignmentTarget::ComputedMemberExpression(m) => {
                self.expr(&m.object)?;
                self.expr(&m.expression)?;
                self.emit(Op::Dup2);
                self.emit(Op::GetElem);
                if let Some(jop) = logical {
                    let j = self.emit(jop);
                    self.expr(&a.right)?;
                    self.emit(Op::SetElem);
                    let end = self.emit(Op::Jump(0));
                    self.patch(j);
                    self.emit(Op::Rot3);
                    self.emit(Op::Pop);
                    self.emit(Op::Pop);
                    self.patch(end);
                    return Ok(());
                }
                self.expr(&a.right)?;
                self.emit(compound_op(op));
                self.emit(Op::SetElem);
                Ok(())
            }
            other => Err(unsupported("This assignment target", other.span())),
        }
    }

    fn update(&mut self, u: &'a UpdateExpression<'a>) -> R<()> {
        let step = if u.operator == UpdateOperator::Increment {
            Op::Inc
        } else {
            Op::Dec
        };
        match &u.argument {
            SimpleAssignmentTarget::AssignmentTargetIdentifier(id) => {
                self.load_ident(id)?;
                if u.prefix {
                    self.emit(step);
                    self.emit(Op::Dup);
                } else {
                    self.emit(Op::ToNumeric);
                    self.emit(Op::Dup);
                    self.emit(step);
                }
                self.store_ident(id)
            }
            SimpleAssignmentTarget::StaticMemberExpression(m) => {
                let at = self.atom(m.property.name.as_str());
                self.expr(&m.object)?;
                self.emit(Op::Dup);
                self.emit(Op::GetProp(at));
                if u.prefix {
                    self.emit(step);
                    self.emit(Op::SetProp(at));
                } else {
                    self.emit(Op::ToNumeric);
                    self.emit(Op::Dup);
                    self.emit(Op::Rot3);
                    self.emit(step);
                    self.emit(Op::SetProp(at));
                    self.emit(Op::Pop);
                }
                Ok(())
            }
            SimpleAssignmentTarget::ComputedMemberExpression(m) => {
                self.expr(&m.object)?;
                self.expr(&m.expression)?;
                self.emit(Op::Dup2);
                self.emit(Op::GetElem);
                if u.prefix {
                    self.emit(step);
                    self.emit(Op::SetElem);
                } else {
                    let t = self.new_local();
                    self.emit(Op::ToNumeric);
                    self.emit(Op::Dup);
                    self.emit(Op::SetLocal(t));
                    self.emit(step);
                    self.emit(Op::SetElem);
                    self.emit(Op::Pop);
                    self.emit(Op::GetLocal(t));
                }
                Ok(())
            }
            other => Err(unsupported("This update target", other.span())),
        }
    }
}

enum KeyRef {
    Static(String),
    Local(u32),
}

enum FnBody<'a> {
    Block(&'a FunctionBody<'a>),
    Expr(&'a Expression<'a>),
}

struct FnSpec<'a, 'n> {
    name: &'n str,
    params: &'a FormalParameters<'a>,
    body: FnBody<'a>,
    scope: Option<ScopeId>,
    is_async: bool,
    is_generator: bool,
    is_arrow: bool,
    self_sym: Option<SymbolId>,
}

impl<'a> FnState<'a> {
    fn new(is_arrow: bool) -> Self {
        FnState {
            code: Vec::new(),
            pos: Vec::new(),
            nlocals: 0,
            ncells: 0,
            captures: Vec::new(),
            upval_of: FxHashMap::default(),
            controls: Vec::new(),
            is_arrow,
            needs_extra: false,
            barrier: 0,
        }
    }
}

fn m_as_expr<'x, 'a>(m: &'x MemberExpression<'a>) -> &'x Expression<'a> {
    m.as_expression()
}

fn js_str(s: &oxc_str::JSStr) -> String {
    match s.as_str() {
        Some(t) => t.to_owned(),
        None => String::from_utf16_lossy(&s.encode_utf16().collect::<Vec<u16>>()),
    }
}

fn static_key(key: &PropertyKey, computed: bool) -> Option<String> {
    match key {
        PropertyKey::StaticIdentifier(id) if !computed => Some(id.name.as_str().to_owned()),
        PropertyKey::StringLiteral(s) => Some(js_str(&s.value)),
        PropertyKey::NumericLiteral(n) => Some(num_to_string(n.value)),
        _ => None,
    }
}

fn pattern_name<'x>(p: &'x BindingPattern) -> Option<&'x str> {
    match p {
        BindingPattern::BindingIdentifier(id) => Some(id.name.as_str()),
        _ => None,
    }
}

fn is_builtin_global(name: &str) -> bool {
    crate::builtins::GLOBAL_NAMES.contains(&name)
}

fn binary_op(op: BinaryOperator) -> Op {
    match op {
        BinaryOperator::Equality => Op::Eq,
        BinaryOperator::Inequality => Op::Ne,
        BinaryOperator::StrictEquality => Op::StrictEq,
        BinaryOperator::StrictInequality => Op::StrictNe,
        BinaryOperator::LessThan => Op::Lt,
        BinaryOperator::LessEqualThan => Op::Le,
        BinaryOperator::GreaterThan => Op::Gt,
        BinaryOperator::GreaterEqualThan => Op::Ge,
        BinaryOperator::Addition => Op::Add,
        BinaryOperator::Subtraction => Op::Sub,
        BinaryOperator::Multiplication => Op::Mul,
        BinaryOperator::Division => Op::Div,
        BinaryOperator::Remainder => Op::Mod,
        BinaryOperator::Exponential => Op::Pow,
        BinaryOperator::ShiftLeft => Op::Shl,
        BinaryOperator::ShiftRight => Op::Shr,
        BinaryOperator::ShiftRightZeroFill => Op::UShr,
        BinaryOperator::BitwiseOR => Op::BitOr,
        BinaryOperator::BitwiseXOR => Op::BitXor,
        BinaryOperator::BitwiseAnd => Op::BitAnd,
        BinaryOperator::In => Op::In,
        BinaryOperator::Instanceof => Op::InstanceOf,
    }
}

fn compound_op(op: AssignmentOperator) -> Op {
    match op {
        AssignmentOperator::Addition => Op::Add,
        AssignmentOperator::Subtraction => Op::Sub,
        AssignmentOperator::Multiplication => Op::Mul,
        AssignmentOperator::Division => Op::Div,
        AssignmentOperator::Remainder => Op::Mod,
        AssignmentOperator::Exponential => Op::Pow,
        AssignmentOperator::ShiftLeft => Op::Shl,
        AssignmentOperator::ShiftRight => Op::Shr,
        AssignmentOperator::ShiftRightZeroFill => Op::UShr,
        AssignmentOperator::BitwiseOR => Op::BitOr,
        AssignmentOperator::BitwiseXOR => Op::BitXor,
        AssignmentOperator::BitwiseAnd => Op::BitAnd,
        _ => Op::Nop,
    }
}
