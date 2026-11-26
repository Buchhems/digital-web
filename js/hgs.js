// Interpreter für die Skriptsprache von Digital ("HGS"), wie sie in generischen
// Schaltungen verwendet wird: bits := args.bits; this.Bits = bits; if/else, for, while,
// repeat … until, Funktionen (func), Felder [..], Verbunde {..} und eingebaute Funktionen.

class HgsError extends Error {}
const KW = new Set(['if', 'else', 'for', 'while', 'func', 'repeat', 'until', 'return', 'export', 'true', 'false']);

function tokenize(src) {
  const out = []; let i = 0, line = 1;
  const push = (t, v) => out.push({ t, v, line });
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; } i += 2; continue; }
    let m;
    const rest = src.slice(i);
    if ((m = /^(0x[0-9a-fA-F]+|0b[01]+|\d+\.\d+(?:[eE][-+]?\d+)?|\d+)/.exec(rest))) {
      const s = m[1];
      const v = s.startsWith('0x') ? parseInt(s.slice(2), 16) : s.startsWith('0b') ? parseInt(s.slice(2), 2) : Number(s);
      push(s.includes('.') ? 'float' : 'num', v); i += s.length; continue;
    }
    if ((m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest))) { push(KW.has(m[0]) ? m[0] : 'id', m[0]); i += m[0].length; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1, s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\') { j++; const e = src[j]; s += e === 'n' ? '\n' : e === 't' ? '\t' : e; } else s += src[j];
        j++;
      }
      push('str', s); i = j + 1; continue;
    }
    if ((m = /^(>>>|<<|>>|<=|>=|==|!=|&&|\|\||:=|\+\+|--|[-+*/%&|^~!<>=(){}\[\].,;:?])/.exec(rest))) { push(m[1], m[1]); i += m[1].length; continue; }
    throw new HgsError(`Zeile ${line}: unbekanntes Zeichen „${c}“`);
  }
  push('eof', null);
  return out;
}

// ---------- Werte ----------
const isInt = v => typeof v === 'number' && Number.isInteger(v);
const toBool = v => { if (typeof v === 'boolean') return v; if (typeof v === 'number') return v !== 0; throw new HgsError(`„${v}“ ist kein Wahrheitswert`); };
const toNum = v => { if (typeof v === 'boolean') return v ? 1 : 0; if (typeof v === 'number') return v; if (typeof v === 'string' && v.trim() !== '' && !isNaN(+v)) return +v; throw new HgsError(`„${v}“ ist keine Zahl`); };

class Ctx {
  constructor(parent = null, isRoot = false) { this.parent = parent; this.vars = new Map(); this.isRoot = isRoot; }
  has(n) { return this.vars.has(n) || (this.parent?.has(n) ?? false); }
  get(n) {
    if (this.vars.has(n)) return this.vars.get(n);
    if (this.parent) return this.parent.get(n);
    if (BUILTIN[n]) return BUILTIN[n];
    throw new HgsError(`Variable „${n}“ ist nicht definiert`);
  }
  declare(n, v) { this.vars.set(n, v); }
  set(n, v) {
    if (this.vars.has(n)) { this.vars.set(n, v); return; }
    if (this.parent && this.parent.has(n)) { this.parent.set(n, v); return; }
    throw new HgsError(`Variable „${n}“ ist nicht definiert (mit := anlegen)`);
  }
}
// Objekt-Zugriff: Map, Ctx (Argumente) oder Attribut-Objekt
function getMember(o, k) {
  if (o == null) throw new HgsError(`Zugriff auf „${k}“ eines leeren Werts`);
  if (o instanceof Ctx) return o.vars.has(k) ? o.vars.get(k) : o.vars.has('args') ? getMember(o.vars.get('args'), k) : undefined;
  if (o.hgsGet) return o.hgsGet(k);
  if (o instanceof Map) return o.get(k);
  if (typeof o === 'object') return o[k];
  throw new HgsError(`„${k}“ gibt es hier nicht`);
}
function setMember(o, k, v) {
  if (o instanceof Ctx) { o.declare(k, v); return; }
  if (o.hgsSet) { o.hgsSet(k, v); return; }
  if (o instanceof Map) { o.set(k, v); return; }
  if (typeof o === 'object') { o[k] = v; return; }
  throw new HgsError(`„${k}“ lässt sich nicht setzen`);
}

