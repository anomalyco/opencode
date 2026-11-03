/* Lua 5.1 register machine. The generated include contains Lua's unchanged
 * value/metamethod operations, but NOT its interpreter loop (see Makefile).
 * Lua data structures and instruction encoding: Copyright (C) 1994-2012
 * Lua.org, PUC-Rio. See LICENSE.lua. */
#include "value-ops.inc"

static TValue *operand(lua_State *L, LClosure *fn, int rk) {
  return ISK(rk) ? &fn->p->k[INDEXK(rk)] : &L->base[rk];
}

/* A conditional instruction owns the JMP word that follows it. */
static const Instruction *branch(const Instruction *pc, int take) {
  return pc + 1 + (take ? GETARG_sBx(*pc) : 0);
}

static void replace_frame(lua_State *L) {
  CallInfo *next = L->ci, *prev = next - 1;
  ptrdiff_t size = L->top - next->func;
  luaF_close(L, prev->base);
  L->base = prev->base = prev->func + (next->base - next->func);
  memmove(prev->func, next->func, size * sizeof(TValue));
  L->top = prev->top = prev->func + size;
  prev->savedpc = L->savedpc;
  prev->tailcalls++;
  L->ci = prev;
}

static const Instruction *capture(lua_State *L, LClosure *parent, Proto *p,
                                  int dest, const Instruction *pc) {
  Closure *fn = luaF_newLclosure(L, p->nups, parent->env);
  fn->l.p = p;
  for (int j = 0; j < p->nups; ++j) {
    Instruction bind = *pc++;
    int src = GETARG_B(bind);
    fn->l.upvals[j] = GET_OPCODE(bind) == OP_MOVE
        ? luaF_findupval(L, L->base + src) : parent->upvals[src];
  }
  setclvalue(L, L->base + dest, fn);
  luaC_checkGC(L);
  return pc;
}

static void varargs(lua_State *L, int dest, int count) {
  int supplied = cast_int(L->base - L->ci->func) - 1 - ci_func(L->ci)->l.p->numparams;
  if (count == LUA_MULTRET) {
    count = supplied;
    luaD_checkstack(L, count);
    L->top = L->base + dest + count;
  }
  for (int j = 0; j < count; ++j) {
    TValue *slot = L->base + dest + j;
    if (j < supplied) { setobj(L, slot, L->base - supplied + j); }
    else { setnilvalue(slot); }
  }
}

static void fill_list(lua_State *L, StkId start, int count, int page) {
  if (!ttistable(start)) luaG_typeerror(L, start, "index");
  Table *table = hvalue(start);
  if (!count) {
    count = cast_int(L->top - start) - 1;
    L->top = L->ci->top;
  }
  int offset = (page - 1) * LFIELDS_PER_FLUSH;
  if (offset + count > table->sizearray) luaH_resizearray(L, table, offset + count);
  for (int j = 1; j <= count; ++j) {
    setobj2t(L, luaH_setnum(L, table, offset + j), start + j);
    luaC_barriert(L, table, start + j);
  }
}

