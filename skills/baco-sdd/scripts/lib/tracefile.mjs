// Reads and validates a trace JSON file (output of `baco trace --out`).
import { readText } from './markdown.mjs';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Returns { trace } or { error: 'json' | 'shape' | 'filtered', detail }. ENOENT propagates (exit 65 in the dispatcher).
export function loadTrace(path) {
  const raw = readText(path);
  let trace;
  try { trace = JSON.parse(raw); } catch (e) { return { error: 'json', detail: e.message }; }
  const wellFormed = isObj(trace) && Array.isArray(trace.cas) && trace.cas.every((c) => isObj(c)
    && (c.scenarios === undefined || (Array.isArray(c.scenarios) && c.scenarios.every(isObj))));
  if (!wellFormed) return { error: 'shape', detail: 'cas' };
  // Optional (older traces have none); when present, a list of scenario objects with an id.
  const others = trace.otherScenarios;
  if (others !== undefined && !(Array.isArray(others) && others.every((s) => isObj(s) && typeof s.id === 'string' && s.id))) {
    return { error: 'shape', detail: 'otherScenarios' };
  }
  // A trace restricted with `trace --ca` proves only some criteria: never input for a whole delivery.
  if (Array.isArray(trace.filter) && trace.filter.length) return { error: 'filtered', detail: trace.filter.join(',') };
  return { trace };
}
