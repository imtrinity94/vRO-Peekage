import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import python from "highlight.js/lib/languages/python";
import powershell from "highlight.js/lib/languages/powershell";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import bash from "highlight.js/lib/languages/bash";
import sql from "highlight.js/lib/languages/sql";
import plaintext from "highlight.js/lib/languages/plaintext";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("powershell", powershell);
hljs.registerLanguage("json", json);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("plaintext", plaintext);

const MAX_HL = 400_000;

function escapeHtml(s: string) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

/** Syntax-highlighted HTML for a code string (used by the report export). */
export function highlightCode(code: string, lang: string): string {
  if (code.length > MAX_HL || !hljs.getLanguage(lang)) return escapeHtml(code);
  return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
}

/** Above this size, editing falls back to plain text so typing stays smooth. */
const MAX_HL_EDIT = 120_000;

function highlightHtml(code: string, lang: string, limit: number) {
  if (code.length > limit || !hljs.getLanguage(lang)) return escapeHtml(code);
  return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
}

/** Insert text at the selection, keeping the browser's undo history where possible. */
function insertText(ta: HTMLTextAreaElement, text: string) {
  ta.focus();
  if (!document.execCommand?.("insertText", false, text)) {
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

function handleEditorKeys(e: KeyboardEvent<HTMLTextAreaElement>, indent: string) {
  const ta = e.currentTarget;
  const { value, selectionStart: start, selectionEnd: end } = ta;

  if (e.key === "Escape") {
    ta.blur();
    return;
  }

  if (e.key === "Tab") {
    e.preventDefault();
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const multiLine = value.slice(start, end).includes("\n");
    if (!multiLine && !e.shiftKey) {
      insertText(ta, indent);
      return;
    }
    // Indent / outdent every line touched by the selection.
    const blockEnd = end > start && value[end - 1] === "\n" ? end - 1 : end;
    const lineEnd = value.indexOf("\n", blockEnd);
    const stop = lineEnd === -1 ? value.length : lineEnd;
    const block = value.slice(lineStart, stop);
    const changed = block
      .split("\n")
      .map((l) => {
        if (!e.shiftKey) return indent + l;
        if (l.startsWith("\t")) return l.slice(1);
        return l.replace(/^ {1,4}/, "");
      })
      .join("\n");
    ta.setSelectionRange(lineStart, stop);
    insertText(ta, changed);
    ta.setSelectionRange(lineStart, lineStart + changed.length);
    return;
  }

  if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey) {
    // Keep the current line's indentation; indent one more level after an opening bracket.
    e.preventDefault();
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const lead = /^[ \t]*/.exec(value.slice(lineStart, start))![0];
    const before = value.slice(lineStart, start).trimEnd();
    const extra = /[{([]$/.test(before) ? indent : "";
    insertText(ta, "\n" + lead + extra);
  }
}

export function CodeBlock({
  code,
  lang = "javascript",
  title,
  highlightTerm,
  maxHeight,
  editable = true,
  edited,
  onEdit,
}: {
  code: string;
  lang?: string;
  title?: string;
  highlightTerm?: string;
  maxHeight?: number;
  /** Show the Edit button (scratch editing: changes are never saved anywhere). */
  editable?: boolean;
  /** Saved edit for this script (package editing). With onEdit, edits are kept outside the viewer. */
  edited?: string | null;
  /** Called with the new code, or null when it matches the original again / is reset. */
  onEdit?: (code: string | null) => void;
}) {
  const saved = !!onEdit;
  const [copied, setCopied] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [editing, setEditing] = useState(false);
  const [scratch, setScratch] = useState<string | null>(null);
  const [source, setSource] = useState(code);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // A different script was opened in this viewer: drop any scratch edits.
  if (source !== code) {
    setSource(code);
    setScratch(null);
    setEditing(false);
  }

  const trimmed = code.replace(/^\n+/, "").replace(/\s+$/, "");
  const draft = saved ? (edited ?? null) : scratch;
  const setDraft = (v: string | null) => {
    if (saved) onEdit!(v === null || v === trimmed ? null : v);
    else setScratch(v);
  };
  const value = draft ?? trimmed;
  const modified = draft !== null && draft !== trimmed;
  const indent = useMemo(() => (/^\t/m.test(trimmed) ? "\t" : "    "), [trimmed]);

  const html = useMemo(() => {
    if (editing || modified) {
      // A trailing newline needs a placeholder so the highlighted copy stays as tall as the textarea.
      return highlightHtml(value, lang, MAX_HL_EDIT) + (value.endsWith("\n") || value === "" ? " " : "");
    }
    let out = highlightHtml(trimmed, lang, MAX_HL);
    if (highlightTerm && highlightTerm.length > 1) {
      // mark matches only inside text nodes (not inside tags)
      const re = new RegExp(`(${highlightTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
      out = out.replace(/(^|>)([^<]+)/g, (_m, a: string, b: string) => a + b.replace(re, "<mark>$1</mark>"));
    }
    return out;
  }, [editing, modified, value, trimmed, lang, highlightTerm]);
  const lines = value.split("\n").length;

  useEffect(() => {
    if (editing) taRef.current?.focus({ preventScroll: true });
  }, [editing]);

  return (
    <div className={`code${editing ? " editing" : ""}`}>
      <div className="code-head">
        <span className="code-title">{title}</span>
        {modified && (
          <span
            className="code-edited"
            title={saved ? "Saved in this session's changes: download them with Changes in the top bar" : "Scratch edits: nothing is saved, Reset or opening another item discards them"}
          >
            {saved ? "changed" : "edited"}
          </span>
        )}
        <span className="code-meta">
          {lang} · {lines} lines
        </span>
        <button className="btn-ghost sm" onClick={() => setWrap((w) => !w)}>
          {wrap ? "No wrap" : "Wrap"}
        </button>
        {editable && modified && (
          <button className="btn-ghost sm" onClick={() => setDraft(null)} title="Discard your edits and restore the original script">
            Reset
          </button>
        )}
        {editable && (
          <button
            className={`btn-ghost sm${editing ? " on" : ""}`}
            onClick={() => setEditing((v) => !v)}
            aria-pressed={editing}
            title={
              editing
                ? "Stop editing (your changes stay until Reset)"
                : saved
                  ? "Edit this script. Changes are kept for this session and can be downloaded as a modified package."
                  : "Edit this script for quick prototyping. Changes are never saved."
            }
          >
            {editing ? "Done" : "Edit"}
          </button>
        )}
        <button
          className="btn-ghost sm"
          onClick={() => {
            navigator.clipboard?.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="code-body" style={maxHeight ? { maxHeight } : undefined}>
        {!wrap && (
          <pre className="gutter" aria-hidden>
            {Array.from({ length: lines }, (_, i) => i + 1).join("\n")}
          </pre>
        )}
        <div className={`src-wrap${wrap ? " wrap" : ""}`}>
          <pre className={`hljs src ${wrap ? "wrap" : ""}`} aria-hidden={editing || undefined}>
            <code dangerouslySetInnerHTML={{ __html: html }} />
          </pre>
          {editing && (
            <textarea
              ref={taRef}
              className={`src-edit${wrap ? " wrap" : ""}`}
              value={value}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => handleEditorKeys(e, indent)}
              wrap={wrap ? "soft" : "off"}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              aria-label={`Edit ${title || "script"}`}
            />
          )}
        </div>
      </div>
    </div>
  );
}
