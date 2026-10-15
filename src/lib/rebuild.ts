/**
 * Edit-and-rebuild: write script and configuration-value changes back into a copy of the
 * original .package.
 *
 * Rules learned from importing test packages into Orchestrator 9.1:
 *   - every original file must stay, including signatures/ and certificates/ (an unsigned package
 *     is rejected as corrupted); a changed file with a stale signature is accepted
 *   - Orchestrator only picks up an element when its version is higher than the installed one,
 *     so every changed element gets a version bump
 *   - SecureString values are never changed (plain-text values are rejected on import)
 *
 * Only the text that changed is replaced inside each element's existing XML, so every other
 * attribute, binding, form and setting is kept exactly as exported.
 */
import JSZip from "jszip";
import type { PackageInfo, PkgElement } from "./types";

/** Key used for an action's own script (workflow scripts use the item name, e.g. "item3"). */
export const ACTION_SCRIPT = "__action__";

export interface ElementEdits {
  /** script key -> new code */
  scripts: Record<string, string>;
  /** configuration attribute name -> new value */
  values: Record<string, string>;
  /** version to write; defaults to nextVersion(original) */
  version?: string;
}
export type Edits = Record<string, ElementEdits>;

/** Configuration value types that can be edited (SecureString and object types cannot). */
export const EDITABLE_VALUE_TYPES = new Set(["string", "number", "boolean"]);

/** Suggested next version: bump the last number (0.0.0 -> 0.0.1, 1.4.0 -> 1.4.1). */
export function nextVersion(v?: string): string {
  if (!v) return "0.0.1";
  const parts = v.split(".");
  if (parts.every((p) => /^\d+$/.test(p))) {
    parts[parts.length - 1] = String(Number(parts[parts.length - 1]) + 1);
    return parts.join(".");
  }
  return `${v}.1`;
}

/** Compare dotted versions numerically: -1, 0 or 1. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((x) => parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

export function editCount(edits: Edits): number {
  let n = 0;
  for (const e of Object.values(edits)) n += Object.keys(e.scripts).length + Object.keys(e.values).length;
  return n;
}

/* ------------------------------------------------------------------ */
/* XML text surgery                                                    */
/* ------------------------------------------------------------------ */

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Wrap text in CDATA, splitting any "]]>" inside it. */
export function cdata(s: string): string {
  return `<![CDATA[${s.split("]]>").join("]]]]><![CDATA[>")}]]>`;
}

