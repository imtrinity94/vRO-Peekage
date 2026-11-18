# vRO Peekage

<img src="public/brand/peekbox-mark.svg" width="72" alt="vRO Peekage logo">

**Peek into your vRO Packages — no Orchestrator needed.**

_Formerly vRO Package Viewer._ · Live at **https://vro-peekage.vercel.app**

Browse the contents of a `.package` file from **vRealize Orchestrator 7.x**, **Aria Automation Orchestrator 8.x** or **VCF Operations Orchestrator 9.x** in the browser — workflows, actions, configuration elements, resource elements and polyglot environments — without importing it into an Orchestrator.

The package is parsed entirely client-side (JSZip + DOMParser). Nothing is uploaded; the Vercel deployment is a static site with no backend. The CSP in `vercel.json` also blocks outbound connections.

## Features

- **Overview**: package metadata (name, ID, source vRO version, signer, owner), counts per element type, lines of script by language, sortable inventory with CSV / Markdown export.
- **Sidebar tree**: grouped by type, then by folder (workflows, config, resources) or module (actions). Filter by name, folder or ID.
- **Workflows**: inputs, outputs and attributes (including config-element bindings), a schema diagram built from the saved canvas positions (next / alternative / error-handler paths), per-item bindings and scripts, and custom input forms (start form + user-interaction forms).
- **Actions**: signature, parameters, script (JS / Python / PowerShell / Node), runtime, memory / timeout, bundle download.
- **Configuration elements**: attributes with decoded values (arrays, properties, SDK object references); SecureStrings are masked.
- **Resource elements**: MIME type, size, preview for text / JSON / XML / images / PDF, download.
- **Environments** (`ActionEnvironment`): runtime, dependencies, environment variables, bundle file listing and download.
- **Workflow runs** (`WorkflowToken`, from "Export run" packages): status, start/end, duration and profiler timings; the run's input, output and variable values split by the workflow's own signature (multi-line output shown console-style); exception details; the schema with the path that ran highlighted and timed; per-step timing; trace ID and any extension files (logs are rendered as a table when present).
- **References**: "uses" / "used by" between elements (ID references, `System.getModule(...)` calls, `script-module` items, linked workflows, runtime environments), plus a list of actions referenced from outside the package.
- **API links**: Orchestrator classes in scripts (`VraHostManager`, `System`, `Server` …) link to their reference page on [modernvroapi.in](https://modernvroapi.in), straight to the method for `Class.method(...)` calls. JavaScript built-ins (`JSON`, `Math`, `Error` …) link to MDN. The class index is `public/vroapi-classes.json`; rebuild it with `node scripts/build-vroapi-index.mjs <modern-vroapi checkout>`.
- **Search**: full-text / regex search across every script, config value and (optionally) raw XML.
- **Raw**: every file stored for an element, decoded (the package stores most XML as UTF-16BE), with per-file download.

## Export everything

The **Export** button (top bar) or **Download .zip** (Overview) builds one zip per package in the browser:

```
report.html            self-contained report: contents, inventory, every element, diagrams, scripts.
                       Opens offline; "Save as PDF / Print" gives a paginated PDF.
inventory.csv / .md    element inventory
diagrams/              every workflow schema (and recorded run paths) as SVG + PNG
scripts/               scriptable tasks (scripts/workflows/<folder>/<workflow>/NN <step>.js|py|ps1)
                       and actions (scripts/actions/<module>/<name>.js|py|ps1), bindings/params in a header
workflows-xml/         raw workflow XML (opens in wdt4vro)
configurations/        configuration elements as JSON
resources/             resource element files as stored in the package
environments/, runs/   environment definitions and recorded runs as JSON
```

SecureString values are never exported. Polyglot environment bundles are left out (dependencies are listed).

## Package format notes

A `.package` is a zip:

```
dunes-meta-inf                 java.util.Properties XML: pkg-name, pkg-id, vso-version, signer, owner…
certificates/…                 signer certificate(s)
signatures/…                   per-file signatures (when the package is signed)
elements/<id>/info             Properties XML: id, type (Workflow, ScriptModule, ConfigurationElement, ResourceElement, ActionEnvironment…)
elements/<id>/categories       folder path (outermost first) or action module
elements/<id>/data             element XML (UTF-16BE) — or, for ResourceElement, a nested zip with VSO-RESOURCE-INF/attribute_* + data
elements/<id>/input_form_*     workflow custom forms (JSON)
elements/<id>/bundle           polyglot environment / action bundle (zip)
elements/<id>/extensions/…     WorkflowToken extras, e.g. profiler.json (per-step timings)
elements/<id>/tags             tags such as the run's trace-id
```

Scripts saved with `encoded="true"` (hex UTF-16) are decoded automatically. Unknown element types still appear under **Other**, with their raw files.

## Develop

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # static build in dist/
npm run build:single # one self-contained HTML file in dist-single/index.html
npm run test:parse -- path/to/file.package   # parse a package in Node and print a summary
```

## Deploy to Vercel

The site's canonical address is `https://vro-package-viewer.vercel.app` (set in `index.html`, `public/sitemap.xml` and `public/robots.txt`). If the site moves to another domain, update those three.

`npm run build` also pre-renders the landing page into `dist/index.html`, so search engines and link previews see real content without running JavaScript.


Push the repo to GitHub and import it in Vercel — the Vite preset is detected (`vercel.json` pins build command and output). Or from the CLI:

```bash
npm i -g vercel
vercel        # preview
vercel --prod
```

## Disclaimer

vRO Peekage is an independent community tool and is not affiliated with or endorsed by Broadcom or VMware. vRealize, Aria and VCF are trademarks of Broadcom.
