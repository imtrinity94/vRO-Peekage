#!/usr/bin/env node
/**
 * Builds public/vroapi-classes.json, the class index the code viewer uses to link
 * Orchestrator classes to modernvroapi.in.
 *
 *   node scripts/build-vroapi-index.mjs <path-to-modern-vroapi-checkout>
 *
 * Source: vro-doc-site/src/data/search-index.json in github.com/imtrinity94/modern-vroapi
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.argv[2];
if (!root) {
  console.error("usage: node scripts/build-vroapi-index.mjs <modern-vroapi checkout>");
  process.exit(1);
}
const src = JSON.parse(readFileSync(path.join(root, "vro-doc-site/src/data/search-index.json"), "utf8"));

// Everything modernvroapi.in documents is linked, including JavaScript built-ins (JSON, Array, Date ...).
// Names that are also ordinary words or primitive types in scripts.
const SKIP = new Set(["boolean", "char", "selected"]);

const plugins = {};
for (const p of src.plugins) plugins[p.id] = p.name;

const classes = {};
for (const c of src.classes) {
  if (SKIP.has(c.n) || !/^[A-Za-z_$][\w$]*$/.test(c.n)) continue;
  (classes[c.n] ??= []).includes(c.p) || classes[c.n].push(c.p);
}

const out = { source: "https://modernvroapi.in", generated: new Date().toISOString().slice(0, 10), plugins, classes };
const file = path.join(path.dirname(new URL(import.meta.url).pathname), "../public/vroapi-classes.json");
writeFileSync(file, JSON.stringify(out));
console.log(`${Object.keys(classes).length} classes from ${Object.keys(plugins).length} plugins → ${file}`);
