import { useEffect, useState, type RefObject } from "react";
import { CodeBlock } from "./CodeBlock";
import { KindIcon } from "./Icons";
import { VRO_ICONS } from "../lib/vroIcons";
import type { PkgElement } from "../lib/types";

const REPO = "https://github.com/imtrinity94/vRO-Package-Viewer";

/** Example contents that peek out of the box. Purely illustrative. */
const SLIPS: { kind: PkgElement["kind"]; type: string; name: string }[] = [
  { kind: "workflow", type: "Workflow", name: "Provision VM with tags" },
  { kind: "action", type: "Action", name: "getVmGuestFamily" },
  { kind: "config", type: "Configuration", name: "Environment settings" },
  { kind: "resource", type: "Resource", name: "cloud-init.yaml" },
  { kind: "run", type: "Workflow run", name: "completed in 7.0 s" },
];

const SNIPPET = `var vm = System.getModule("com.acme.vcenter").getVmByName(vmName);
var family = System.getModule("com.acme.vcenter.guest").getVmGuestFamily(vm);
System.log("Guest family: " + family);
if (family === "windowsGuest") {
    scriptType = "powershell";
}`;

function PeekBox() {
  return (
    <div className="pb-frame" aria-hidden>
      <div className="pb-stage">
        <svg className="pb-eye" viewBox="12 17 24 18" width="120" height="90">
          <path d="M13 27.5 Q24 17 35 27.5 Q24 35 13 27.5z" fill="var(--brand-amber)" />
          <circle cx="25" cy="27" r="4.2" fill="var(--brand-ink)" />
          <circle cx="26.6" cy="25.6" r="1.2" fill="#fff" />
        </svg>
        <div className="pb-slips">
          {SLIPS.map((s, i) => (
            <div key={s.name} className={`pb-slip pb-slip-${i}`}>
              <KindIcon kind={s.kind} size={16} />
              <span className="pb-slip-type">{s.type}</span>
              <span className="pb-slip-name">{s.name}</span>
            </div>
          ))}
        </div>
        <div className="pb-body">
          <span className="pb-tape" />
          <span className="pb-label">.package</span>
        </div>
        <div className="pb-lid" />
      </div>
    </div>
  );
}

