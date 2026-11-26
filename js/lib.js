// Bibliothek der Schaltungen eines Projekts (für Teilschaltungen/Bausteine)
export const library = new Map(); // Name -> Circuit
let version = 0;
export const libVersion = () => version;
export const touchLibrary = () => { version++; };

// Verwendet die Schaltung `name` (direkt oder indirekt) die Schaltung `target`?
export function usesCircuit(name, target, seen = new Set()) {
  if (name === target) return true;
  if (seen.has(name)) return false;
  seen.add(name);
  const c = library.get(name);
  if (!c) return false;
  return c.comps.some(k => k.type === 'Sub' && usesCircuit(k.sub, target, seen));
}

// Alle (transitiv) benutzten Bausteine
export function dependencies(name, out = new Set()) {
  const c = library.get(name);
  if (!c) return out;
  for (const k of c.comps) if (k.type === 'Sub' && !out.has(k.sub)) { out.add(k.sub); dependencies(k.sub, out); }
  return out;
}
