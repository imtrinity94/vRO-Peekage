import { useEffect, useMemo, useState } from "react";
import type {
  ActionElement,
  Attrib,
  ConfigElement,
  EnvironmentElement,
  PackageInfo,
  Param,
  PkgElement,
  ResourceElement,
  WfItem,
  WorkflowElement,
} from "../lib/types";
import { formatBytes, isTextMime, kindLabel, langForMime, decodeText } from "../lib/parser";
import { CodeBlock } from "./CodeBlock";
import { useEditsOptional } from "../lib/editsContext";
import { ACTION_SCRIPT, EDITABLE_VALUE_TYPES } from "../lib/rebuild";
import { TypeLabel, ValueView } from "./ValueView";
import { SchemaDiagram } from "./SchemaDiagram";
import { KindIcon } from "./Icons";
import { RunView } from "./RunView";

type Nav = (id: string) => void;

/* ------------------------------ shared ------------------------------ */

export function download(name: string, bytes: Uint8Array | string, mime = "application/octet-stream") {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={value === t.id ? "tab on" : "tab"} onClick={() => onChange(t.id)}>
          {t.label}
          {t.count !== undefined && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Header({ el, children }: { el: PkgElement; children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <header className="el-head">
      <div className="el-kind">
        <KindIcon kind={el.kind} /> {kindLabel(el.kind, el.type)}
        {el.path.length > 0 && <span className="crumbs">{el.path.join(" / ")}</span>}
      </div>
      <h1>{el.name}</h1>
      <div className="chips">
        {el.version && <span className="chip">v{el.version}</span>}
        <button
          className="chip mono clickable"
          title="Copy ID"
          onClick={() => navigator.clipboard?.writeText(el.id).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1000); })}
        >
          {copied ? "copied ✓" : el.id}
        </button>
        {el.allowedOperations && <span className="chip" title="allowed-operations">ops: {el.allowedOperations}</span>}
        {children}
      </div>
      {el.description && <p className="el-desc">{el.description}</p>}
    </header>
  );
}