const RETURN = Symbol('return');
const BUILTIN = {
  bitsNeededFor: v => { const n = toNum(v); let b = 1; while (2 ** b <= n) b++; return b; },
  ceil: v => Math.ceil(toNum(v)), floor: v => Math.floor(toNum(v)), round: v => Math.round(toNum(v)),
  random: n => Math.floor(Math.random() * toNum(n)), float: v => toNum(v), int: v => Math.trunc(toNum(v)),
  min: (...a) => Math.min(...a.map(toNum)), max: (...a) => Math.max(...a.map(toNum)), abs: v => Math.abs(toNum(v)),
  log: v => Math.log(toNum(v)), print: () => null, println: () => null, printf: () => null,
  format: (f, ...a) => { let k = 0; return String(f).replace(/%[-0-9.]*[dsxXfb]/g, s => { const v = a[k++]; return /x/i.test(s) ? Number(v).toString(16) : /b/.test(s) ? Number(v).toString(2) : String(v); }); },
  isPresent: v => v !== undefined && v !== null,
  panic: m => { throw new HgsError(String(m)); },
  sizeOf: a => (Array.isArray(a) ? a.length : a instanceof Map ? a.size : String(a).length),
  startsWith: (a, b) => String(a).startsWith(String(b)),
  splitString: s => String(s).split(/[\s,;]+/).filter(Boolean),
  identifier: s => String(s).replace(/[^A-Za-z0-9_]/g, '_'),
};

