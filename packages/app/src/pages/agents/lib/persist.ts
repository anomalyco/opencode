export interface PersistStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export const KEYS = {
  graphIdx: "agents.graphIdx",
  filter: "agents.filter",
  project: "agents.project",
  splitOpen: "agents.splitOpen",
  enabled: "agents.enabled",
} as const;

export type WindowKey = "5m" | "1h" | "24h";
const WINDOWS: readonly WindowKey[] = ["5m", "1h", "24h"];
const FILTERS: readonly string[] = ["all", "working", "attention", "errors", "idle"];

const mem = new Map<string, string>();

function lsGet(key: string): string | null {
  try {
    if (typeof localStorage !== "undefined" && typeof localStorage.getItem === "function") {
      return localStorage.getItem(key);
    }
  } catch {
    // fall through to memory
  }
  try {
    return mem.has(key) ? (mem.get(key) as string) : null;
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string): void {
  try {
    if (typeof localStorage !== "undefined" && typeof localStorage.setItem === "function") {
      localStorage.setItem(key, value);
      return;
    }
  } catch {
    // fall through
  }
  try {
    mem.set(key, value);
  } catch {
    // never throw
  }
}

function lsDel(key: string): void {
  try {
    if (typeof localStorage !== "undefined" && typeof localStorage.removeItem === "function") {
      localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
  try {
    mem.delete(key);
  } catch {
    // ignore
  }
}

function getOf(store: PersistStore | undefined, key: string): string | null {
  try {
    if (store && typeof store.getItem === "function") return store.getItem(key);
  } catch {
    return lsGet(key);
  }
  return lsGet(key);
}

function setOf(store: PersistStore | undefined, key: string, value: string): void {
  try {
    if (store && typeof store.setItem === "function") {
      store.setItem(key, value);
      return;
    }
  } catch {
    // fall through to default
  }
  lsSet(key, value);
}

export function loadWindow(store?: PersistStore): WindowKey {
  try {
    const v = getOf(store, KEYS.graphIdx);
    if (v === "5m" || v === "1h" || v === "24h") return v;
    return "5m";
  } catch {
    return "5m";
  }
}

export function saveWindow(w: string, store?: PersistStore): void {
  try {
    if ((WINDOWS as readonly string[]).includes(w)) {
      setOf(store, KEYS.graphIdx, w);
    }
  } catch {
    // never throw
  }
}

export function loadFilter(store?: PersistStore): string {
  try {
    const v = getOf(store, KEYS.filter);
    if (v != null && (FILTERS as readonly string[]).includes(v)) return v;
    return "all";
  } catch {
    return "all";
  }
}

export function saveFilter(f: string, store?: PersistStore): void {
  try {
    if ((FILTERS as readonly string[]).includes(f)) {
      setOf(store, KEYS.filter, f);
    }
  } catch {
    // never throw
  }
}

export function loadProject(store?: PersistStore): string | null {
  try {
    const v = getOf(store, KEYS.project);
    if (v == null) return null;
    const parsed: unknown = JSON.parse(v);
    if (parsed === null) return null;
    if (typeof parsed === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

export function saveProject(p: string | null, store?: PersistStore): void {
  try {
    if (p == null) {
      try {
        if (store && typeof store.removeItem === "function") store.removeItem(KEYS.project);
      } catch {
        // ignore
      }
      lsDel(KEYS.project);
      return;
    }
    setOf(store, KEYS.project, JSON.stringify(p));
  } catch {
    // never throw
  }
}

export function loadSplitOpen(store?: PersistStore): boolean {
  try {
    const v = getOf(store, KEYS.splitOpen);
    if (v === "1") return true;
    if (v === "0") return false;
    return true;
  } catch {
    return true;
  }
}

export function saveSplitOpen(open: boolean, store?: PersistStore): void {
  try {
    setOf(store, KEYS.splitOpen, open ? "1" : "0");
  } catch {
    // never throw
  }
}

export function isEnabled(store?: PersistStore): boolean {
  try {
    return getOf(store, KEYS.enabled) === "1";
  } catch {
    return false;
  }
}

export function setEnabled(on: boolean, store?: PersistStore): void {
  try {
    setOf(store, KEYS.enabled, on ? "1" : "0");
  } catch {
    // never throw
  }
}
