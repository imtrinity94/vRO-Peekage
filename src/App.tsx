import { useCallback, useEffect, useRef, useState } from "react";
import { formatBytes, parsePackage } from "./lib/parser";
import { fetchPackage, shareLink } from "./lib/fetchPackage";
import { EditsProvider, useEdits } from "./lib/editsContext";
import { ChangesPanel } from "./components/ChangesPanel";
import type { PackageInfo } from "./lib/types";
import { Sidebar } from "./components/Sidebar";
import { Overview } from "./components/Overview";
import { ElementView } from "./components/ElementView";
import { SearchView } from "./components/SearchView";
import { Landing } from "./components/Landing";
import { BackToTop } from "./components/BackToTop";
import { APP_VERSION } from "./version";

type View = { kind: "overview" } | { kind: "search" } | { kind: "element"; id: string; term?: string };

function readHash(): View {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h === "/search") return { kind: "search" };
  const m = /^\/el\/([^?]+)(?:\?q=(.*))?$/.exec(h);
  if (m) return { kind: "element", id: m[1], term: m[2] || undefined };
  return { kind: "overview" };
}
function writeHash(v: View) {
  const h = v.kind === "search" ? "#/search" : v.kind === "element" ? `#/el/${v.id}${v.term ? `?q=${encodeURIComponent(v.term)}` : ""}` : "#/";
  if (location.hash !== h) history.pushState(null, "", h);
}

type Theme = "system" | "light" | "dark";

export interface ExportState {
  running: boolean;
  done: number;
  total: number;
  label: string;
  error?: string;
}

/** The front page's own <title>, restored when going back home. */
const HOME_TITLE = typeof document !== "undefined" ? document.title : "vRO Peekage";

/** The app, with the per-package edits store around it. */
export default function App() {
  return (
    <EditsProvider>
      <AppMain />
    </EditsProvider>
  );
}