// ---------- Parser (liefert ausführbare Funktionen) ----------
function parse(src) {
  const t = tokenize(src); let p = 0;
  const peek = () => t[p], next = () => t[p++];
  const is = ty => t[p].t === ty;
  const eat = ty => { if (t[p].t === ty) { p++; return true; } return false; };
  const expect = ty => { if (!eat(ty)) throw new HgsError(`Zeile ${t[p].line}: „${ty}“ erwartet statt „${t[p].v ?? 'Ende'}“`); return t[p - 1]; };

  // Referenzen (für Zuweisungen): Name, a.b, a[i]
  function reference() {
    const name = expect('id').v;
    let ref = { get: c => c.get(name), set: (c, v) => c.set(name, v), declare: (c, v) => c.declare(name, v) };
    for (;;) {
      if (eat('.')) { const k = memberName(), base = ref; ref = { get: c => getMember(base.get(c), k), set: (c, v) => setMember(base.get(c), k, v) }; }
      else if (eat('[')) { const ie = expr(); expect(']'); const base = ref; ref = { get: c => base.get(c)[toNum(ie(c))], set: (c, v) => { base.get(c)[toNum(ie(c))] = v; } }; }
      else if (is('(')) { const base = ref, args = callArgs(); ref = { get: c => call(base.get(c), args.map(a => a(c))), set: () => { throw new HgsError('Zuweisung an Funktionsaufruf'); } }; }
      else break;
    }
    return ref;
  }
  // Attributname nach dem Punkt: Bezeichner oder in Anführungszeichen ('Input Splitting')
  function memberName() { if (is('str')) return next().v; return expect('id').v; }
  function callArgs() { expect('('); const a = []; if (!eat(')')) { do a.push(expr()); while (eat(',')); expect(')'); } return a; }
  function statement(real = true) {
    const tk = peek();
    const exp = tk.t === 'export';
    if (exp) next();
    if (tk.t === 'id' || exp) {
      const ref = reference();
      // export: Variable im äußersten Kontext anlegen (auch aus if/for heraus)
      if (eat(':=')) { const e = expr(); if (real) expect(';'); return c => { const v = e(c); let t = c; if (exp) while (t.parent && !t.isRoot) t = t.parent; ref.declare ? ref.declare(t, v) : ref.set(c, v); }; }
      if (eat('=')) { const e = expr(); if (real) expect(';'); return c => { const v = e(c); if (v === undefined || v === null) throw new HgsError('Kein Wert zum Zuweisen'); ref.set(c, v); }; }
      if (eat('++')) { if (real) expect(';'); return c => ref.set(c, toNum(ref.get(c)) + 1); }
      if (eat('--')) { if (real) expect(';'); return c => ref.set(c, toNum(ref.get(c)) - 1); }
      if (real) expect(';');
      return c => { ref.get(c); };
    }
    next();
    switch (tk.t) {
      case 'if': {
        expect('('); const cond = expr(); expect(')'); const a = statement();
        const b = eat('else') ? statement() : null;
        return c => { const ic = new Ctx(c); if (toBool(cond(ic))) a(ic); else if (b) b(ic); };
      }
      case 'for': {
        expect('('); const init = statement(false); expect(';'); const cond = expr(); expect(';'); const inc = statement(false); expect(')'); const body = statement();
        return c => { const ic = new Ctx(c); init(ic); let g = 0; while (toBool(cond(ic))) { body(new Ctx(ic)); inc(ic); if (++g > 1e6) throw new HgsError('Schleife endet nicht'); } };
      }
      case 'while': {
        expect('('); const cond = expr(); expect(')'); const body = statement();
        return c => { let g = 0; while (toBool(cond(c))) { body(new Ctx(c)); if (++g > 1e6) throw new HgsError('Schleife endet nicht'); } };
      }
      case 'repeat': {
        const body = statement(); expect('until'); const cond = expr(); if (real) expect(';');
        return c => { let g = 0; do { body(new Ctx(c)); if (++g > 1e6) throw new HgsError('Schleife endet nicht'); } while (!toBool(cond(c))); };
      }
      case '{': { const list = []; while (!eat('}')) list.push(statement()); return c => { for (const s of list) s(c); }; }
      case 'return': { const e = expr(); expect(';'); return c => { throw { [RETURN]: e(c) }; }; }
      case 'func': { const name = expect('id').v; const f = funcDef(); return c => c.declare(name, f(c)); }
      default: throw new HgsError(`Zeile ${tk.line}: unerwartet „${tk.v ?? 'Ende'}“`);
    }
  }
  function funcDef() {
    expect('('); const params = []; if (!eat(')')) { do params.push(expect('id').v); while (eat(',')); expect(')'); }
    const body = statement();
    return c => (...args) => {
      const fc = new Ctx(c, true); params.forEach((n, i) => fc.declare(n, args[i]));
      try { body(fc); } catch (e) { if (e && RETURN in e) return e[RETURN]; throw e; }
      return null;
    };
  }
  // Rangfolge wie in Digital: | ^ & = < << + *  (in Ausdrücken ist = ein Vergleich)
  const LEVELS = [['|', '||'], ['^'], ['&', '&&'], ['=', '==', '!='], ['<', '>', '<=', '>='], ['<<', '>>', '>>>'], ['+', '-'], ['*', '/', '%']];
  function expr(l = 0) {
    if (l >= LEVELS.length) return unary();
    let a = expr(l + 1);
    while (LEVELS[l].includes(peek().t)) {
      const op = next().t, b = expr(l + 1), x = a;
      a = c => binop(op, x, b, c);
    }
    return a;
  }
  function unary() {
    if (eat('-')) { const e = unary(); return c => -toNum(e(c)); }
    if (eat('!')) { const e = unary(); return c => !toBool(e(c)); }
    if (eat('~')) { const e = unary(); return c => ~toNum(e(c)); }
    return postfix(primary());
  }
  function postfix(e) {
    for (;;) {
      if (eat('.')) { const k = memberName(), b = e; e = c => getMember(b(c), k); }
      else if (eat('[')) { const ie = expr(); expect(']'); const b = e; e = c => b(c)[toNum(ie(c))]; }
      else if (is('(')) { const args = callArgs(), b = e; e = c => call(b(c), args.map(a => a(c))); }
      else return e;
    }
  }
  function primary() {
    const tk = next();
    switch (tk.t) {
      case 'num': case 'float': case 'str': return () => tk.v;
      case 'true': return () => true;
      case 'false': return () => false;
      case 'id': return c => c.get(tk.v);
      case '(': { const e = expr(); expect(')'); return e; }
      case '[': { const items = []; if (!eat(']')) { do items.push(expr()); while (eat(',')); expect(']'); } return c => items.map(i => i(c)); }
      case '{': {
        const items = [];
        if (!eat('}')) { do { const k = next().v; expect(':'); items.push([k, expr()]); } while (eat(',')); expect('}'); }
        return c => new Map(items.map(([k, e]) => [k, e(c)]));
      }
      case 'func': return funcDef();
      default: throw new HgsError(`Zeile ${tk.line}: unerwartet „${tk.v ?? 'Ende'}“`);
    }
  }
  const list = [];
  while (!is('eof')) list.push(statement());
  return c => { for (const s of list) s(c); };
}
function call(f, args) { if (typeof f !== 'function') throw new HgsError('Das ist keine Funktion'); return f(...args); }
function binop(op, a, b, c) {
  if (op === '&&') return toBool(a(c)) && toBool(b(c));
  if (op === '||') return toBool(a(c)) || toBool(b(c));
  const x = a(c), y = b(c);
  switch (op) {
    case '+': if (typeof x === 'string' || typeof y === 'string') return String(x) + String(y); return toNum(x) + toNum(y);
    case '-': return toNum(x) - toNum(y);
    case '*': return toNum(x) * toNum(y);
    case '/': { const r = toNum(x) / toNum(y); return isInt(x) && isInt(y) ? Math.trunc(r) : r; }
    case '%': return toNum(x) % toNum(y);
    case '=': case '==': return typeof x === 'string' || typeof y === 'string' ? String(x) === String(y) : toNum(x) === toNum(y);
    case '!=': return typeof x === 'string' || typeof y === 'string' ? String(x) !== String(y) : toNum(x) !== toNum(y);
    case '<': return toNum(x) < toNum(y); case '>': return toNum(x) > toNum(y);
    case '<=': return toNum(x) <= toNum(y); case '>=': return toNum(x) >= toNum(y);
    case '<<': return toNum(x) * 2 ** toNum(y); case '>>': return Math.floor(toNum(x) / 2 ** toNum(y)); case '>>>': return Math.floor(toNum(x) / 2 ** toNum(y));
    case '&': return typeof x === 'boolean' ? x && toBool(y) : Number(BigInt(Math.trunc(toNum(x))) & BigInt(Math.trunc(toNum(y))));
    case '|': return typeof x === 'boolean' ? x || toBool(y) : Number(BigInt(Math.trunc(toNum(x))) | BigInt(Math.trunc(toNum(y))));
    case '^': return typeof x === 'boolean' ? x !== toBool(y) : Number(BigInt(Math.trunc(toNum(x))) ^ BigInt(Math.trunc(toNum(y))));
  }
  throw new HgsError('Unbekannter Operator ' + op);
}

const cache = new Map();
export function compileHgs(src) {
  if (!cache.has(src)) cache.set(src, parse(src));
  return cache.get(src);
}
// Code ausführen; vars: vordefinierte Variablen. Liefert den Kontext (seine Variablen = Argumente)
export function runHgs(src, vars = {}, parent = null) {
  const c = new Ctx(parent, true);
  for (const [k, v] of Object.entries(vars)) c.declare(k, v);
  try { compileHgs(src)(c); } catch (e) { if (e instanceof HgsError || e instanceof Error) throw new Error(e.message); throw e; }
  return c;
}
export { Ctx, HgsError };
