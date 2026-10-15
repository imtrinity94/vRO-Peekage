import JSZip from "jszip";
import type {
  ActionElement,
  Attrib,
  BaseElement,
  Bind,
  ConfigElement,
  ElementFile,
  EnvironmentElement,
  GenericElement,
  PackageInfo,
  Param,
  PkgElement,
  ResourceElement,
  RunElement,
  RunValue,
  ProfileNode,
  WfItem,
  WorkflowElement,
} from "./types";

/* ------------------------------------------------------------------ */
/* Text + XML helpers (DOM-API subset so the parser also runs in Node */
/* with @xmldom/xmldom for tests)                                      */
/* ------------------------------------------------------------------ */

let parseXmlImpl: (text: string) => Document = (text) =>
  new DOMParser().parseFromString(text, "application/xml");

/** Allow a non-browser DOMParser (used by the Node test script). */
export function setXmlParser(fn: (text: string) => Document) {
  parseXmlImpl = fn;
}

export function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 2) {
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
    // UTF-16 without BOM: '<' encoded as 00 3C (BE) or 3C 00 (LE)
    if (bytes[0] === 0x00 && bytes[1] !== 0x00) return new TextDecoder("utf-16be").decode(bytes);
    if (bytes[0] !== 0x00 && bytes[1] === 0x00) return new TextDecoder("utf-16le").decode(bytes);
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  return new TextDecoder("utf-8").decode(bytes);
}

/** Heuristic: does this byte buffer look like text? */
export function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return true;
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return false; // zip
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return false; // %PDF
  const n = Math.min(bytes.length, 2048);
  const utf16 = (bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0xff && bytes[1] === 0xfe) ||
    (bytes[0] === 0 && bytes[1] !== 0) || (bytes[0] !== 0 && bytes[1] === 0);
  if (utf16) return true;
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 0) return false;
    if (b < 9 || (b > 13 && b < 32)) bad++;
  }
  return bad / n < 0.02;
}

function parseXml(text: string): Document | null {
  try {
    const doc = parseXmlImpl(text);
    if (!doc || !doc.documentElement) return null;
    if (doc.getElementsByTagName("parsererror").length) return null;
    return doc;
  } catch {
    return null;
  }
}

const localName = (n: Node) => (n.nodeName || "").replace(/^.*:/, "");

function kids(el: Element | null | undefined, name?: string): Element[] {
  if (!el) return [];
  const out: Element[] = [];
  const cn = el.childNodes;
  for (let i = 0; i < cn.length; i++) {
    const c = cn[i];
    if (c.nodeType === 1 && (!name || localName(c) === name)) out.push(c as Element);
  }
  return out;
}
const kid = (el: Element | null | undefined, name: string) => kids(el, name)[0];
const txt = (el: Element | null | undefined) => (el ? el.textContent ?? "" : undefined);
const attr = (el: Element | null | undefined, name: string) => {
  if (!el || !el.hasAttribute(name)) return undefined;
  return el.getAttribute(name) ?? undefined;
};
/** vRO writes `encoded="true"` scripts as hex UTF-16 code units (4 hex digits per char). */
export function decodeEncoded(text: string | undefined): string | undefined {
  if (!text) return text;
  const t = text.trim();
  if (t.length % 4 !== 0 || !/^[0-9a-fA-F]+$/.test(t)) return text;
  let out = "";
  for (let i = 0; i < t.length; i += 4) out += String.fromCharCode(parseInt(t.slice(i, i + 4), 16));
  return out;
}
const scriptText = (el: Element | undefined) =>
  el ? (attr(el, "encoded") === "true" ? decodeEncoded(txt(el)) : txt(el)) : undefined;
const num = (v: string | undefined) => (v === undefined || v === "" ? undefined : Number(v));

/** Parse a java.util.Properties XML document (info, dunes-meta-inf). */
function parseProps(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const doc = parseXml(text);
  if (doc) {
    const entries = doc.getElementsByTagName("entry");
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const k = e.getAttribute("key");
      if (k) out[k] = e.textContent ?? "";
    }
    return out;
  }
  // fallback regex
  for (const m of text.matchAll(/<entry key="([^"]+)">([\s\S]*?)<\/entry>/g)) out[m[1]] = m[2];
  return out;
}

function parseCategories(text: string | undefined): string[] {
  if (!text) return [];
  const doc = parseXml(text);
  if (!doc) return [];
  return kids(doc.documentElement, "category").map(
    (c) => txt(kid(c, "name")) || c.getAttribute("name") || "",
  );
}

export function langForRuntime(runtime?: string): string {
  const r = (runtime || "").toLowerCase();
  if (r.startsWith("python")) return "python";
  if (r.startsWith("powershell") || r.startsWith("powercli")) return "powershell";
  if (r.startsWith("node")) return "javascript";
  return "javascript";
}