/** Set version="..." on the root element (added if missing). */
export function setRootVersion(xml: string, rootTag: string, version: string): string {
  const re = new RegExp(`<${esc(rootTag)}\\b[^>]*>`);
  const m = re.exec(xml);
  if (!m) throw new Error(`<${rootTag}> not found`);
  const tag = m[0];
  const next = /\sversion="[^"]*"/.test(tag)
    ? tag.replace(/(\sversion=")[^"]*(")/, `$1${escAttr(version)}$2`)
    : tag.replace(/\s*(\/?>)$/, ` version="${escAttr(version)}"$1`);
  return xml.slice(0, m.index) + next + xml.slice(m.index + tag.length);
}

/** Replace the first <script> element inside xml[from, to) with plain (unencoded) code. */
function replaceScriptIn(xml: string, code: string, from = 0, to = xml.length): string {
  const part = xml.slice(from, to);
  const re = /<script\b[^>]*\/>|<script\b[^>]*>[\s\S]*?<\/script>/;
  const m = re.exec(part);
  if (!m) throw new Error("script not found");
  const replaced = part.slice(0, m.index) + `<script encoded="false">${cdata(code)}</script>` + part.slice(m.index + m[0].length);
  return xml.slice(0, from) + replaced + xml.slice(to);
}

export function setActionScript(xml: string, code: string): string {
  return replaceScriptIn(xml, code);
}

export function setWorkflowItemScript(xml: string, itemName: string, code: string): string {
  const open = new RegExp(`<workflow-item\\b[^>]*\\sname="${esc(itemName)}"[^>]*>`).exec(xml);
  if (!open) throw new Error(`workflow item ${itemName} not found`);
  const end = xml.indexOf("</workflow-item>", open.index);
  if (end < 0) throw new Error(`workflow item ${itemName} is not closed`);
  return replaceScriptIn(xml, code, open.index, end);
}

export function setConfigValue(xml: string, attName: string, value: string): string {
  const open = new RegExp(`<att\\b[^>]*\\sname="${esc(attName)}"[^>]*?(\\/?)>`).exec(xml);
  if (!open) throw new Error(`attribute ${attName} not found`);
  const valueXml = `<value encoded="n">${cdata(value)}</value>`;
  if (open[1] === "/") {
    // <att .../>  ->  <att ...><value/></att>
    const tag = open[0].replace(/\s*\/>$/, ">");
    return xml.slice(0, open.index) + `${tag}\n      ${valueXml}\n    </att>` + xml.slice(open.index + open[0].length);
  }
  const bodyStart = open.index + open[0].length;
  const end = xml.indexOf("</att>", bodyStart);
  if (end < 0) throw new Error(`attribute ${attName} is not closed`);
  const body = xml.slice(bodyStart, end);
  const vm = /<value\b[^>]*\/>|<value\b[^>]*>[\s\S]*?<\/value>/.exec(body);
  const nextBody = vm ? body.slice(0, vm.index) + valueXml + body.slice(vm.index + vm[0].length) : `\n      ${valueXml}${body}`;
  return xml.slice(0, bodyStart) + nextBody + xml.slice(end);
}

/* ------------------------------------------------------------------ */
/* Text encoding: write back in the same encoding the file came in     */
/* ------------------------------------------------------------------ */

function decodeSame(bytes: Uint8Array): { text: string; encode: (s: string) => Uint8Array } {
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const text = new TextDecoder("utf-16be").decode(bytes.subarray(2));
    return { text, encode: (s) => utf16(s, true) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    const text = new TextDecoder("utf-16le").decode(bytes.subarray(2));
    return { text, encode: (s) => utf16(s, false) };
  }
  // UTF-16BE without BOM (starts with 00 '<')
  if (bytes[0] === 0x00 && bytes[1] !== 0x00) {
    const text = new TextDecoder("utf-16be").decode(bytes);
    return { text, encode: (s) => utf16(s, true).subarray(2) };
  }
  const text = new TextDecoder("utf-8").decode(bytes);
  return { text, encode: (s) => new TextEncoder().encode(s) };
}

function utf16(s: string, bigEndian: boolean): Uint8Array {
  const out = new Uint8Array(2 + s.length * 2);
  out[0] = bigEndian ? 0xfe : 0xff;
  out[1] = bigEndian ? 0xff : 0xfe;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[2 + i * 2] = bigEndian ? c >> 8 : c & 0xff;
    out[3 + i * 2] = bigEndian ? c & 0xff : c >> 8;
  }
  return out;
}

/** Apply one element's edits to its data XML. */
export function applyEdits(el: PkgElement, xml: string, e: ElementEdits): string {
  let out = xml;
  for (const [key, code] of Object.entries(e.scripts)) {
    out = key === ACTION_SCRIPT ? setActionScript(out, code) : setWorkflowItemScript(out, key, code);
  }
  for (const [name, value] of Object.entries(e.values)) out = setConfigValue(out, name, value);
  const root = el.kind === "action" ? "dunes-script-module" : el.kind === "workflow" ? "workflow" : el.kind === "config" ? "config-element" : null;
  if (!root) throw new Error(`${el.name}: editing ${el.kind} elements isn't supported`);
  return setRootVersion(out, root, e.version || nextVersion(el.version));
}

/** Build the modified package. Every file is copied in its original order; only edited data files change. */
export async function rebuildPackage(pkg: PackageInfo, edits: Edits, onProgress?: (done: number, total: number) => void): Promise<Blob> {
  const byPath = new Map<string, { el: PkgElement; e: ElementEdits }>();
  for (const [id, e] of Object.entries(edits)) {
    if (!Object.keys(e.scripts).length && !Object.keys(e.values).length) continue;
    const el = pkg.byId.get(id.toLowerCase());
    if (!el) throw new Error(`Element ${id} is no longer in the package`);
    byPath.set(`elements/${el.folder}/data`, { el, e });
  }

  const out = new JSZip();
  const entries = Object.values(pkg.zip.files);
  let done = 0;
  for (const f of entries) {
    if (f.dir) {
      out.file(f.name, null, { dir: true, date: f.date, createFolders: false });
    } else {
      let bytes: Uint8Array = await f.async("uint8array");
      const hit = byPath.get(f.name);
      if (hit) {
        const { text, encode } = decodeSame(bytes);
        bytes = encode(applyEdits(hit.el, text, hit.e));
        byPath.delete(f.name);
      }
      out.file(f.name, bytes, { date: f.date, binary: true, createFolders: false });
    }
    onProgress?.(++done, entries.length);
  }
  if (byPath.size) throw new Error(`Couldn't find ${[...byPath.keys()].join(", ")} in the package`);
  return out.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 }, mimeType: "application/zip" });
}

/** "com.example.package" -> "com.example-modified.package" */
export function modifiedFileName(fileName: string): string {
  return fileName.replace(/(\.package)?$/i, "-modified.package");
}