void luaV_execute(lua_State *L, int frames) {
  const Instruction *pc = L->savedpc;
  for (;;) {
    Instruction i = *pc++;
    if ((L->hookmask & (LUA_MASKLINE | LUA_MASKCOUNT)) &&
        (--L->hookcount == 0 || (L->hookmask & LUA_MASKLINE))) {
      traceexec(L, pc);
      if (L->status == LUA_YIELD) { L->savedpc = pc - 1; return; }
    }
    /* Publish the fault location before anything that can call back into Lua.
     * A call or GC step may move the stack: don't cache registers across it. */
    L->savedpc = pc;
    LClosure *fn = &ci_func(L->ci)->l;
    OpCode op = GET_OPCODE(i);
    int a = GETARG_A(i), b = GETARG_B(i), c = GETARG_C(i);
    #define R(n) (L->base + (n))
    #define RK(n) operand(L, fn, (n))
    switch (op) {
      case OP_MOVE: setobj(L, R(a), R(b)); break;
      case OP_LOADK: setobj(L, R(a), fn->p->k + GETARG_Bx(i)); break;
      case OP_LOADBOOL: setbvalue(R(a), b); pc += (c != 0); break;
      case OP_LOADNIL:
        for (int j = a; j <= b; ++j) { setnilvalue(R(j)); }
        break;
      case OP_GETUPVAL: setobj(L, R(a), fn->upvals[b]->v); break;
      case OP_SETUPVAL:
        setobj(L, fn->upvals[b]->v, R(a));
        luaC_barrier(L, fn->upvals[b], R(a));
        break;
      case OP_GETGLOBAL: case OP_SETGLOBAL: {
        TValue env;
        TValue *key = fn->p->k + GETARG_Bx(i);
        sethvalue(L, &env, fn->env);
        if (op == OP_GETGLOBAL) luaV_gettable(L, &env, key, R(a));
        else luaV_settable(L, &env, key, R(a));
        break;
      }
      case OP_SELF:
        setobj(L, R(a+1), R(b));
        /* fall through: the method lookup is a GETTABLE */
      case OP_GETTABLE: luaV_gettable(L, R(b), RK(c), R(a)); break;
      case OP_SETTABLE: luaV_settable(L, R(a), RK(b), RK(c)); break;
      case OP_NEWTABLE:
        sethvalue(L, R(a), luaH_new(L, luaO_fb2int(b), luaO_fb2int(c)));
        luaC_checkGC(L);
        break;
      case OP_SETLIST:
        fill_list(L, R(a), b, c ? c : cast_int(*pc++));
        break;
      case OP_ADD: case OP_SUB: case OP_MUL: case OP_DIV: case OP_MOD: case OP_POW:
        /* Lua orders these six instructions identically to their tag methods. */
        Arith(L, R(a), RK(b), RK(c), (TMS)(TM_ADD + (op - OP_ADD)));
        break;
      case OP_UNM: Arith(L, R(a), R(b), R(b), TM_UNM); break;
      case OP_NOT: { int v = l_isfalse(R(b)); setbvalue(R(a), v); break; }
      case OP_LEN: {
        TValue *src = R(b);
        if (ttisstring(src)) { setnvalue(R(a), tsvalue(src)->len); }
        else if (ttistable(src)) { setnvalue(R(a), luaH_getn(hvalue(src))); }
        else if (!call_binTM(L, src, luaO_nilobject, R(a), TM_LEN)) luaG_typeerror(L, src, "get length of");
        break;
      }
      case OP_CONCAT:
        luaV_concat(L, c - b + 1, c);
        setobj(L, R(a), R(b));
        luaC_checkGC(L);
        break;
      case OP_JMP: pc += GETARG_sBx(i); break;
      case OP_EQ: case OP_LT: case OP_LE: {
        TValue *x = RK(b), *y = RK(c);
        int result = op == OP_EQ ? equalobj(L, x, y) :
                     op == OP_LT ? luaV_lessthan(L, x, y) : lessequal(L, x, y);
        pc = branch(pc, result == a);
        break;
      }
      case OP_TEST: case OP_TESTSET: {
        TValue *src = R(op == OP_TEST ? a : b);
        int take = l_isfalse(src) != c;
        if (take && op == OP_TESTSET) { setobj(L, R(a), src); }
        pc = branch(pc, take);
        break;
      }
      case OP_CALL: case OP_TAILCALL: {
        int results = op == OP_TAILCALL ? LUA_MULTRET : c - 1;
        if (b) L->top = R(a+b);
        int status = luaD_precall(L, R(a), results);
        if (status == PCRYIELD) return;
        if (status == PCRLUA) {
          if (op == OP_TAILCALL) replace_frame(L);
          else ++frames;
          pc = L->savedpc;
        } else if (results != LUA_MULTRET) L->top = L->ci->top;
        break;
      }
      case OP_RETURN: {
        if (b) L->top = R(a+b-1);
        luaF_close(L, L->base);
        int fixed = luaD_poscall(L, R(a));
        if (--frames == 0) return;
        if (fixed) L->top = L->ci->top;
        pc = L->savedpc;
        break;
      }
      case OP_FORPREP: {
        static const char *const names[] = { "initial value", "limit", "step" };
        for (int j = 0; j < 3; ++j) {
          TValue *v = R(a+j);
          if (!luaV_tonumber(v, v)) luaG_runerror(L, "'for' %s must be a number", names[j]);
        }
        setnvalue(R(a), nvalue(R(a)) - nvalue(R(a+2)));
        pc += GETARG_sBx(i);
        break;
      }
      case OP_FORLOOP: {
        lua_Number step = nvalue(R(a+2)), limit = nvalue(R(a+1));
        lua_Number next = nvalue(R(a)) + step;
        if (step > 0 ? next <= limit : next >= limit) {
          setnvalue(R(a), next);
          setnvalue(R(a+3), next);
          pc += GETARG_sBx(i);
        }
        break;
      }
      case OP_TFORLOOP: {
        for (int j = 0; j < 3; ++j) { setobj(L, R(a+3+j), R(a+j)); }
        L->top = R(a+6);
        luaD_call(L, R(a+3), c);
        L->top = L->ci->top;
        int more = !ttisnil(R(a+3));
        if (more) { setobj(L, R(a+2), R(a+3)); }
        pc = branch(pc, more);
        break;
      }
      case OP_CLOSE: luaF_close(L, R(a)); break;
      case OP_CLOSURE: pc = capture(L, fn, fn->p->p[GETARG_Bx(i)], a, pc); break;
      case OP_VARARG: varargs(L, a, b-1); break;
    }
    #undef R
    #undef RK
  }
}
