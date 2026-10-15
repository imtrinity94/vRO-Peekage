import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { PackageInfo, PkgElement } from "../lib/types";
import { useEdits } from "../lib/editsContext";
import { ACTION_SCRIPT, compareVersions, modifiedFileName, nextVersion, rebuildPackage } from "../lib/rebuild";
import { KindIcon } from "./Icons";
import { kindLabel } from "../lib/parser";

function describe(el: PkgElement, key: string): string {
  if (key === ACTION_SCRIPT) return "Script";
  if (el.kind === "workflow") {
    const it = el.items.find((i) => i.name === key);
    return `Script of step “${it?.displayName || key}” (${key})`;
  }
  return key;
}

function short(v: string): string {
  const one = v.replace(/\s+/g, " ");
  return one.length > 40 ? `${one.slice(0, 39)}…` : one || "(empty)";
}

export function ChangesPanel({ pkg, onClose, onNav }: { pkg: PackageInfo; onClose: () => void; onNav: (id: string) => void }) {
  const { edits, count, setVersion, undoElement, clear } = useEdits();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows = Object.entries(edits)
    .map(([id, e]) => ({ id, e, el: pkg.byId.get(id.toLowerCase()) }))
    .filter((r): r is { id: string; e: (typeof edits)[string]; el: PkgElement } => !!r.el);

  const versionProblems = rows.filter(({ el, e }) => {
    const v = (e.version ?? nextVersion(el.version)).trim();
    return !v || !/^\d+(\.\d+)*$/.test(v) || compareVersions(v, el.version || "0.0.0") <= 0;
  });

  const download = async () => {
    setError(null);
    setBusy("Building package…");
    try {
      const blob = await rebuildPackage(pkg, edits, (done, total) => setBusy(`Building package… ${Math.round((done / total) * 100)}%`));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = modifiedFileName(pkg.fileName);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setBusy(null);
    } catch (e) {
      setBusy(null);
      setError(`Couldn't build the package: ${(e as Error).message}`);
    }
  };

  return createPortal(
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal changes" role="dialog" aria-modal="true" aria-labelledby="changes-title">
        <div className="modal-head">
          <h2 id="changes-title">Changes <span className="count">{count}</span></h2>
          <button className="btn-ghost icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>

        {!rows.length ? (
          <p className="muted">
            No changes yet. Use <strong>Edit</strong> on an action or workflow script, or on a configuration value, and it will be listed here.
          </p>
        ) : (
          <>
            <p className="muted small">
              Each changed element gets a higher version so Orchestrator picks it up on import. You can change the suggested version.
            </p>
            <ul className="chg-list">
              {rows.map(({ id, e, el }) => {
                const suggested = nextVersion(el.version);
                const v = e.version ?? suggested;
                const bad = versionProblems.some((p) => p.id === id);
                return (
                  <li key={id} className="chg-item">
                    <div className="chg-head">
                      <KindIcon kind={el.kind} />
                      <button
                        className="link strong"
                        onClick={() => {
                          onNav(el.id);
                          onClose();
                        }}
                      >
                        {el.name}
                      </button>
                      <span className="muted small">{kindLabel(el.kind)}</span>
                      <span className="spacer" />
                      <button className="btn-ghost sm" onClick={() => undoElement(id)} title="Discard all changes to this element">Undo</button>
                    </div>
                    <ul className="chg-what">
                      {Object.keys(e.scripts).map((k) => (
                        <li key={`s${k}`}>{describe(el, k)}</li>
                      ))}
                      {Object.entries(e.values).map(([name, val]) => {
                        const orig = el.kind === "config" ? (el.attributes.find((a) => a.name === name)?.value ?? "") : "";
                        return (
                          <li key={`v${name}`}>
                            Value <code>{name}</code>: <span className="muted">{short(orig)}</span> → <strong>{short(val)}</strong>
                          </li>
                        );
                      })}
                    </ul>
                    <label className="chg-ver">
                      Version <span className="mono muted">{el.version || "none"}</span> →
                      <input
                        className={`input mono${bad ? " invalid" : ""}`}
                        value={v}
                        onChange={(ev) => setVersion(id, ev.target.value === suggested ? undefined : ev.target.value)}
                        spellCheck={false}
                        aria-label={`New version for ${el.name}`}
                      />
                      {bad && <span className="val-err">Must be higher than {el.version || "0.0.0"}</span>}
                    </label>
                  </li>
                );
              })}
            </ul>

            <div className="callout chg-notes">
              <strong>Before you import</strong>
              <ul>
                <li>Only the scripts and values listed above change. Every other file in the package is kept exactly as exported, including its signatures.</li>
                <li>The changed files no longer match their original signatures. Treat the package as a lab or development build and review it before importing anywhere important.</li>
                <li>SecureString values are kept as they are and can't be changed here. Set them in Orchestrator after importing.</li>
                <li>If an element in Orchestrator is already at or above the new version, it shows as “Same” or “Lower Version” and is skipped unless you tick it.</li>
              </ul>
            </div>
            {error && <div className="callout warn">{error}</div>}
            <div className="modal-foot">
              <button className="btn-ghost" onClick={() => window.confirm(`Discard all ${count} changes?`) && clear()}>Discard all</button>
              <span className="spacer" />
              <button className="btn primary" onClick={download} disabled={!!busy || versionProblems.length > 0}>
                {busy ?? `Download ${modifiedFileName(pkg.fileName)}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