const iconUri = (n: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(VRO_ICONS[n])}`;

/** A tiny example drawn like the real schema view: Orchestrator icons, run path highlighted. */
function MiniSchema() {
  const font = "'Clarity City', Arial, sans-serif";
  const nodes: { x: number; icon: string; label: string; time?: string; ran?: boolean; y?: number }[] = [
    { x: 20, icon: "start", label: "Start" },
    { x: 150, icon: "scriptable-task", label: "Run guest script", time: "5.96 s", ran: true },
    { x: 290, icon: "condition", label: "Exit code 0?", ran: true },
    { x: 430, icon: "end", label: "End", ran: true },
    { x: 290, icon: "exception", label: "Throw", y: 118 },
  ];
  return (
    <svg className="mini-schema" viewBox="0 0 560 220" role="img" aria-label="Example workflow schema: start, a scriptable task that ran in 5.96 seconds, a decision, an end, and an unused exception path">
      <defs>
        <pattern id="mini-dots" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="9" cy="9" r="1" fill="#cbd4d8" /></pattern>
        {([["b", "#0079ad"], ["g", "#2e8540"], ["r", "#c92100"]] as const).map(([k, c]) => (
          <marker key={k} id={`mini-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10z" fill={c} /></marker>
        ))}
      </defs>
      <rect width="560" height="220" rx="10" fill="#fafcfd" />
      <rect width="560" height="220" rx="10" fill="url(#mini-dots)" />
      <path d="M100 36 L148 36" stroke="#0079ad" strokeWidth="2.7" markerEnd="url(#mini-b)" />
      <path d="M238 36 L288 36" stroke="#0079ad" strokeWidth="2.7" markerEnd="url(#mini-b)" />
      <path d="M378 36 L428 36" stroke="#2e8540" strokeWidth="2.7" markerEnd="url(#mini-g)" />
      <path d="M350 92 L350 114" stroke="#c92100" strokeWidth="2" strokeDasharray="5,5" opacity="0.35" markerEnd="url(#mini-r)" />
      {nodes.map((n) => {
        const y = n.y ?? 10;
        return (
          <g key={n.label} transform={`translate(${n.x},${y})`} opacity={n.y ? 0.35 : 1}>
            {n.ran && <rect x="4" y="-4" width="112" height="86" rx="8" fill="rgba(46,133,64,0.10)" stroke="#2e8540" strokeWidth="1.2" />}
            <image href={iconUri(n.icon)} x="40" y="0" width="40" height="40" />
            <text x="60" y="57" textAnchor="middle" fontSize="12" fontWeight="700" fill="#21333b" fontFamily={font}>{n.label}</text>
            {n.time && <text x="60" y="72" textAnchor="middle" fontSize="11" fontWeight="700" fill="#1d6b2f" fontFamily={font}>{n.time}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function FlowSteps() {
  const steps = [
    { title: "Export from Orchestrator", body: "Export a package from the client, or a workflow run from its run history." },
    { title: "Drop it here", body: "The .package is unzipped and read right in this tab." },
    {
      title: "Browse and export",
      body: "Read every script, search across them, and export the whole package as a zip — report, inventory, diagrams and every script as a real file.",
    },
  ];
  return (
    <ol className="flow">
      <li className="flow-start" aria-hidden />
      {steps.map((s) => (
        <li key={s.title} className="flow-step">
          <strong>{s.title}</strong>
          <span>{s.body}</span>
        </li>
      ))}
      <li className="flow-end" aria-hidden />
    </ol>
  );
}

function UrlBox({ onOpenUrl, busy }: { onOpenUrl: (url: string) => void; busy: boolean }) {
  const [url, setUrl] = useState("");
  return (
    <form
      className="lp-url"
      onSubmit={(e) => {
        e.preventDefault();
        if (url.trim()) onOpenUrl(url.trim());
      }}
    >
      <label htmlFor="lp-url-input" className="lp-url-label">or open a package from a link</label>
      <div className="lp-url-row">
        <input
          id="lp-url-input"
          className="input"
          type="url"
          inputMode="url"
          placeholder="https://github.com/…/my-workflows.package"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={busy}
          spellCheck={false}
          autoComplete="off"
        />
        <button className="btn" type="submit" disabled={busy || !url.trim()}>Open link</button>
      </div>
    </form>
  );
}

const ROLES = ["content viewer", "document generator", "XML to JS converter", "code parser", "real-time code editor", "package signer", "workflow schema viewer", "configuration element reader"];

function TypeCycle() {
  const [i, setI] = useState(0);
  const [n, setN] = useState(0);
  const [del, setDel] = useState(false);
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const word = ROLES[i];
    if (reduce) {
      const t = setTimeout(() => { setI((i + 1) % ROLES.length); setN(ROLES[(i + 1) % ROLES.length].length); }, 2200);
      if (n !== word.length) setN(word.length);
      return () => clearTimeout(t);
    }
    let t: ReturnType<typeof setTimeout>;
    if (!del && n < word.length) t = setTimeout(() => setN(n + 1), 65);
    else if (!del) t = setTimeout(() => setDel(true), 1500);
    else if (n > 0) t = setTimeout(() => setN(n - 1), 32);
    else t = setTimeout(() => { setDel(false); setI((i + 1) % ROLES.length); }, 250);
    return () => clearTimeout(t);
  }, [i, n, del]);
  return (
    <p className="lp-type" aria-label={`A ${ROLES.join(", ")}`}>
      <span aria-hidden>Your vRO </span>
      <span className="lp-type-word" aria-hidden>{ROLES[i].slice(0, n)}</span>
      <span className="lp-type-caret" aria-hidden />
    </p>
  );
}

export function Landing({ onPick, onOpenUrl, busy, error, dragging, scrollRef }: { onPick: () => void; onOpenUrl: (url: string) => void; busy: boolean; error: string | null; dragging: boolean; scrollRef?: RefObject<HTMLElement | null> }) {
  return (
    <main ref={scrollRef} className={`lp ${dragging ? "lp-dragging" : ""}`}>
      <section className="lp-hero">
        <div className="lp-copy">
          <h1 className="lp-title">
            <span className="lp-peek">
              <svg className="lp-peek-eye" viewBox="12 17 24 18" aria-hidden>
                <path d="M13 27.5 Q24 17 35 27.5 Q24 35 13 27.5z" fill="var(--brand-amber)" />
                <circle cx="25" cy="27" r="4.2" fill="var(--brand-ink)" />
              </svg>
              Peek
            </span>{" "}
            into your vRO Packages
            <span className="lp-title-sub">No Orchestrator needed.</span>
          </h1>
          <TypeCycle />
          <p className="lp-lede">
            Drop a package exported from vRealize Orchestrator 7.x, Aria Automation Orchestrator 8.x or VCF Operations Orchestrator 9.x. Its workflows, actions, configuration and resource elements, scripts and recorded runs open right here in your browser.
          </p>
          <p className="lp-ai">
            <span className="lp-ai-badge" aria-hidden>
              <svg className="lp-ai-spark" viewBox="0 0 24 24">
                <path d="M12 2 C12.8 7.6 16.4 11.2 22 12 C16.4 12.8 12.8 16.4 12 22 C11.2 16.4 7.6 12.8 2 12 C7.6 11.2 11.2 7.6 12 2Z" />
              </svg>
              <svg className="lp-ai-spark lp-ai-spark-sm" viewBox="0 0 24 24">
                <path d="M12 2 C12.8 7.6 16.4 11.2 22 12 C16.4 12.8 12.8 16.4 12 22 C11.2 16.4 7.6 12.8 2 12 C7.6 11.2 11.2 7.6 12 2Z" />
              </svg>
              <span className="lp-ai-word">AI</span>
            </span>
            <span>
              <strong>Ready for your AI assistant.</strong> Export the package as plain-text files, point your assistant at the folder, and ask it about your workflows.
            </span>
          </p>
          <div className="lp-cta">
            <button className="btn primary lp-btn" onClick={onPick} disabled={busy}>
              {busy ? "Reading package…" : "Choose a .package file"}
            </button>
            <span className="lp-hint">or drop it anywhere on this page</span>
          </div>
          <UrlBox onOpenUrl={onOpenUrl} busy={busy} />
          {error && <div className="callout warn">{error}</div>}
          <p className="lp-trust">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            Parsed in this tab. Files you choose are never uploaded.
          </p>
          <a className="lp-sign" href="#/sign">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z" /><path d="M9 12l2 2 4-4" /></svg>
            <span><strong>New: Package Signer.</strong> Re-sign any package with a fresh 10-year certificate →</span>
          </a>
        </div>
        <button className="lp-art" onClick={onPick} aria-label="Choose a .package file" disabled={busy}>
          <PeekBox />
        </button>
      </section>

      <section className="lp-show" aria-labelledby="lp-show-title">
        <h2 id="lp-show-title" className="lp-h2">What you'll see</h2>
        <div className="lp-show-grid">
          <figure className="lp-panel lp-panel-wide">
            <MiniSchema />
            <figcaption>
              <strong>Workflow schemas, drawn from the package.</strong> Bindings, inputs, outputs, input forms, and for recorded runs the path that actually ran, with timings.
            </figcaption>
          </figure>
          <figure className="lp-panel lp-panel-refs">
            <ul className="lp-refs">
              <li><KindIcon kind="workflow" /> Provision VM with tags <span className="muted">uses</span></li>
              <li className="lp-ref-in"><KindIcon kind="action" /> getVmGuestFamily</li>
              <li className="lp-ref-in"><KindIcon kind="config" /> Environment settings</li>
              <li className="lp-ref-in"><KindIcon kind="environment" /> Python 3.10 environment</li>
            </ul>
            <figcaption>
              <strong>What uses what.</strong> Actions, configuration elements and environments linked both ways.
            </figcaption>
          </figure>
          <figure className="lp-panel lp-panel-code">
            <CodeBlock code={SNIPPET} lang="javascript" title="Run guest script" highlightTerm="getModule" maxHeight={170} editable={false} />
            <figcaption>
              <strong>Every script, searchable.</strong> JavaScript, Python and PowerShell, with search across the whole package.
            </figcaption>
          </figure>
        </div>
      </section>

      <section className="lp-how" aria-labelledby="lp-how-title">
        <h2 id="lp-how-title" className="lp-h2">How it works</h2>
        <FlowSteps />
      </section>

      <footer className="lp-foot">
        <span>
          vRO Peekage is an independent community tool and is not affiliated with or endorsed by Broadcom or VMware.
        </span>
        <a href={REPO} target="_blank" rel="noreferrer">Source on GitHub</a>
      </footer>
    </main>
  );
}
