import { useMemo, useState } from "react";
import type { PackageInfo, PkgElement } from "../lib/types";
import { KindIcon } from "./Icons";
import { useEditsOptional } from "../lib/editsContext";

const GROUPS: { kind: PkgElement["kind"]; label: string }[] = [
  { kind: "run", label: "Workflow runs" },
  { kind: "workflow", label: "Workflows" },
  { kind: "action", label: "Actions" },
  { kind: "config", label: "Configuration Elements" },
  { kind: "resource", label: "Resource Elements" },
  { kind: "environment", label: "Environments" },
  { kind: "generic", label: "Other" },
];

interface Folder {
  name: string;
  folders: Map<string, Folder>;
  items: PkgElement[];
}

function buildTree(els: PkgElement[], flatModules: boolean): Folder {
  const root: Folder = { name: "", folders: new Map(), items: [] };
  for (const e of els) {
    const path = flatModules && e.kind === "action" ? [e.path.join(".") || "(no module)"] : e.path;
    let f = root;
    for (const p of path) {
      if (!f.folders.has(p)) f.folders.set(p, { name: p, folders: new Map(), items: [] });
      f = f.folders.get(p)!;
    }
    f.items.push(e);
  }
  return root;
}

function countItems(f: Folder): number {
  let n = f.items.length;
  for (const c of f.folders.values()) n += countItems(c);
  return n;
}

function FolderNode({ f, depth, selected, onSelect, forceOpen }: { f: Folder; depth: number; selected?: string; onSelect: (id: string) => void; forceOpen: boolean }) {
  const [open, setOpen] = useState(true);
  const isOpen = open || forceOpen;
  const changed = useEditsOptional()?.edits;
  const folders = [...f.folders.values()].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      {f.name && (
        <button className="tree-folder" style={{ paddingLeft: 10 + depth * 12 }} onClick={() => setOpen(!open)} aria-expanded={isOpen}>
          <span className="caret">{isOpen ? "▾" : "▸"}</span> {f.name} <span className="muted small">{countItems(f)}</span>
        </button>
      )}
      {isOpen && (
        <>
          {folders.map((c) => (
            <FolderNode key={c.name} f={c} depth={f.name ? depth + 1 : depth} selected={selected} onSelect={onSelect} forceOpen={forceOpen} />
          ))}
          {f.items.map((e) => (
            <button
              key={e.id}
              className={`tree-item ${selected === e.id ? "on" : ""}${changed?.[e.id] ? " changed" : ""}`}
              style={{ paddingLeft: 10 + (f.name ? depth + 1 : depth) * 12 }}
              onClick={() => onSelect(e.id)}
              title={e.name}
            >
              <KindIcon kind={e.kind} /> <span className="ellipsis">{e.name}</span>
              {changed?.[e.id] && <span className="tree-changed" title="Changed in this session" aria-label="changed" />}
            </button>
          ))}
        </>
      )}
    </>
  );
}

export function Sidebar({ pkg, selected, onSelect }: { pkg: PackageInfo; selected?: string; onSelect: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return pkg.elements;
    return pkg.elements.filter((e) => e.name.toLowerCase().includes(s) || e.path.join("/").toLowerCase().includes(s) || e.id.toLowerCase().includes(s));
  }, [q, pkg]);

  return (
    <nav className="sidebar" aria-label="Package contents">
      <div className="side-search">
        <input className="input" placeholder="Filter by name, folder or ID…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="tree">
        {GROUPS.map((g) => {
          const els = filtered.filter((e) => e.kind === g.kind);
          if (!els.length) return null;
          const isCollapsed = collapsed[g.kind] && !q;
          return (
            <div key={g.kind} className="tree-group">
              <button className="tree-group-head" onClick={() => setCollapsed({ ...collapsed, [g.kind]: !collapsed[g.kind] })} aria-expanded={!isCollapsed}>
                <KindIcon kind={g.kind} /> <span className="tree-group-label">{g.label}</span> <span className="count">{els.length}</span>
                <span className="caret right">{isCollapsed ? "▸" : "▾"}</span>
              </button>
              {!isCollapsed && <FolderNode f={buildTree(els, true)} depth={0} selected={selected} onSelect={onSelect} forceOpen={!!q} />}
            </div>
          );
        })}
        {!filtered.length && <p className="muted small pad">No elements match “{q}”.</p>}
      </div>
    </nav>
  );
}