function AppMain() {
  const [pkg, setPkg] = useState<PackageInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: "overview" });
  const [drag, setDrag] = useState(false);
  /** Link the open package was loaded from (enables the Share button), if any */
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  /** Package edits (scripts / config values) and the Changes dialog */
  const { count: editCount, clear: clearEdits } = useEdits();
  const [showChanges, setShowChanges] = useState(false);
  const editCountRef = useRef(0);
  editCountRef.current = editCount;
  /** Ask before throwing away unsaved package changes. */
  const confirmDiscard = useCallback(() => {
    const n = editCountRef.current;
    return n === 0 || window.confirm(`You have ${n} unsaved change${n === 1 ? "" : "s"} in this package. Leave without downloading them?`);
  }, []);
  /** Full-screen "Downloading / Reading package" overlay */
  const [loading, setLoading] = useState<{ title: string; detail?: string; pct?: number } | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem("theme") as Theme) || "system";
    } catch {
      return "system";
    }
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const landingRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const go = useCallback((v: View) => {
    setView(v);
    writeHash(v);
    setNavOpen(false);
    mainRef.current?.scrollTo({ top: 0 });
  }, []);

  /** "Export everything": build the zip in the browser and download it. */
  const [exporting, setExporting] = useState<ExportState | null>(null);
  const runExport = useCallback(async () => {
    if (!pkg || exporting?.running) return;
    setExporting({ running: true, done: 0, total: 1, label: "Starting" });
    try {
      const { exportEverything } = await import("./lib/exporter");
      const { blob, fileName } = await exportEverything(pkg, (done, total, label) => setExporting({ running: true, done, total, label }));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setExporting({ running: false, done: 1, total: 1, label: `Saved ${fileName}` });
    } catch (e) {
      setExporting({ running: false, done: 0, total: 1, label: "", error: `Export failed: ${(e as Error).message}` });
    }
  }, [pkg, exporting]);

  /** Close the open package and return to the front page. */
  const goHome = useCallback(() => {
    if (!confirmDiscard()) return;
    clearEdits();
    setShowChanges(false);
    setPkg(null);
    setError(null);
    setExporting(null);
    setSourceUrl(null);
    setNavOpen(false);
    setView({ kind: "overview" });
    document.title = HOME_TITLE;
    if (location.hash || location.search) history.pushState(null, "", location.pathname);
  }, [confirmDiscard, clearEdits]);


  const load = useCallback(async (file: File, fromUrl?: string, confirmed = false) => {
    if (!confirmed && !confirmDiscard()) return;
    setBusy(true);
    setError(null);
    setLoading({ title: "Reading package…", detail: `${file.name} · ${formatBytes(file.size)}` });
    // let the overlay paint before the (synchronous-heavy) parse starts
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    try {
      const buf = await file.arrayBuffer();
      const p = await parsePackage(buf, file.name);
      if (!p.elements.length && !Object.keys(p.meta).length) throw new Error("This doesn't look like a vRO package (no dunes-meta-inf or elements/ found).");
      clearEdits();
      setShowChanges(false);
      setPkg(p);
      setSourceUrl(fromUrl ?? null);
      // keep ?url= in the address bar for packages opened from a link, drop it otherwise
      const search = fromUrl ? `?url=${encodeURIComponent(fromUrl)}` : "";
      if (location.search !== search) history.replaceState(null, "", location.pathname + search + location.hash);
      document.title = `${p.meta["pkg-name"] || file.name} · vRO Peekage`;
      const h = readHash();
      if (h.kind === "element" && !p.byId.has(h.id.toLowerCase())) go({ kind: "overview" });
      else if (h.kind !== "overview") setView(h);
      else go({ kind: "overview" });
    } catch (e) {
      setError(
        (e as Error).message.includes("end of central directory")
          ? "That file isn't a valid .package (zip) archive."
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
      setLoading(null);
    }
  }, [go, confirmDiscard, clearEdits]);

  /** "Open from URL" and shared ?url= links */
  const loadUrl = useCallback(async (url: string) => {
    if (!confirmDiscard()) return;
    setBusy(true);
    setError(null);
    let host = "";
    try {
      host = new URL(url.trim()).hostname;
    } catch {
      /* reported by fetchPackage */
    }
    setLoading({ title: "Downloading package…", detail: host });
    try {
      const { file } = await fetchPackage(url, (loaded, total) =>
        setLoading({
          title: "Downloading package…",
          detail: `${host} · ${formatBytes(loaded)}${total ? ` of ${formatBytes(total)}` : ""}`,
          pct: total ? Math.min(100, Math.round((loaded / total) * 100)) : undefined,
        }),
      );
      await load(file, url.trim(), true);
    } catch (e) {
      setError(`Couldn't open that link: ${(e as Error).message}`);
      setBusy(false);
      setLoading(null);
    }
  }, [load, confirmDiscard]);

  // Back / Forward: follow the address bar. Within a package only the #/view changes; when the
  // ?url= part changes (e.g. Back after Home) open or close the linked package to match.
  const pkgRef = useRef<{ pkg: PackageInfo | null; sourceUrl: string | null }>({ pkg: null, sourceUrl: null });
  pkgRef.current = { pkg, sourceUrl };
  useEffect(() => {
    const onPop = () => {
      const url = new URLSearchParams(location.search).get("url");
      const cur = pkgRef.current;
      if (url && url !== cur.sourceUrl) {
        void loadUrl(url);
        return;
      }
      if (!url && cur.sourceUrl) {
        // went back to the front page from a linked package
        setPkg(null);
        setSourceUrl(null);
        setExporting(null);
        setError(null);
        document.title = HOME_TITLE;
        return;
      }
      setView(readHash());
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [loadUrl]);

  // Open a shared link: vro-peekage.vercel.app/?url=<package-url>
  useEffect(() => {
    const shared = new URLSearchParams(location.search).get("url");
    if (shared) void loadUrl(shared);
    // run once on start-up
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyShareLink = useCallback(() => {
    if (!sourceUrl) return;
    navigator.clipboard?.writeText(shareLink(sourceUrl)).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    });
  }, [sourceUrl]);

  // Warn before closing / reloading the tab with unsaved package changes
  useEffect(() => {
    if (!editCount) return;
    const onBefore = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [editCount]);

  // Global drag & drop
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      depth++;
      setDrag(true);
    };
    const over = (e: DragEvent) => e.preventDefault();
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDrag(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDrag(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) load(f);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [load]);

  const picker = (
    <input
      ref={inputRef}
      type="file"
      accept=".package,.zip,application/zip"
      hidden
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) load(f);
        e.target.value = "";
      }}
    />
  );

  const themeBtn = (
    <button
      className="btn-ghost icon-btn"
      title={`Theme: ${theme} (click to change)`}
      aria-label={`Theme: ${theme}`}
      onClick={() => setTheme(theme === "system" ? "light" : theme === "light" ? "dark" : "system")}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {theme === "dark" ? (
          <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
        ) : theme === "light" ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </>
        ) : (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
          </>
        )}
      </svg>
    </button>
  );

  const el = view.kind === "element" && pkg ? pkg.byId.get(view.id.toLowerCase()) : undefined;

  return (
    <div className="app">
      {picker}
      {loading && (
        <div className="load-overlay" role="status" aria-live="polite">
          <div className="load-card">
            <span className="load-logo"><Logo size={56} /></span>
            <strong>{loading.title}</strong>
            {loading.detail && <span className="load-detail">{loading.detail}</span>}
            <span className={`load-bar${loading.pct === undefined ? " indeterminate" : ""}`}>
              <span style={loading.pct !== undefined ? { width: `${loading.pct}%` } : undefined} />
            </span>
          </div>
        </div>
      )}
      {drag && (
        <div className="drop-overlay">
          <div>Drop your .package file</div>
        </div>
      )}
      <header className="topbar">
        {pkg && (
          <button className="btn-ghost only-mobile" onClick={() => setNavOpen(!navOpen)} aria-label="Toggle navigation">☰</button>
        )}
        <button className="brand" onClick={() => pkg && go({ kind: "overview" })}>
          <Logo size={30} /> <span className="brand-name"><b>vRO</b> Peekage</span>
          <span className="brand-version" title={`vRO Peekage version ${APP_VERSION}`}>v{APP_VERSION}</span>
        </button>
        {pkg && (
          <>
            <span className="pkg-name ellipsis" title={pkg.fileName}>{pkg.meta["pkg-name"] || pkg.fileName}</span>
            <div className="spacer" />
            <button className="btn-ghost home-btn" onClick={goHome} aria-label="Home" title="Close this package and go to the front page">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9" />
              </svg>
              <span>Home</span>
            </button>
            <button className={`btn-ghost ${view.kind === "overview" ? "on" : ""}`} onClick={() => go({ kind: "overview" })}>Overview</button>
            <button className={`btn-ghost ${view.kind === "search" ? "on" : ""}`} onClick={() => go({ kind: "search" })}>Search</button>
            <button
              className="btn-ghost export-btn"
              onClick={runExport}
              disabled={!!exporting?.running}
              aria-label="Export everything as a zip"
              title="Export everything: report, diagrams, scripts and files as one zip"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 3v12M7 10l5 5 5-5M4 17v3h16v-3" />
              </svg>
              <span>{exporting?.running ? `${Math.round((exporting.done / exporting.total) * 100)}%` : "Export"}</span>
            </button>
            {editCount > 0 && (
              <button className="btn-ghost export-btn changes-btn" onClick={() => setShowChanges(true)} title="Review your changes and download a modified package">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                </svg>
                <span>Changes</span>
                <span className="chg-badge">{editCount}</span>
              </button>
            )}
            {sourceUrl && (
              <button className="btn-ghost export-btn" onClick={copyShareLink} title="Copy a link that opens this package in vRO Peekage" aria-label="Copy share link">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
                </svg>
                <span>{linkCopied ? "Copied" : "Share"}</span>
              </button>
            )}
            <button className="btn" onClick={() => inputRef.current?.click()}>Open…</button>
          </>
        )}
        {!pkg && (
          <>
            <div className="spacer" />
            <a className="btn-ghost icon-btn" href="https://github.com/imtrinity94/vRO-Package-Viewer" target="_blank" rel="noreferrer" aria-label="Source code on GitHub" title="Source code on GitHub">
              <svg width="22" height="22" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
              </svg>
            </a>
          </>
        )}
        {themeBtn}
      </header>

      {!pkg ? (
        <Landing scrollRef={landingRef} onPick={() => inputRef.current?.click()} onOpenUrl={loadUrl} busy={busy} error={error} dragging={drag} />
      ) : (
        <div className={`shell ${navOpen ? "nav-open" : ""}`}>
          <Sidebar pkg={pkg} selected={view.kind === "element" ? el?.id : undefined} onSelect={(id) => go({ kind: "element", id })} />
          <main className="main" ref={mainRef}>
            {busy && <div className="callout">Reading package…</div>}
            {error && <div className="callout warn">{error}</div>}
            {showChanges && <ChangesPanel pkg={pkg} onClose={() => setShowChanges(false)} onNav={(id) => go({ kind: "element", id })} />}
            {view.kind === "overview" && <Overview pkg={pkg} onNav={(id) => go({ kind: "element", id })} onExport={runExport} exporting={exporting} />}
            {view.kind === "search" && <SearchView pkg={pkg} onOpen={(id, term) => go({ kind: "element", id, term })} />}
            {view.kind === "element" && el && <ElementView key={el.id + (view.term ?? "")} el={el} pkg={pkg} onNav={(id) => go({ kind: "element", id })} term={view.term} />}
            {view.kind === "element" && !el && <p className="muted">Element not found in this package.</p>}
          </main>
        </div>
      )}
      <BackToTop key={pkg ? "app" : "home"} target={pkg ? mainRef : landingRef} />
    </div>
  );
}