const LANG_NAME: Record<string, string> = { powershell: "PowerShell", python: "Python", node: "Node.js", javascript: "JavaScript" };

/**
 * Best guess at a script's language from its text. Used only when the runtime is not stated,
 * i.e. the script runs in an action environment that is not part of the package.
 */
export function detectScriptLang(code: string | undefined): "powershell" | "python" | "node" | null {
  if (!code) return null;
  const s = code.slice(0, 60_000);
  const count = (re: RegExp) => (s.match(re) || []).length;
  const ps =
    count(/^\s*param\s*\(/gim) * 3 +
    count(/function\s+Handler\s*\(\s*\$context/gi) * 4 +
    count(/\$[A-Za-z_][\w:]*\s*=/g) +
    count(/\b(?:Get|Set|New|Remove|Add|Connect|Disconnect|Write|Import|Invoke|ConvertTo|ConvertFrom|Select|Where|ForEach)-[A-Z][A-Za-z]+/g) * 2 +
    count(/\s-(?:eq|ne|gt|lt|ge|le|like|match|and|or|not)\s/gi) +
    count(/\[(?:string|int|bool|hashtable|PSCustomObject|array)\]/gi);
  const py =
    count(/^\s*def\s+handler\s*\(\s*context/gim) * 4 +
    count(/^\s*def\s+\w+\s*\([^)]*\)\s*(?:->[^:]+)?:\s*$/gm) * 2 +
    count(/^\s*(?:import\s+\w|from\s+[\w.]+\s+import\s)/gm) * 2 +
    count(/^\s*(?:elif|except|with)\b.*:\s*$/gm) +
    count(/\b(?:None|True|False)\b/g) * 0.5;
  const node = count(/\bexports\.handler\s*=/g) * 4 + count(/\brequire\(\s*['"]/g) * 2 + count(/\b(?:async\s+function|await)\b/g);
  const best = Math.max(ps, py, node);
  if (best < 3) return null;
  return best === ps ? "powershell" : best === py ? "python" : "node";
}

/**
 * Work out the script language and a readable runtime label.
 * Order: the element's own runtime → its environment's runtime (if the environment is in the package)
 * → detection from the script text → JavaScript (Rhino), the default for plain vRO scripts.
 */
export function resolveRuntime(
  runtime: string | undefined,
  environmentId: string | undefined,
  script: string | undefined,
  findEnv: (id: string) => { name: string; runtime?: string } | undefined,
): { lang: string; runtimeLabel: string } {
  if (runtime && !environmentId) return { lang: langForRuntime(runtime), runtimeLabel: runtime };
  if (environmentId) {
    const env = findEnv(environmentId);
    if (env?.runtime) return { lang: langForRuntime(env.runtime), runtimeLabel: `${env.runtime} · environment ${env.name}` };
    const guess = detectScriptLang(script);
    const where = env ? `environment ${env.name}` : "environment not in package";
    if (guess) return { lang: guess === "node" ? "javascript" : guess, runtimeLabel: `${LANG_NAME[guess]} (detected) · ${where}` };
    return { lang: "plaintext", runtimeLabel: `Unknown runtime · ${where}` };
  }
  return { lang: "javascript", runtimeLabel: "JavaScript (Rhino)" };
}

/* ------------------------------------------------------------------ */
/* Element parsers                                                     */
/* ------------------------------------------------------------------ */

function parseParams(parent: Element | undefined): Param[] {
  return kids(parent, "param").map((p) => ({
    name: attr(p, "name") ?? attr(p, "n") ?? "",
    type: attr(p, "type") ?? attr(p, "t") ?? "",
    description: txt(kid(p, "description")) || undefined,
  }));
}

function parseAttribs(parent: Element | undefined, tag: string): Attrib[] {
  return kids(parent, tag).map((a) => {
    const v = kid(a, "value");
    return {
      name: attr(a, "name") ?? "",
      type: attr(a, "type") ?? "",
      readOnly: attr(a, "read-only") === "true",
      value: v ? txt(v) : undefined,
      encoded: attr(v, "encoded"),
      confId: attr(a, "conf-id"),
      confKey: attr(a, "conf-key"),
      description: txt(kid(a, "description")) || undefined,
    };
  });
}

function parseBinds(parent: Element | undefined): Bind[] {
  return kids(parent, "bind").map((b) => ({
    name: attr(b, "name") ?? "",
    type: attr(b, "type") ?? "",
    exportName: attr(b, "export-name"),
  }));
}

function parseWorkflow(base: BaseElement, doc: Document, inputForms: WorkflowElement["inputForms"]): WorkflowElement {
  const root = doc.documentElement;
  const pos = kid(root, "position");
  const items: WfItem[] = kids(root, "workflow-item").map((it) => {
    const p = kid(it, "position");
    const script = kid(it, "script");
    const conditionTargets = kids(it, "condition")
      .map((c) => attr(c, "label"))
      .filter((l): l is string => !!l && l !== "null");
    return {
      name: attr(it, "name") ?? "",
      type: attr(it, "type") ?? "",
      displayName: txt(kid(it, "display-name")) || undefined,
      description: txt(kid(it, "description")) || undefined,
      script: scriptText(script),
      runtime: txt(kid(it, "runtime")) || undefined,
      lang: "javascript",
      runtimeLabel: "",
      outName: attr(it, "out-name"),
      altOutName: attr(it, "alt-out-name"),
      catchName: attr(it, "catch-name"),
      linkedWorkflowId: attr(it, "linked-workflow-id"),
      scriptModule: attr(it, "script-module"),
      prototypeId: attr(it, "prototype-id"),
      launchedWorkflowId: attr(it, "launched-workflow-id"),
      endMode: attr(it, "end-mode"),
      inBindings: parseBinds(kid(it, "in-binding")),
      outBindings: parseBinds(kid(it, "out-binding")),
      conditionTargets,
      x: num(attr(p, "x")),
      y: num(attr(p, "y")),
    };
  });

  const scripts: BaseElement["scripts"] = [];
  for (const it of items) {
    if (!it.script || !it.script.trim()) continue;
    if (it.script.startsWith("// Generated by the system, cannot be edited") && it.type === "condition") {
      // still useful, but label it
    }
    scripts.push({
      label: `${it.displayName || it.name} (${it.name})`,
      code: it.script,
      lang: "javascript", // set once environments are known (see resolveLanguages)
      itemName: it.name,
    });
  }

  return {
    ...base,
    kind: "workflow",
    name: txt(kid(root, "display-name")) || base.name,
    description: txt(kid(root, "description")) || base.description,
    version: attr(root, "version") ?? base.version,
    allowedOperations: attr(root, "allowed-operations"),
    rootName: attr(root, "root-name"),
    apiVersion: attr(root, "api-version"),
    inputs: parseParams(kid(root, "input")),
    outputs: parseParams(kid(root, "output")),
    attributes: parseAttribs(root, "attrib"),
    items,
    start: pos ? { x: Number(attr(pos, "x") ?? 0), y: Number(attr(pos, "y") ?? 0) } : undefined,
    errorHandlers: kids(root, "error-handler").map((e) => attr(e, "name") ?? "").filter(Boolean),
    inputForms,
    scripts,
  };
}

function parseAction(base: BaseElement, doc: Document): ActionElement {
  const root = doc.documentElement;
  const params: Param[] = kids(root, "param").map((p) => ({
    name: attr(p, "n") ?? attr(p, "name") ?? "",
    type: attr(p, "t") ?? attr(p, "type") ?? "",
    description: (p.textContent || "").trim() || undefined,
  }));
  const script = scriptText(kid(root, "script")) ?? "";
  const runtime = attr(root, "runtime") ?? (txt(kid(root, "runtime")) || undefined);
  // 8.x polyglot actions can point at an action environment instead of naming a runtime:
  // runtime="environment:<id>", environment="<id>" or a <environment>id</environment> child.
  const environmentId =
    (runtime?.startsWith("environment:") ? runtime.slice(12) : undefined) ?? attr(root, "environment") ?? (txt(kid(root, "environment")) || undefined);
  const module = base.path.join(".") || "(no module)";
  const name = attr(root, "name") ?? base.name;
  return {
    ...base,
    kind: "action",
    name,
    module,
    version: attr(root, "version") ?? base.version,
    allowedOperations: attr(root, "allowed-operations"),
    description: txt(kid(root, "description")) || base.description,
    resultType: attr(root, "result-type"),
    runtime,
    entryHandler: attr(root, "entry-point") ?? attr(root, "entry-handler"),
    memoryLimit: attr(root, "memory-limit"),
    timeout: attr(root, "timeout"),
    environmentId,
    lang: "javascript", // set once environments are known (see resolveLanguages)
    runtimeLabel: "",
    params,
    script,
    hasBundle: base.files.some((f) => f.name === "bundle" || f.name.startsWith("bundle")),
    scripts: script.trim()
      ? [{ label: `${module}/${name}`, code: script, lang: "javascript" }]
      : [],
  };
}

function parseConfig(base: BaseElement, doc: Document): ConfigElement {
  const root = doc.documentElement;
  const atts = parseAttribs(kid(root, "atts"), "att");
  return {
    ...base,
    kind: "config",
    name: txt(kid(root, "display-name")) || attr(root, "name") || base.name,
    description: txt(kid(root, "description")) || base.description,
    version: attr(root, "version") ?? base.version,
    allowedOperations: attr(root, "allowed-operations"),
    attributes: atts,
  };
}

/* ------------------------------------------------------------------ */
/* Main entry                                                          */
/* ------------------------------------------------------------------ */

const UUIDISH = /\b(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})\b/gi;
const GETMODULE = /System\.getModule\(\s*["']([\w.$-]+)["']\s*\)\s*\.\s*([\w$]+)/g;

export async function parsePackage(data: ArrayBuffer | Uint8Array, fileName: string): Promise<PackageInfo> {
  const zip = await JSZip.loadAsync(data);
  const warnings: string[] = [];
  const fileSize = data instanceof Uint8Array ? data.byteLength : data.byteLength;

  const metaFile = zip.file("dunes-meta-inf");
  let meta: Record<string, string> = {};
  if (metaFile) meta = parseProps(decodeText(await metaFile.async("uint8array")));
  else warnings.push("No dunes-meta-inf found – this may not be a vRO package.");

  const certificates = Object.keys(zip.files)
    .filter((p) => p.startsWith("certificates/") && !zip.files[p].dir)
    .map((p) => p.slice("certificates/".length));
  const signed = Object.keys(zip.files).some((p) => p.startsWith("signatures/"));

  // Group files by element folder
  const groups = new Map<string, JSZip.JSZipObject[]>();
  zip.forEach((path, f) => {
    const m = /^elements\/([^/]+)\/(.+)$/.exec(path);
    if (!m || f.dir) return;
    if (!groups.has(m[1])) groups.set(m[1], []);
    groups.get(m[1])!.push(f);
  });
  if (groups.size === 0) warnings.push("No elements/ folder found in the archive.");

  const elements: PkgElement[] = [];
  for (const [folderId, files] of groups) {
    try {
      elements.push(await parseElement(folderId, files, signed));
    } catch (e) {
      warnings.push(`Element ${folderId}: ${(e as Error).message}`);
    }
  }

  const byId = new Map<string, PkgElement>();
  for (const e of elements) byId.set(e.id.toLowerCase(), e);
  resolveLanguages(elements, byId);

  const actionIndex = new Map<string, string>();
  for (const e of elements) if (e.kind === "action") actionIndex.set(`${e.module}/${e.name}`, e.id.toLowerCase());

  // References: any known element id mentioned in the element text, plus System.getModule(...) calls
  const refs = new Map<string, Set<string>>();
  const usedBy = new Map<string, Set<string>>();
  const link = (from: string, to: string) => {
    if (from === to) return;
    if (!refs.has(from)) refs.set(from, new Set());
    if (!usedBy.has(to)) usedBy.set(to, new Set());
    refs.get(from)!.add(to);
    usedBy.get(to)!.add(from);
  };
  for (const e of elements) {
    const self = e.id.toLowerCase();
    const texts = [e.raw ?? "", ...e.files.filter((f) => f.name !== "data").map((f) => f.text ?? "")];
    for (const t of texts) {
      for (const m of t.matchAll(UUIDISH)) {
        const id = m[0].toLowerCase();
        if (byId.has(id)) link(self, id);
      }
    }
    for (const s of e.scripts) {
      for (const m of s.code.matchAll(GETMODULE)) {
        const target = actionIndex.get(`${m[1]}/${m[2]}`);
        if (target) link(self, target);
      }
    }
    if (e.kind === "workflow") {
      for (const it of e.items) {
        if (it.scriptModule) {
          const t = actionIndex.get(it.scriptModule);
          if (t) link(self, t);
        }
      }
    }
  }

  elements.sort((a, b) => a.name.localeCompare(b.name));
  return { fileName, fileSize, meta, certificates, signed, elements, byId, refs, usedBy, warnings, actionIndex, zip };
}

async function parseElement(folderId: string, files: JSZip.JSZipObject[], signed: boolean): Promise<PkgElement> {
  const byName = new Map<string, JSZip.JSZipObject>();
  for (const f of files) byName.set(f.name.replace(/^elements\/[^/]+\//, ""), f);

  const info = byName.get("info");
  const props = info ? parseProps(decodeText(await info.async("uint8array"))) : {};
  const type = props["type"] || "Unknown";
  const id = props["id"] || folderId;

  // Read small files as text; big binary ones (bundle, resource data) stay lazy.
  const elementFiles: ElementFile[] = [];
  const textByName: Record<string, string> = {};
  for (const [name, f] of byName) {
    // @ts-expect-error _data is internal to JSZip but holds sizes when available
    const size: number = f._data?.uncompressedSize ?? 0;
    let text: string | undefined;
    const lazy = name === "bundle" || (type === "ResourceElement" && name === "data");
    if (!lazy && size < 8 * 1024 * 1024) {
      const bytes = await f.async("uint8array");
      if (looksLikeText(bytes)) {
        text = decodeText(bytes);
        textByName[name] = text;
      }
      elementFiles.push({ name, size: size || bytes.length, text });
    } else {
      elementFiles.push({ name, size });
    }
  }
  elementFiles.sort((a, b) => a.name.localeCompare(b.name));

  const path = parseCategories(textByName["categories"]);
  const raw = textByName["data"];
  const base: BaseElement = {
    id,
    folder: folderId,
    type,
    name: id,
    path,
    files: elementFiles,
    raw,
    scripts: [],
    signed,
    getFile: async (name: string) => {
      const f = byName.get(name);
      return f ? f.async("uint8array") : new Uint8Array();
    },
  };

  if (type === "Workflow" && raw) {
    const doc = parseXml(raw);
    if (doc) {
      const forms = elementFiles
        .filter((f) => f.name.startsWith("input_form_") && f.text)
        .map((f) => {
          let json: unknown = null;
          try {
            json = JSON.parse(f.text!);
          } catch {
            /* keep text */
          }
          return { name: f.name, json, text: f.text! };
        });
      return parseWorkflow(base, doc, forms);
    }
  }
  if (type === "ScriptModule" && raw) {
    const doc = parseXml(raw);
    if (doc) return parseAction(base, doc);
  }
  if (type === "ConfigurationElement" && raw) {
    const doc = parseXml(raw);
    if (doc) return parseConfig(base, doc);
  }
  if (type === "ResourceElement") return parseResource(base, byName.get("data"));
  if (type === "ActionEnvironment") return parseEnvironment(base, byName.get("bundle"));
  if (type === "WorkflowToken" && raw) {
    const doc = parseXml(raw);
    if (doc) return parseRun(base, doc, textByName);
  }

  const g: GenericElement = { ...base, kind: "generic" };
  if (raw) {
    const doc = parseXml(raw);
    if (doc) {
      const root = doc.documentElement;
      g.name = txt(kid(root, "display-name")) || attr(root, "name") || g.name;
      g.description = txt(kid(root, "description")) || undefined;
      g.version = attr(root, "version");
    } else {
      try {
        const j = JSON.parse(raw);
        g.name = j.name || j.displayName || g.name;
        g.version = j.version;
        g.description = j.description;
      } catch {
        /* ignore */
      }
    }
  }
  return g;
}

async function parseResource(base: BaseElement, dataFile: JSZip.JSZipObject | undefined): Promise<ResourceElement> {
  const res: ResourceElement = {
    ...base,
    kind: "resource",
    fileName: base.name,
    getBytes: async () => new Uint8Array(),
  };
  if (!dataFile) return res;
  const outer = await dataFile.async("uint8array");
  let inner: JSZip | null = null;
  if (outer[0] === 0x50 && outer[1] === 0x4b) {
    try {
      inner = await JSZip.loadAsync(outer);
    } catch {
      inner = null;
    }
  }
  if (inner && inner.file("VSO-RESOURCE-INF/data")) {
    const readAttr = async (n: string) => {
      const f = inner!.file(`VSO-RESOURCE-INF/attribute_${n}`);
      return f ? decodeText(await f.async("uint8array")) : undefined;
    };
    res.name = (await readAttr("name")) || res.name;
    res.fileName = res.name;
    res.mimeType = await readAttr("mimetype");
    res.description = await readAttr("description");
    res.version = await readAttr("version");
    res.allowedOperations = await readAttr("allowedOperations");
    const d = inner.file("VSO-RESOURCE-INF/data")!;
    // @ts-expect-error internal
    res.size = d._data?.uncompressedSize;
    let cache: Uint8Array | null = null;
    res.getBytes = async () => (cache ??= await d.async("uint8array"));
    // Make small text resources searchable
    if ((res.size ?? 0) < 2 * 1024 * 1024 && isTextMime(res.mimeType, res.name)) {
      const bytes = await res.getBytes();
      const t = decodeText(bytes);
      res.scripts = [{ label: res.name, code: t, lang: langForMime(res.mimeType, res.name) }];
    }
  } else {
    res.size = outer.length;
    res.getBytes = async () => outer;
  }
  return res;
}

export function isTextMime(mime?: string, name?: string): boolean {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("text/") || /json|xml|javascript|yaml|x-sh|csv|x-python|powershell|sql/.test(m)) return true;
  return /\.(txt|json|xml|ya?ml|js|ts|py|ps1|psm1|sh|csv|md|html?|css|ini|conf|cfg|properties|sql|log|j2|tpl)$/i.test(name || "");
}
export function langForMime(mime?: string, name?: string): string {
  const s = `${mime || ""} ${name || ""}`.toLowerCase();
  if (/json/.test(s)) return "json";
  if (/xml|html?/.test(s)) return "xml";
  if (/ya?ml/.test(s)) return "yaml";
  if (/python|\.py\b/.test(s)) return "python";
  if (/powershell|\.ps1|\.psm1/.test(s)) return "powershell";
  if (/x-sh|\.sh\b/.test(s)) return "bash";
  if (/javascript|\.js\b|\.ts\b/.test(s)) return "javascript";
  if (/sql/.test(s)) return "sql";
  return "plaintext";
}

async function parseEnvironment(base: BaseElement, bundle: JSZip.JSZipObject | undefined): Promise<EnvironmentElement> {
  let meta: Record<string, unknown> = {};
  try {
    meta = base.raw ? JSON.parse(base.raw) : {};
  } catch {
    /* ignore */
  }
  let listCache: { name: string; size: number; dir: boolean }[] | null = null;
  return {
    ...base,
    kind: "environment",
    name: (meta.name as string) || base.name,
    version: (meta.version as string) || undefined,
    description: (meta.description as string) || undefined,
    runtime: meta.runtime as string | undefined,
    dependencies: (meta.dependencies as Record<string, string>) || {},
    environmentVariables: (meta.environmentVariables as Record<string, string>) || {},
    meta,
    hasBundle: !!bundle,
    getBundleBytes: async () => (bundle ? bundle.async("uint8array") : undefined),
    listBundle: async () => {
      if (listCache) return listCache;
      if (!bundle) return [];
      const z = await JSZip.loadAsync(await bundle.async("uint8array"));
      const out: { name: string; size: number; dir: boolean }[] = [];
      z.forEach((p, f) => {
        // @ts-expect-error internal
        out.push({ name: p, size: f._data?.uncompressedSize ?? 0, dir: f.dir });
      });
      out.sort((a, b) => a.name.localeCompare(b.name));
      return (listCache = out);
    },
  };
}

function epoch(v: string | undefined): Date | undefined {
  if (!v || v === "null" || v === "0") return undefined;
  const n = Number(v);
  if (!isFinite(n)) return undefined;
  return new Date(n < 1e11 ? n * 1000 : n);
}
const nul = (v: string | undefined) => (v === undefined || v === "null" || v === "" ? undefined : v);

function parseRun(base: BaseElement, doc: Document, textByName: Record<string, string>): RunElement {
  const root = doc.documentElement;
  const values: RunValue[] = [];
  kids(root, "atts").forEach((block, bi) => {
    const atts = [...kids(block, "att"), ...kids(block, "stack").flatMap((st) => kids(st, "att"))];
    for (const a of atts)
      values.push({
        name: attr(a, "n") ?? attr(a, "name") ?? "",
        type: attr(a, "t") ?? attr(a, "type") ?? "",
        value: txt(a),
        scope: attr(a, "s"),
        block: bi,
      });
  });
  const exc = txt(kid(root, "exception"))?.trim();

  const tags: RunElement["tags"] = [];
  const tagDoc = textByName["tags"] ? parseXml(textByName["tags"]) : null;
  if (tagDoc)
    for (const t of kids(tagDoc.documentElement, "tag"))
      tags.push({ name: attr(t, "name") ?? "", value: attr(t, "value") ?? "", global: attr(t, "global") === "true" });

  let profile: RunElement["profile"];
  const extensions: RunElement["extensions"] = [];
  for (const [name, text] of Object.entries(textByName)) {
    if (!name.startsWith("extensions/")) continue;
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    if (name === "extensions/profiler.json" && json && typeof json === "object") {
      const items: ProfileNode[] = [];
      type PJ = { id?: string; metrics?: Record<string, number>; childActivities?: Record<string, PJ> };
      const walk = (node: PJ, depth: number) => {
        for (const [k, c] of Object.entries(node.childActivities ?? {})) {
          items.push({
            id: c.id ?? k,
            depth,
            totalTime: c.metrics?.totalTime,
            maxTime: c.metrics?.maxTime,
            executions: c.metrics?.numberOfExecutions,
          });
          walk(c, depth + 1);
        }
      };
      walk(json as PJ, 0);
      profile = { metrics: (json as PJ).metrics ?? {}, items };
    } else {
      extensions.push({ name: name.slice("extensions/".length), text, json });
    }
  }

  const wfStack = (attr(root, "wfExecutionStack") ?? "").split("/").filter(Boolean);
  const title = attr(root, "title") || base.name;
  return {
    ...base,
    kind: "run",
    name: `Run · ${title.trim()}`,
    title: title.trim(),
    workflowId: wfStack[0],
    workflowStack: wfStack,
    itemStack: (attr(root, "itemNameStack") ?? "").split("/").filter(Boolean),
    currentItemState: nul(attr(root, "currentItemState")),
    globalState: nul(attr(root, "globalState")),
    businessState: nul(attr(root, "businessState")),
    start: epoch(attr(root, "startDate")),
    end: epoch(attr(root, "endDate")),
    values,
    exception: exc || undefined,
    transitionType: attr(kid(root, "transitionType"), "value"),
    ancestorTokenId: nul(attr(root, "ancestorTokenId")),
    tags,
    profile,
    extensions,
    scripts: values
      .filter((v) => v.value && v.value !== "__NULL__" && v.type !== "SecureString")
      .map((v) => ({ label: `value ${v.name}`, code: v.value!, lang: "plaintext" })),
  };
}

export function formatDuration(ms?: number): string {
  if (ms === undefined || !isFinite(ms)) return "–";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${Math.round(s % 60)}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/* ------------------------------------------------------------------ */
/* Value helpers                                                       */
/* ------------------------------------------------------------------ */

/** Best-effort pretty print of vRO's serialised attribute values. */
/** A decoded vRO length-prefixed value (arrays and composite types in configuration elements and runs). */
export type SerNode =
  | { t: "scalar"; type: string; value: string }
  | { t: "array"; type: string; items: SerNode[] }
  | { t: "object"; type: string; fields: [string, SerNode][] };

/** Short type name for display: "CompositeType(a:string,b:string):MyType" -> "MyType". */
export function serTypeName(type: string): string {
  const m = /^CompositeType\(.*\):([^():]+)$/.exec(type);
  return m ? m[1] : type;
}

function parseTypedValue(s: string): SerNode | null {
  // The type can contain "(...)" with ":" and "," but never "#", so the first "#" ends it.
  const hash = s.indexOf("#");
  if (hash < 0) return { t: "scalar", type: "", value: s };
  const type = s.slice(0, hash);
  const raw = s.slice(hash + 1);
  if (/^\[(\d+:|\s*\])/.test(raw)) {
    const items = parseSerArray(raw);
    if (items) return { t: "array", type, items };
  }
  if (/^\{(\d+:\d+:|\s*\})/.test(raw)) {
    const fields = parseSerProps(raw);
    if (fields) return { t: "object", type, fields };
  }
  return { t: "scalar", type, value: raw };
}

/** `[len:type#value len:type#value ...]` where len counts "type#value". */
function parseSerArray(v: string): SerNode[] | null {
  if (!v.startsWith("[") || !v.endsWith("]")) return null;
  const body = v.slice(1, -1);
  const out: SerNode[] = [];
  let i = 0;
  while (i < body.length) {
    if (/[\s,;]/.test(body[i])) {
      i++;
      continue;
    }
    const m = /^(\d+):/.exec(body.slice(i, i + 16));
    if (!m) return null;
    i += m[0].length;
    const len = Number(m[1]);
    if (i + len > body.length) return null;
    const node = parseTypedValue(body.substr(i, len));
    if (!node) return null;
    out.push(node);
    i += len;
  }
  return out;
}

/** `{klen:vlen:key=type#value\n...}` where vlen counts "type#value". */
function parseSerProps(v: string): [string, SerNode][] | null {
  if (!v.startsWith("{") || !v.endsWith("}")) return null;
  const body = v.slice(1, -1);
  const out: [string, SerNode][] = [];
  let i = 0;
  while (i < body.length) {
    if (/[\s,;]/.test(body[i])) {
      i++;
      continue;
    }
    const m = /^(\d+):(\d+):/.exec(body.slice(i, i + 24));
    if (!m) return null;
    i += m[0].length;
    const key = body.substr(i, Number(m[1]));
    i += Number(m[1]);
    if (body[i] !== "=") return null;
    i++;
    const len = Number(m[2]);
    if (i + len > body.length) return null;
    const node = parseTypedValue(body.substr(i, len));
    if (!node) return null;
    out.push([key, node]);
    i += len;
  }
  return out;
}

/** Decode a length-prefixed array / properties / composite value, or null if it isn't one. */
export function parseSerialized(v: string | undefined): SerNode | null {
  if (!v) return null;
  if (/^\[(\d+:|\s*\]$)/.test(v)) {
    const items = parseSerArray(v);
    return items ? { t: "array", type: "", items } : null;
  }
  if (/^\{\d+:\d+:/.test(v)) {
    const fields = parseSerProps(v);
    return fields ? { t: "object", type: "", fields } : null;
  }
  return null;
}

/** One-line text form of a decoded value, used in exports and as a fallback. */
export function serToText(n: SerNode): string {
  if (n.t === "scalar") return /^(number|boolean)$/.test(n.type) ? n.value : JSON.stringify(n.value);
  if (n.t === "array") return "[" + n.items.map(serToText).join(", ") + "]";
  return "{ " + n.fields.map(([k, f]) => `${k}: ${serToText(f)}`).join(", ") + " }";
}

/** Fill in lang / runtimeLabel for actions and scriptable tasks now that every environment is known. */
function resolveLanguages(elements: PkgElement[], byId: Map<string, PkgElement>) {
  const findEnv = (id: string) => {
    const e = byId.get(id.trim().toLowerCase());
    return e && e.kind === "environment" ? { name: e.name, runtime: e.runtime } : undefined;
  };
  for (const e of elements) {
    if (e.kind === "action") {
      Object.assign(e, resolveRuntime(e.runtime, e.environmentId, e.script, findEnv));
      for (const sc of e.scripts) sc.lang = e.lang;
    } else if (e.kind === "workflow") {
      for (const it of e.items) {
        const envId = it.runtime?.startsWith("environment:") ? it.runtime.slice(12) : undefined;
        it.environmentId = envId;
        Object.assign(it, resolveRuntime(it.runtime, envId, it.script, findEnv));
      }
      for (const sc of e.scripts) {
        const it = e.items.find((i) => i.name === sc.itemName);
        if (it) sc.lang = it.lang;
      }
    }
  }
}

export function prettyValue(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  if (v === "__NULL__") return "(null)";
  const ser = parseSerialized(v);
  if (ser) return serToText(ser);
  // Arrays: #{#string#a#;#string#b#}#
  if (v.startsWith("#{#") && v.endsWith("#}#")) {
    const body = v.slice(3, -3);
    if (!body) return "[]";
    const items = body.split("#;#").map((s) => s.replace(/^[^#]+#/, ""));
    return "[" + items.map((s) => JSON.stringify(s)).join(", ") + "]";
  }
  // Properties: #[#key#+#type#value#]#
  if (v.startsWith("#[#") && v.endsWith("#]#")) {
    const body = v.slice(3, -3);
    const parts = body.split("#;#").map((p) => {
      const [k, rest] = p.split("#+#");
      return `${k}: ${(rest ?? "").replace(/^[^#]+#/, "")}`;
    });
    return "{ " + parts.join(", ") + " }";
  }
  // Token-style length-prefixed properties: {10:8:mountPoint=string#/\n}
  if (/^\{\d+:\d+:/.test(v)) {
    const props = parseLengthPrefixed(v);
    if (props) return "{ " + props.map(([k, val]) => `${k}: ${JSON.stringify(val)}`).join(", ") + " }";
  }
  const sdk = /^dunes:\/\/service\.dunes\.ch\/([^?]+)\?id='([^']*)'(?:&dunesName='([^']*)')?/.exec(v);
  if (sdk) {
    let id = sdk[2];
    try {
      id = decodeURIComponent(id);
    } catch {
      /* keep */
    }
    return `${sdk[1]} → ${id}${sdk[3] && sdk[3] !== sdk[1] ? ` (${sdk[3]})` : ""}`;
  }
  return v;
}

/** Parse vRO token serialisation `{klen:vlen:key=type#value\n...}` into [key, value] pairs. */
function parseLengthPrefixed(v: string): [string, string][] | null {
  const body = v.slice(1, v.endsWith("}") ? -1 : undefined);
  const out: [string, string][] = [];
  let i = 0;
  while (i < body.length) {
    if (body[i] === "\n" || body[i] === "\r") {
      i++;
      continue;
    }
    const m = /^(\d+):(\d+):/.exec(body.slice(i, i + 24));
    if (!m) return null;
    i += m[0].length;
    const key = body.substr(i, Number(m[1]));
    i += Number(m[1]);
    if (body[i] !== "=") return null;
    i++;
    const val = body.substr(i, Number(m[2]));
    i += Number(m[2]);
    out.push([key, val.replace(/^[A-Za-z:]+#/, "")]);
  }
  return out;
}

export function kindLabel(kind: PkgElement["kind"], type?: string): string {
  switch (kind) {
    case "workflow": return "Workflow";
    case "action": return "Action";
    case "config": return "Configuration Element";
    case "resource": return "Resource Element";
    case "environment": return "Environment";
    case "run": return "Workflow run";
    default: return type || "Other";
  }
}

export function formatBytes(n?: number): string {
  if (n === undefined || isNaN(n)) return "–";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
