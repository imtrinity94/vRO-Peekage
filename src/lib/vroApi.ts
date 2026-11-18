/**
 * Links Orchestrator classes in scripts to their reference pages on modernvroapi.in.
 *
 * The class index (public/vroapi-classes.json) is built from modernvroapi.in's own data by
 * scripts/build-vroapi-index.mjs. It is fetched once, the first time a script is shown.
 */

export const VROAPI_SITE = "https://modernvroapi.in";

export interface ApiIndex {
  plugins: Record<string, string>;
  classes: Record<string, string[]>;
}

let loading: Promise<ApiIndex | null> | null = null;

export function loadApiIndex(): Promise<ApiIndex | null> {
  if (!loading) {
    loading = fetch("/vroapi-classes.json")
      .then((r) => (r.ok ? (r.json() as Promise<ApiIndex>) : null))
      .catch(() => null);
  }
  return loading;
}

export function apiUrl(plugin: string, cls: string, member?: string): string {
  return `${VROAPI_SITE}/#/plugin/${encodeURIComponent(plugin)}/class/${encodeURIComponent(cls)}${member ? `#${encodeURIComponent(member)}` : ""}`;
}

const TOKEN = /\b([A-Z][\w$]*)\b(?:\s*\.\s*([A-Za-z_$][\w$]*))?/g;

/**
 * Wraps known class names inside a highlighted <code> element in <span class="api-ref">.
 * Class names inside strings are skipped. Returns the number of links added.
 */
export function linkApiClasses(root: HTMLElement, index: ApiIndex): number {
  if (root.querySelector(".api-ref")) return 0; // already linked

  const nodes: Text[] = [];
  const starts: number[] = [];
  let full = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push(n as Text);
    starts.push(full.length);
    full += n.nodeValue ?? "";
  }

  const hits: { node: Text; from: number; to: number; cls: string; member?: string }[] = [];
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(full); m; m = TOKEN.exec(full)) {
    const cls = m[1];
    if (!index.classes[cls]) continue;
    if (full[m.index - 1] === "." ) continue; // a property such as foo.Bar, not the class
    // Find the text node holding the class name; skip names split across nodes.
    let i = 0;
    while (i + 1 < starts.length && starts[i + 1] <= m.index) i++;
    const node = nodes[i];
    const from = m.index - starts[i];
    const to = from + cls.length;
    if (to > (node.nodeValue?.length ?? 0)) continue;
    if (node.parentElement?.closest(".hljs-string, .api-ref")) continue;
    hits.push({ node, from, to, cls, member: m[2] });
  }

  // Wrap from the end so earlier offsets in the same node stay valid.
  for (let k = hits.length - 1; k >= 0; k--) {
    const h = hits[k];
    const range = document.createRange();
    range.setStart(h.node, h.from);
    range.setEnd(h.node, h.to);
    const span = document.createElement("span");
    span.className = "api-ref";
    span.dataset.cls = h.cls;
    if (h.member) span.dataset.member = h.member;
    span.tabIndex = 0;
    span.setAttribute("role", "button");
    span.title = `${h.cls}: open in modernvroapi.in`;
    range.surroundContents(span);
  }
  return hits.length;
}