/** Peek Box mark. `size` <= 32 uses the simplified small-size drawing. */
function Logo({ size = 24 }: { size?: number }) {
  const small = size <= 32;
  return (
    <svg className="logo" width={size} height={size} viewBox={small ? "5 11 54 50" : "0 0 64 64"} fill="none" aria-hidden>
      {small ? (
        <>
          <path d="M12.5 27.5 Q23.5 16.5 34.5 27.5 Q23.5 35 12.5 27.5z" fill="var(--brand-amber)" />
          <circle cx="24" cy="27" r="4" fill="var(--brand-ink)" />
        </>
      ) : (
        <>
          <path d="M14 28 Q24 18.5 34 28 Q24 34.5 14 28z" fill="var(--brand-amber)" />
          <circle cx="25" cy="27.6" r="3.4" fill="var(--brand-ink)" />
        </>
      )}
      <path d="M9 33h46v19a5 5 0 0 1-5 5H14a5 5 0 0 1-5-5z" fill="var(--brand-fg)" />
      {!small && <path d="M32 33v24" stroke="var(--bg)" strokeWidth="2.5" opacity=".35" />}
      <g transform="rotate(17 55 33)">
        <rect x="9" y="24.5" width="48" height="8.5" rx="3" fill="var(--brand-fg)" />
      </g>
    </svg>
  );
}
