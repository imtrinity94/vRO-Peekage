/**
 * Links Orchestrator classes in scripts to their reference pages on modernvroapi.in, and
 * JavaScript built-ins (JSON, Math, Error ...) to MDN.
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

const MDN = "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects";

/**
 * ES5 built-ins available in Orchestrator's Rhino engine. modernvroapi.in documents only some of
 * them (Array, Date, String ...), so these also link to MDN.
 */
const JS_BUILTINS = new Set([
  "JSON", "Math", "Object", "Array", "String", "Number", "Boolean", "Date", "RegExp", "Function",
  "Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "EvalError", "URIError",
  "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI",
]);

export const isJsBuiltin = (name: string) => JS_BUILTINS.has(name);

export function mdnUrl(name: string, member?: string): string {
  return `${MDN}/${name}${member ? `/${member}` : ""}`;
}

export function isKnown(index: ApiIndex, name: string): boolean {
  return JS_BUILTINS.has(name) || Object.prototype.hasOwnProperty.call(index.classes, name);
}

const TOKEN = /(?<![\w$])([A-Za-z_$][\w$]*)(?![\w$])(?:\s*\.\s*([A-Za-z_$][\w$]*))?/g;

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
  let i = 0; // matches come in order, so the text-node cursor only moves forward
  for (let m = TOKEN.exec(full); m; m = TOKEN.exec(full)) {
    const cls = m[1];
    if (!isKnown(index, cls)) continue;
    if (full[m.index - 1] === ".") continue; // a property such as foo.Bar, not the class
    // Find the text node holding the class name; skip names split across nodes.
    while (i + 1 < starts.length && starts[i + 1] <= m.index) i++;
    const node = nodes[i];
    const from = m.index - starts[i];
    const to = from + cls.length;
    if (to > (node.nodeValue?.length ?? 0)) continue;
    if (node.parentElement?.closest(".hljs-string, .api-ref")) continue;
    hits.push({ node, from, to, cls, member: m[2] });
  }

  // Rebuild each affected text node once (text, link, text, link …). Splitting a node once per
  // link copies the rest of the node every time, which is very slow when a long script is a
  // single text node (uncoloured code).
  let k = 0;
  while (k < hits.length) {
    const node = hits[k].node;
    const text = node.nodeValue ?? "";
    const frag = document.createDocumentFragment();
    let pos = 0;
    for (; k < hits.length && hits[k].node === node; k++) {
      const h = hits[k];
      if (h.from > pos) frag.appendChild(document.createTextNode(text.slice(pos, h.from)));
      const span = document.createElement("span");
      span.className = "api-ref";
      span.dataset.cls = h.cls;
      if (h.member) span.dataset.member = h.member;
      span.tabIndex = 0;
      span.setAttribute("role", "button");
      span.title = `${h.cls}: open the reference`;
      span.textContent = text.slice(h.from, h.to);
      frag.appendChild(span);
      pos = h.to;
    }
    if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
    node.replaceWith(frag);
  }
  return hits.length;
}
