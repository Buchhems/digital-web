// Bibliothek der Schaltungen eines Projekts (für Teilschaltungen/Bausteine)
// plus Systembibliothek (74xx-Chips aus "Digital", werden bei Bedarf nachgeladen)
export const library = new Map(); // Name -> Circuit (Schaltungen des Projekts)
export const sysLib = new Map();  // Name -> Circuit (74xx-Bibliothek)
let version = 0;
export const libVersion = () => version;
export const touchLibrary = () => { version++; };
export const getCircuit = name => library.get(name) || sysLib.get(name);
export const isSystem = name => !library.has(name) && sysLib.has(name);

// Verwendet die Schaltung `name` (direkt oder indirekt) die Schaltung `target`?
export function usesCircuit(name, target, seen = new Set()) {
  if (name === target) return true;
  if (seen.has(name)) return false;
  seen.add(name);
  const c = getCircuit(name);
  if (!c) return false;
  return c.comps.some(k => k.type === 'Sub' && usesCircuit(k.sub, target, seen));
}

// Alle (transitiv) benutzten Bausteine des Projekts (ohne Systembibliothek)
export function dependencies(name, out = new Set()) {
  const c = getCircuit(name);
  if (!c) return out;
  for (const k of c.comps) if (k.type === 'Sub' && !out.has(k.sub)) {
    if (library.has(k.sub)) { out.add(k.sub); dependencies(k.sub, out); }
  }
  return out;
}

// ---------- 74xx-Bibliothek ----------
let index = null;
export async function libIndex() {
  if (!index) {
    try { index = await (await fetch('lib/index.json')).json(); } catch { index = []; }
  }
  return index;
}
// Fehlende Bausteine (rekursiv) aus der Bibliothek laden. parse: (text) => Circuit
export async function loadMissing(circuits, parse) {
  const idx = await libIndex();
  const byName = new Map(idx.map(e => [e.name.toLowerCase(), e]));
  const loaded = [], notFound = new Set();
  const queue = [...circuits];
  while (queue.length) {
    const c = queue.shift();
    for (const k of c.comps) {
      if (k.type !== 'Sub' || getCircuit(k.sub)) continue;
      const e = byName.get(k.sub.toLowerCase());
      if (!e) { notFound.add(k.sub); continue; }
      try {
        const text = await (await fetch(e.path)).text();
        const sub = parse(text);
        sysLib.set(k.sub, sub); loaded.push(k.sub);
        queue.push(sub);
      } catch { notFound.add(k.sub); }
    }
  }
  if (loaded.length) touchLibrary();
  return { loaded, notFound: [...notFound] };
}
