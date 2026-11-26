// Generische Schaltungen wie in Digital: Parameter (args) werden beim Einbetten festgelegt
// ("bits := 8;"), Bauteile passen sich über ihren Code an ("this.Bits = args.bits;").
// Zusätzlich kann ein Code-Bauteil (GenericCode) Bauteile und Leitungen erzeugen.
import { runHgs, Ctx } from './hgs.js';

let CircuitClass = null;
export const registerCircuitClass = C => { CircuitClass = C; };

export const isGeneric = circ => !!circ?.top?.isGeneric;
const S = 20;
const cache = new Map();
let version = 0;
export const touchGenerics = () => { version++; cache.clear(); };

// Attribute eines Bauteils als Objekt für "this"
function attrObj(comp) {
  return {
    hgsGet: k => comp.attrs[k],
    hgsSet: (k, v) => { comp.attrs[k] = typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string' ? v : v; },
  };
}
const argsKey = ctx => {
  if (!ctx) return '';
  const o = {}; for (const [k, v] of ctx.vars) if (typeof v !== 'function') o[k] = v instanceof Ctx ? argsKey(v) : v;
  return JSON.stringify(o);
};

// Standardargumente einer generischen Schaltung (aus dem Bauteil "GenericInitCode")
export function initArgs(circ) {
  const init = circ.comps.filter(c => c.type === 'GenericInitCode' && c.attrs.enabled !== false);
  if (!init.length) throw new Error('Generische Schaltung ohne Bauteil „Generische Initialisierung“.');
  if (init.length > 1) throw new Error('Mehr als eine „Generische Initialisierung“.');
  return runHgs(init[0].attrs.generic || '');
}
// Argumente für eine eingebettete generische Schaltung (Code am Baustein, z. B. "bits := 8;")
export function instanceArgs(comp, parentArgs) {
  if (comp._genArgs) return comp._genArgs;
  return runHgs(comp.attrs?.generic || '', parentArgs ? { args: parentArgs } : {});
}

// konkrete Schaltung erzeugen; Bauteil-IDs bleiben erhalten (für die Anzeige der Simulation)
export function resolveCircuit(circ, args, name = '') {
  const key = name + '#' + version + '#' + argsKey(args);
  if (name && cache.has(key)) return cache.get(key);
  const c = new CircuitClass();
  c.top = circ.top ? { ...circ.top, isGeneric: false } : null;
  c.comps = circ.comps.filter(k => k.type !== 'GenericInitCode' && k.type !== 'GenericCode')
    .map(k => ({ ...k, attrs: { ...k.attrs } }));
  c.wires = circ.wires.map(w => ({ ...w }));
  // Code-Bauteile zuerst: dürfen Bauteile und Leitungen hinzufügen
  const globals = new Map();
  for (const g of circ.comps.filter(k => k.type === 'GenericCode')) {
    runHgs(g.attrs.generic || '', {
      args, global: globals,
      addWire: (x1, y1, x2, y2) => { c.addWire(x1 * S, y1 * S, x2 * S, y2 * S); return null; },
      addComponent: (type, x, y) => {
        const t = String(type);
        const isSub = /\.dig$/i.test(t);
        const comp = c.addComp(isSub ? 'Custom' : t, x * S, y * S, {});
        if (isSub) { comp.sub = t.replace(/\.dig$/i, '').split(/[\\/]/).pop(); comp._genArgs = new Ctx(); comp._genArgs.declare('args', args); return comp._genArgs; }
        return attrObj(comp);
      },
    });
  }
  for (const k of c.comps) {
    const code = String(k.attrs.generic || '').trim();
    if (!code || k._genArgs) continue;
    if (k.type === 'Custom') {
      // Argumente für den eingebetteten Baustein; setCircuit wählt eine andere Schaltung
      k._genArgs = runHgs(code, { args, global: globals, setCircuit: n => { k.sub = String(n).replace(/\.dig$/i, '').split(/[\\/]/).pop(); return null; } });
    } else {
      runHgs(code, { args, global: globals, this: attrObj(k) });
    }
  }
  if (name) cache.set(key, c);
  return c;
}
