/**
 * Package edits for the open package: scripts and configuration values the user changed,
 * kept for the whole session (until another package is opened or Home is clicked).
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { editCount, type ElementEdits, type Edits } from "./rebuild";

interface EditsApi {
  edits: Edits;
  count: number;
  /** null (or the original text) removes the edit */
  setScript: (elementId: string, key: string, code: string | null) => void;
  setValue: (elementId: string, attName: string, value: string | null) => void;
  setVersion: (elementId: string, version: string | undefined) => void;
  undoElement: (elementId: string) => void;
  clear: () => void;
}

const Ctx = createContext<EditsApi | null>(null);

const empty = (): ElementEdits => ({ scripts: {}, values: {} });

function prune(edits: Edits, id: string): Edits {
  const e = edits[id];
  if (e && !Object.keys(e.scripts).length && !Object.keys(e.values).length) {
    const next = { ...edits };
    delete next[id];
    return next;
  }
  return edits;
}

export function EditsProvider({ children }: { children: ReactNode }) {
  const [edits, setEdits] = useState<Edits>({});

  const setScript = useCallback((id: string, key: string, code: string | null) => {
    setEdits((prev) => {
      const cur = prev[id] ?? empty();
      const scripts = { ...cur.scripts };
      if (code === null) delete scripts[key];
      else scripts[key] = code;
      return prune({ ...prev, [id]: { ...cur, scripts } }, id);
    });
  }, []);

  const setValue = useCallback((id: string, name: string, value: string | null) => {
    setEdits((prev) => {
      const cur = prev[id] ?? empty();
      const values = { ...cur.values };
      if (value === null) delete values[name];
      else values[name] = value;
      return prune({ ...prev, [id]: { ...cur, values } }, id);
    });
  }, []);

  const setVersion = useCallback((id: string, version: string | undefined) => {
    setEdits((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], version } } : prev));
  }, []);

  const undoElement = useCallback((id: string) => {
    setEdits((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const clear = useCallback(() => setEdits({}), []);

  const api = useMemo<EditsApi>(
    () => ({ edits, count: editCount(edits), setScript, setValue, setVersion, undoElement, clear }),
    [edits, setScript, setValue, setVersion, undoElement, clear],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useEdits(): EditsApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useEdits must be used inside <EditsProvider>");
  return v;
}

/** Same as useEdits, but returns null outside a provider (e.g. static report rendering). */
export function useEditsOptional(): EditsApi | null {
  return useContext(Ctx);
}