/** Inline editor for one configuration value (string / number / boolean). */
function ValueEditor({ elementId, a }: { elementId: string; a: Attrib }) {
  const ctx = useEditsOptional();
  const original = a.value ?? "";
  const changed = ctx?.edits[elementId]?.values[a.name];
  const current = changed ?? original;
  const [draft, setDraft] = useState<string | null>(null);
  if (!ctx) return null;
  const isNum = a.type === "number";
  const invalid = draft !== null && isNum && draft.trim() !== "" && !Number.isFinite(Number(draft));
  const save = () => {
    if (draft === null || invalid) return;
    ctx.setValue(elementId, a.name, draft === original ? null : draft);
    setDraft(null);
  };
  if (draft !== null) {
    return (
      <form
        className="val-edit"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {a.type === "boolean" ? (
          <select className="input" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus>
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        ) : (
          <input
            className={`input${invalid ? " invalid" : ""}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setDraft(null)}
            inputMode={isNum ? "decimal" : undefined}
            spellCheck={false}
            autoFocus
            aria-label={`New value for ${a.name}`}
          />
        )}
        <button className="btn sm" type="submit" disabled={invalid}>Save</button>
        <button className="btn-ghost sm" type="button" onClick={() => setDraft(null)}>Cancel</button>
        {invalid && <span className="val-err">Not a number</span>}
      </form>
    );
  }
  return (
    <div className="val-cell">
      {current === "" ? <span className="muted">—</span> : <ValueView value={current} />}
      {changed !== undefined && <span className="code-edited" title={`Was: ${original === "" ? "(empty)" : original}`}>changed</span>}
      <button className="btn-ghost sm val-btn" onClick={() => setDraft(current === "" && a.type === "boolean" ? "false" : current)} title="Change this value (kept in this session's changes)">
        Edit
      </button>
      {changed !== undefined && (
        <button className="btn-ghost sm val-btn" onClick={() => ctx.setValue(elementId, a.name, null)} title="Restore the original value">
          Undo
        </button>
      )}
    </div>
  );
}

function ParamTable({ rows, empty, showValue, editableIn }: { rows: (Param | Attrib)[]; empty: string; showValue?: boolean; editableIn?: string }) {
  const [reveal, setReveal] = useState(false);
  if (!rows.length) return <p className="muted">{empty}</p>;
  const hasSecure = rows.some((r) => r.type === "SecureString" && r.value);
  const hasConf = rows.some((r) => (r as Attrib).confId);
  return (
    <div className="table-wrap">
      {hasSecure && showValue && (
        <label className="reveal">
          <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} /> Show encrypted SecureString blobs
        </label>
      )}
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            {showValue && <th>Value</th>}
            {hasConf && <th>Bound to config</th>}
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const a = r as Attrib;
            let val: React.ReactNode = null;
            if (showValue) {
              if (r.type === "SecureString") {
                val = r.value ? (reveal ? <code className="wrapcode">{r.value}</code> : <span className="muted">•••••• (encrypted)</span>) : <span className="muted">—</span>;
                if (editableIn) val = <span className="val-cell" title="SecureString values can't be changed here. They are kept as they are; set them in Orchestrator after importing.">{val}<span className="val-lock">not editable</span></span>;
              } else if (editableIn && EDITABLE_VALUE_TYPES.has(r.type)) val = <ValueEditor elementId={editableIn} a={a} />;
              else if (r.value === undefined || r.value === "") val = <span className="muted">—</span>;
              else val = <ValueView value={r.value} />;
            }
            return (
              <tr key={r.name}>
                <td className="mono strong">{r.name}{a.readOnly ? <span className="tag">const</span> : null}</td>
                <td className="mono type"><TypeLabel type={r.type} /></td>
                {showValue && <td>{val}</td>}
                {hasConf && <td className="mono small">{a.confKey ? `${a.confKey}` : ""}</td>}
                <td className="desc">{r.description}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RefList({ ids, pkg, onNav, empty }: { ids: Set<string> | undefined; pkg: PackageInfo; onNav: Nav; empty: string }) {
  const list = [...(ids ?? [])].map((id) => pkg.byId.get(id)).filter(Boolean) as PkgElement[];
  if (!list.length) return <p className="muted">{empty}</p>;
  return (
    <ul className="ref-list">
      {list.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)).map((e) => (
        <li key={e.id}>
          <button className="link" onClick={() => onNav(e.id)}>
            <KindIcon kind={e.kind} /> {e.name}
          </button>
          <span className="muted small"> {kindLabel(e.kind, e.type)}{e.path.length ? ` · ${e.path.join("/")}` : ""}</span>
        </li>
      ))}
    </ul>
  );
}

export function RefsPanel({ el, pkg, onNav }: { el: PkgElement; pkg: PackageInfo; onNav: Nav }) {
  const id = el.id.toLowerCase();
  const external = useMemo(() => {
    // System.getModule calls to actions NOT in this package
    const out = new Set<string>();
    for (const s of el.scripts)
      for (const m of s.code.matchAll(/System\.getModule\(\s*["']([\w.$-]+)["']\s*\)\s*\.\s*([\w$]+)/g)) {
        const k = `${m[1]}/${m[2]}`;
        if (!pkg.actionIndex.has(k)) out.add(k);
      }
    if (el.kind === "workflow")
      for (const it of el.items) {
        if (it.scriptModule && !pkg.actionIndex.has(it.scriptModule)) out.add(it.scriptModule);
        if (it.linkedWorkflowId && !pkg.byId.has(it.linkedWorkflowId.toLowerCase())) out.add(`workflow ${it.linkedWorkflowId}`);
      }
    return [...out].sort();
  }, [el, pkg]);
  return (
    <div className="grid2">
      <section className="card">
        <h3>Uses</h3>
        <RefList ids={pkg.refs.get(id)} pkg={pkg} onNav={onNav} empty="Doesn't reference other elements in this package." />
        {external.length > 0 && (
          <>
            <h4>Outside this package</h4>
            <ul className="ref-list">
              {external.map((x) => <li key={x} className="mono small">{x}</li>)}
            </ul>
          </>
        )}
      </section>
      <section className="card">
        <h3>Used by</h3>
        <RefList ids={pkg.usedBy.get(id)} pkg={pkg} onNav={onNav} empty="Nothing in this package references it." />
      </section>
    </div>
  );
}

export function FilesPanel({ el }: { el: PkgElement }) {
  const [open, setOpen] = useState<string | null>(el.files.find((f) => f.name === "data" && f.text) ? "data" : null);
  return (
    <div>
      <p className="muted small">Raw files stored for this element inside the package (<code>elements/{el.id}/</code>).</p>
      <ul className="file-list">
        {el.files.map((f) => (
          <li key={f.name}>
            <button className={`link mono ${open === f.name ? "strong" : ""}`} disabled={!f.text} onClick={() => setOpen(open === f.name ? null : f.name)}>
              {f.name}
            </button>
            <span className="muted small"> {formatBytes(f.size)}{f.text ? "" : " · binary"}</span>{" "}
            <button className="btn-ghost sm" title="Download this file" onClick={async () => download(`${el.name}-${f.name}`, await el.getFile(f.name))}>⬇</button>
          </li>
        ))}
      </ul>
      {open && (() => {
        const f = el.files.find((x) => x.name === open);
        if (!f?.text) return null;
        const lang = f.text.trimStart().startsWith("<") ? "xml" : f.text.trimStart().startsWith("{") ? "json" : "plaintext";
        const code = lang === "json" ? tryPretty(f.text) : f.text;
        return <CodeBlock code={code} lang={lang} title={f.name} maxHeight={640} />;
      })()}
    </div>
  );
}

export function tryPretty(t: string) {
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return t;
  }
}

/* ------------------------------ workflow ------------------------------ */

function Bindings({ it, wf }: { it: WfItem; wf: WorkflowElement }) {
  const kindOf = (n?: string) => {
    if (!n) return "";
    if (wf.inputs.some((p) => p.name === n)) return "input";
    if (wf.outputs.some((p) => p.name === n)) return "output";
    if (wf.attributes.some((p) => p.name === n)) return "attribute";
    return "";
  };
  if (!it.inBindings.length && !it.outBindings.length) return null;
  return (
    <div className="grid2 tight">
      {[["IN", it.inBindings], ["OUT", it.outBindings]].map(([label, binds]) => (
        <div key={label as string}>
          <h4>{label as string} bindings</h4>
          {(binds as WfItem["inBindings"]).length === 0 ? (
            <p className="muted small">none</p>
          ) : (
            <table className="compact">
              <tbody>
                {(binds as WfItem["inBindings"]).map((b) => (
                  <tr key={b.name}>
                    <td className="mono strong">{b.name}</td>
                    <td className="mono type">{b.type}</td>
                    <td className="mono small">{label === "IN" ? "←" : "→"} {b.exportName || <span className="muted">not bound</span>} <span className="muted">{kindOf(b.exportName)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}

function ItemDetail({ it, wf, pkg, onNav, term }: { it: WfItem; wf: WorkflowElement; pkg: PackageInfo; onNav: Nav; term?: string }) {
  const edits = useEditsOptional();
  const linked = it.linkedWorkflowId ? pkg.byId.get(it.linkedWorkflowId.toLowerCase()) : undefined;
  const action = it.scriptModule ? pkg.actionIndex.get(it.scriptModule) : undefined;
  const env = it.environmentId ? pkg.byId.get(it.environmentId.toLowerCase()) : undefined;
  return (
    <section className="card item-detail" id={`item-${it.name}`}>
      <div className="item-head">
        <h3>{it.displayName || it.name}</h3>
        <span className="chip">{it.type}</span>
        <span className="chip mono">{it.name}</span>
        {it.runtime && <span className="chip" title={it.environmentId ? `Environment ${it.environmentId}` : undefined}>{it.runtimeLabel}</span>}
        {env && <button className="chip clickable" onClick={() => onNav(env.id)}>env: {env.name}</button>}
        {it.outName && <span className="chip">→ {it.outName}</span>}
        {it.altOutName && <span className="chip">alt → {it.altOutName}</span>}
        {it.catchName && <span className="chip warn">catch → {it.catchName}</span>}
      </div>
      {it.description && <p className="el-desc">{it.description}</p>}
      {it.linkedWorkflowId && (
        <p>Calls workflow: {linked ? <button className="link" onClick={() => onNav(linked.id)}>{linked.name}</button> : <code>{it.linkedWorkflowId}</code>} {!linked && <span className="muted small">(not in this package)</span>}</p>
      )}
      {it.scriptModule && (
        <p>Calls action: {action ? <button className="link" onClick={() => onNav(action)}>{it.scriptModule}</button> : <code>{it.scriptModule}</code>} {!action && <span className="muted small">(not in this package)</span>}</p>
      )}
      <Bindings it={it} wf={wf} />
      {it.script && it.script.trim() && (
        <CodeBlock code={it.script} lang={it.lang} title="Script" highlightTerm={term} maxHeight={560} edited={edits?.edits[wf.id]?.scripts[it.name]} onEdit={edits ? (c) => edits.setScript(wf.id, it.name, c) : undefined} />
      )}
    </section>
  );
}

function InputFormView({ wf }: { wf: WorkflowElement }) {
  if (!wf.inputForms.length) return <p className="muted">This workflow has no custom input form.</p>;
  return (
    <div className="stack">
      {wf.inputForms.map((f) => {
        const j = f.json as { layout?: { pages?: { title?: string; sections?: { fields?: { id: string; display?: string; state?: Record<string, unknown> }[] }[] }[] }; schema?: Record<string, Record<string, unknown>> } | null;
        const rows: { page: string; id: string; display?: string; label?: string; type?: string; def?: string; source?: string }[] = [];
        for (const p of j?.layout?.pages ?? [])
          for (const s of p.sections ?? [])
            for (const fld of s.fields ?? []) {
              const sc = j?.schema?.[fld.id] ?? {};
              const t = sc.type as { dataType?: string; isMultiple?: boolean } | undefined;
              const vl = sc.valueList as { id?: string; type?: string } | undefined;
              const dflt = sc.default;
              rows.push({
                page: p.title ?? "",
                id: fld.id,
                display: fld.display,
                label: sc.label as string | undefined,
                type: t ? `${t.dataType ?? ""}${t.isMultiple ? "[]" : ""}` : undefined,
                def: dflt === undefined || (dflt && typeof dflt === "object" && "bind" in (dflt as object)) ? undefined : typeof dflt === "string" ? dflt : JSON.stringify(dflt),
                source: vl
                  ? `${vl.type ?? ""} ${vl.id ?? ""}`.trim()
                  : dflt && typeof dflt === "object" && "bind" in (dflt as object)
                    ? `bound to ${String((dflt as { bind: unknown }).bind)}`
                    : undefined,
              });
            }
        const label = f.name === "input_form_" ? "Start form" : `Form: ${f.name.replace("input_form_", "")} (user interaction)`;
        return (
          <section key={f.name} className="card">
            <h3>{label}</h3>
            {rows.length > 0 ? (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Page</th><th>Field</th><th>Label</th><th>Display</th><th>Type</th><th>Default / value source</th></tr></thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td className="small">{r.page}</td>
                        <td className="mono strong">{r.id}</td>
                        <td>{r.label}</td>
                        <td className="mono small">{r.display}</td>
                        <td className="mono type">{r.type}</td>
                        <td className="small desc">{r.source ? <code>{r.source}</code> : null} {r.def && <span>{r.def.length > 160 ? r.def.slice(0, 160) + "…" : r.def}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted small">No fields in layout.</p>
            )}
            <details>
              <summary>Raw form JSON</summary>
              <CodeBlock code={j ? JSON.stringify(j, null, 2) : f.text} lang="json" maxHeight={500} />
            </details>
          </section>
        );
      })}
    </div>
  );
}

function WorkflowView({ el, pkg, onNav, term }: { el: WorkflowElement; pkg: PackageInfo; onNav: Nav; term?: string }) {
  type T = "overview" | "schema" | "scripts" | "form" | "refs" | "files";
  const [tab, setTab] = useState<T>(term ? "scripts" : "overview");
  const [sel, setSel] = useState<string | undefined>(el.rootName);
  const selItem = el.items.find((i) => i.name === sel);
  const polyglot = el.items.some((i) => i.runtime);
  const refCount = (pkg.refs.get(el.id.toLowerCase())?.size ?? 0) + (pkg.usedBy.get(el.id.toLowerCase())?.size ?? 0);
  const typeCounts = el.items.reduce<Record<string, number>>((a, i) => ((a[i.type] = (a[i.type] ?? 0) + 1), a), {});

  return (
    <>
      <Header el={el}>
        {el.apiVersion && <span className="chip">api {el.apiVersion}</span>}
        {pkg.elements
          .filter((r) => r.kind === "run" && r.workflowId?.toLowerCase() === el.id.toLowerCase())
          .slice(0, 5)
          .map((r) => (
            <button key={r.id} className="chip clickable run-chip" onClick={() => onNav(r.id)} title="Open this recorded run">
              <KindIcon kind="run" /> Run{r.kind === "run" && r.globalState ? ` · ${r.globalState}` : ""}
            </button>
          ))}
        {polyglot && <span className="chip accent">polyglot</span>}
      </Header>
      <Tabs<T>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "Parameters" },
          { id: "schema", label: "Schema", count: el.items.length },
          { id: "scripts", label: "Scripts", count: el.scripts.length },
          { id: "form", label: "Input form", count: el.inputForms.length },
          { id: "refs", label: "References", count: refCount },
          { id: "files", label: "Raw", count: el.files.length },
        ]}
      />
      {tab === "overview" && (
        <div className="stack">
          <section className="card"><h3>Inputs <span className="count">{el.inputs.length}</span></h3><ParamTable rows={el.inputs} empty="No inputs." /></section>
          <section className="card"><h3>Outputs <span className="count">{el.outputs.length}</span></h3><ParamTable rows={el.outputs} empty="No outputs." /></section>
          <section className="card"><h3>Variables / attributes <span className="count">{el.attributes.length}</span></h3><ParamTable rows={el.attributes} empty="No attributes." showValue /></section>
          <section className="card">
            <h3>Schema items</h3>
            <p className="small">{Object.entries(typeCounts).map(([k, v]) => `${v} × ${k}`).join(" · ")}</p>
          </section>
        </div>
      )}
      {tab === "schema" && (
        <div className="stack">
          <section className="card">
            <SchemaDiagram wf={el} selected={sel} onSelect={setSel} />
          </section>
          <div className="item-picker">
            {el.items.map((i) => (
              <button key={i.name} className={`pill ${sel === i.name ? "on" : ""}`} onClick={() => setSel(i.name)}>
                {i.displayName || i.name} <span className="muted">· {i.type}</span>
              </button>
            ))}
          </div>
          {selItem && <ItemDetail it={selItem} wf={el} pkg={pkg} onNav={onNav} term={term} />}
        </div>
      )}
      {tab === "scripts" && (
        <div className="stack">
          {el.items.filter((i) => i.script && i.script.trim()).length === 0 && <p className="muted">No scripts in this workflow.</p>}
          {el.items.filter((i) => i.script && i.script.trim()).map((i) => (
            <ItemDetail key={i.name} it={i} wf={el} pkg={pkg} onNav={onNav} term={term} />
          ))}
        </div>
      )}
      {tab === "form" && <InputFormView wf={el} />}
      {tab === "refs" && <RefsPanel el={el} pkg={pkg} onNav={onNav} />}
      {tab === "files" && <FilesPanel el={el} />}
    </>
  );
}

/* ------------------------------ action ------------------------------ */

function ActionView({ el, pkg, onNav, term }: { el: ActionElement; pkg: PackageInfo; onNav: Nav; term?: string }) {
  const edits = useEditsOptional();
  type T = "code" | "refs" | "files";
  const [tab, setTab] = useState<T>("code");
  const env = el.environmentId ? pkg.byId.get(el.environmentId.toLowerCase()) : undefined;
  const lang = el.lang;
  return (
    <>
      <Header el={el}>
        <span className="chip" title={el.environmentId ? `Environment ${el.environmentId}` : undefined}>{el.runtimeLabel}</span>
        {el.hasBundle && <span className="chip accent">bundle</span>}
        {el.memoryLimit && <span className="chip">mem {formatBytes(Number(el.memoryLimit))}</span>}
        {el.timeout && <span className="chip">timeout {el.timeout}s</span>}
        {env && <button className="chip clickable" onClick={() => onNav(env.id)}>env: {env.name}</button>}
      </Header>
      <Tabs<T> value={tab} onChange={setTab} tabs={[{ id: "code", label: "Script" }, { id: "refs", label: "References" }, { id: "files", label: "Raw", count: el.files.length }]} />
      {tab === "code" && (
        <div className="stack">
          <section className="card">
            <h3>Inputs <span className="count">{el.params.length}</span></h3>
            <ParamTable rows={el.params} empty="This action takes no inputs." />
            <h3 className="io-head">Output</h3>
            <table className="io-out">
              <tbody>
                <tr>
                  <th scope="row">Type</th>
                  <td className="mono type">{el.resultType && el.resultType !== "void" ? <TypeLabel type={el.resultType} /> : <span className="muted">void (returns nothing)</span>}</td>
                </tr>
              </tbody>
            </table>
          </section>
          {el.script.trim() ? <CodeBlock code={el.script} lang={lang} title={`${el.name}`} highlightTerm={term} edited={edits?.edits[el.id]?.scripts[ACTION_SCRIPT]} onEdit={edits ? (c) => edits.setScript(el.id, ACTION_SCRIPT, c) : undefined} /> : <p className="muted">No inline script{el.hasBundle ? " — code lives in the bundle zip (see Raw tab)." : "."}</p>}
          {el.hasBundle && (
            <p><button className="btn" onClick={async () => download(`${el.name}-bundle.zip`, await el.getFile("bundle"), "application/zip")}>⬇ Download action bundle (zip)</button></p>
          )}
        </div>
      )}
      {tab === "refs" && <RefsPanel el={el} pkg={pkg} onNav={onNav} />}
      {tab === "files" && <FilesPanel el={el} />}
    </>
  );
}

/* ------------------------------ config ------------------------------ */

function ConfigView({ el, pkg, onNav }: { el: ConfigElement; pkg: PackageInfo; onNav: Nav }) {
  type T = "atts" | "refs" | "files";
  const [tab, setTab] = useState<T>("atts");
  const secure = el.attributes.filter((a) => a.type === "SecureString").length;
  return (
    <>
      <Header el={el}>
        {secure > 0 && <span className="chip warn">{secure} SecureString</span>}
      </Header>
      <Tabs<T> value={tab} onChange={setTab} tabs={[{ id: "atts", label: "Attributes", count: el.attributes.length }, { id: "refs", label: "Used by", count: pkg.usedBy.get(el.id.toLowerCase())?.size ?? 0 }, { id: "files", label: "Raw", count: el.files.length }]} />
      {tab === "atts" && <section className="card"><ParamTable rows={el.attributes} empty="No attributes." showValue editableIn={el.id} /></section>}
      {tab === "refs" && <RefsPanel el={el} pkg={pkg} onNav={onNav} />}
      {tab === "files" && <FilesPanel el={el} />}
    </>
  );
}

/* ------------------------------ resource ------------------------------ */

function ResourceView({ el, pkg, onNav }: { el: ResourceElement; pkg: PackageInfo; onNav: Nav }) {
  type T = "preview" | "refs" | "files";
  const [tab, setTab] = useState<T>("preview");
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const mime = el.mimeType || "application/octet-stream";
  const isImg = mime.startsWith("image/");
  const isPdf = mime === "application/pdf" || /\.pdf$/i.test(el.name);
  const isText = isTextMime(mime, el.name);

  useEffect(() => {
    let alive = true;
    let u: string | null = null;
    setUrl(null);
    setText(null);
    (async () => {
      if ((el.size ?? 0) > 50 * 1024 * 1024) return;
      const bytes = await el.getBytes();
      if (!alive) return;
      if (isText) setText(decodeText(bytes));
      else if (isImg || isPdf) {
        u = URL.createObjectURL(new Blob([bytes as BlobPart], { type: isPdf ? "application/pdf" : mime }));
        setUrl(u);
      }
    })();
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [el]);

  return (
    <>
      <Header el={el}>
        <span className="chip">{mime}</span>
        <span className="chip">{formatBytes(el.size)}</span>
        <button className="chip clickable" onClick={async () => download(el.name, await el.getBytes(), mime)}>⬇ Download</button>
      </Header>
      <Tabs<T> value={tab} onChange={setTab} tabs={[{ id: "preview", label: "Preview" }, { id: "refs", label: "References", count: pkg.usedBy.get(el.id.toLowerCase())?.size ?? 0 }, { id: "files", label: "Raw", count: el.files.length }]} />
      {tab === "preview" && (
        <div className="stack">
          {text !== null && <CodeBlock code={langForMime(mime, el.name) === "json" ? tryPretty(text) : text} lang={langForMime(mime, el.name)} title={el.name} maxHeight={720} />}
          {url && isImg && <img className="res-img" src={url} alt={el.name} />}
          {url && isPdf && (
            <>
              <p className="small"><a href={url} target="_blank" rel="noreferrer">Open PDF in a new tab</a></p>
              <iframe className="res-pdf" src={url} title={el.name} />
            </>
          )}
          {!isText && !isImg && !isPdf && <p className="muted">No inline preview for <code>{mime}</code>. Use Download to open it locally.</p>}
        </div>
      )}
      {tab === "refs" && <RefsPanel el={el} pkg={pkg} onNav={onNav} />}
      {tab === "files" && <FilesPanel el={el} />}
    </>
  );
}

/* ------------------------------ environment ------------------------------ */

function EnvironmentView({ el, pkg, onNav }: { el: EnvironmentElement; pkg: PackageInfo; onNav: Nav }) {
  type T = "deps" | "bundle" | "refs" | "files";
  const [tab, setTab] = useState<T>("deps");
  const [list, setList] = useState<{ name: string; size: number; dir: boolean }[] | null>(null);
  const [filter, setFilter] = useState("");
  useEffect(() => {
    if (tab === "bundle" && !list) el.listBundle().then(setList);
  }, [tab]);
  const deps = Object.entries(el.dependencies);
  const vars = Object.entries(el.environmentVariables);
  const topLevel = useMemo(() => {
    if (!list) return [];
    const m = new Map<string, { files: number; size: number }>();
    for (const f of list) {
      if (f.dir) continue;
      const parts = f.name.split("/");
      const k = parts.length > 3 ? parts.slice(0, 3).join("/") : parts.slice(0, -1).join("/") || "/";
      const v = m.get(k) ?? { files: 0, size: 0 };
      v.files++;
      v.size += f.size;
      m.set(k, v);
    }
    return [...m.entries()].sort((a, b) => b[1].size - a[1].size);
  }, [list]);
  return (
    <>
      <Header el={el}>
        {el.runtime && <span className="chip accent">{el.runtime}</span>}
        {typeof el.meta.memoryLimit === "number" && <span className="chip">mem {formatBytes(el.meta.memoryLimit as number)}</span>}
        {el.meta.timeout !== undefined && <span className="chip">timeout {String(el.meta.timeout)}s</span>}
        {el.hasBundle && <button className="chip clickable" onClick={async () => { const b = await el.getBundleBytes(); if (b) download(`${el.name}-bundle.zip`, b, "application/zip"); }}>⬇ Bundle zip</button>}
      </Header>
      <Tabs<T> value={tab} onChange={setTab} tabs={[{ id: "deps", label: "Dependencies", count: deps.length }, { id: "bundle", label: "Bundle contents" }, { id: "refs", label: "Used by", count: pkg.usedBy.get(el.id.toLowerCase())?.size ?? 0 }, { id: "files", label: "Raw", count: el.files.length }]} />
      {tab === "deps" && (
        <div className="stack">
          <section className="card">
            <h3>Packages</h3>
            {deps.length ? (
              <table><thead><tr><th>Package</th><th>Version</th></tr></thead><tbody>{deps.map(([k, v]) => <tr key={k}><td className="mono strong">{k}</td><td className="mono">{v}</td></tr>)}</tbody></table>
            ) : <p className="muted">No dependencies declared.</p>}
          </section>
          <section className="card">
            <h3>Environment variables</h3>
            {vars.length ? (
              <table><tbody>{vars.map(([k, v]) => <tr key={k}><td className="mono strong">{k}</td><td className="mono">{String(v)}</td></tr>)}</tbody></table>
            ) : <p className="muted">None.</p>}
          </section>
        </div>
      )}
      {tab === "bundle" && (
        <section className="card">
          {!el.hasBundle && <p className="muted">No bundle in this package.</p>}
          {el.hasBundle && !list && <p className="muted">Reading bundle…</p>}
          {list && (
            <>
              <p className="small">{list.filter((f) => !f.dir).length} files · {formatBytes(list.reduce((s, f) => s + f.size, 0))} uncompressed</p>
              <h4>Largest folders</h4>
              <table className="compact"><tbody>{topLevel.slice(0, 15).map(([k, v]) => <tr key={k}><td className="mono">{k}</td><td className="small">{v.files} files</td><td className="small">{formatBytes(v.size)}</td></tr>)}</tbody></table>
              <h4>All files</h4>
              <input className="input" placeholder="Filter files…" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <div className="file-scroll">
                {list.filter((f) => !f.dir && f.name.toLowerCase().includes(filter.toLowerCase())).slice(0, 2000).map((f) => (
                  <div key={f.name} className="mono small file-row"><span>{f.name}</span><span className="muted">{formatBytes(f.size)}</span></div>
                ))}
              </div>
            </>
          )}
        </section>
      )}
      {tab === "refs" && <RefsPanel el={el} pkg={pkg} onNav={onNav} />}
      {tab === "files" && <FilesPanel el={el} />}
    </>
  );
}

/* ------------------------------ dispatcher ------------------------------ */

export function ElementView({ el, pkg, onNav, term }: { el: PkgElement; pkg: PackageInfo; onNav: Nav; term?: string }) {
  switch (el.kind) {
    case "workflow": return <WorkflowView key={el.id} el={el} pkg={pkg} onNav={onNav} term={term} />;
    case "action": return <ActionView key={el.id} el={el} pkg={pkg} onNav={onNav} term={term} />;
    case "config": return <ConfigView key={el.id} el={el} pkg={pkg} onNav={onNav} />;
    case "resource": return <ResourceView key={el.id} el={el} pkg={pkg} onNav={onNav} />;
    case "environment": return <EnvironmentView key={el.id} el={el} pkg={pkg} onNav={onNav} />;
    case "run": return <RunView key={el.id} el={el} pkg={pkg} onNav={onNav} />;
    default:
      return (
        <>
          <Header el={el} />
          <RefsPanel el={el} pkg={pkg} onNav={onNav} />
          <h3>Raw files</h3>
          <FilesPanel el={el} />
        </>
      );
  }
}
