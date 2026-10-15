# Changelog

All notable changes to vRO Peekage are listed here, newest first.

**Versioning:** `YEAR.MINOR.PATCH` (for example `2026.7.0`).

- **YEAR**: the calendar year of the release.
- **MINOR**: goes up for new features or visible changes. It restarts at 1 in a new year.
- **PATCH**: goes up for fixes and small tweaks.

The version lives in `package.json` and is shown in the app's top bar.

---

## 2026.13.2 (2026-10-15)

### Fixed
- The role line now always types letter by letter. When the system's "reduce motion" setting was on (for example Windows with **Animation effects** off), the words only swapped.

---

## 2026.13.1 (2026-10-15)

### Changed
- The typing line is slower, so each letter can be seen: 120 ms per letter, a 1.8 s pause on the full word, and gentler deleting.
- The front-page hero is less crowded. It is now three spaced groups: headline and typing line; description and AI note; then the buttons, link box and privacy note.
- **Package Signer** moved from a card in the hero to a link in the top bar, which is also visible on the signer page.

---

## 2026.13.0 (2026-10-15)

### Added
- **Package Signer** (`#/sign`), a separate tool linked from the front page. It re-signs any `.package` with a new publisher certificate valid for **10 years**, entirely in the browser.
  - Create a new certificate (RSA 2048, SHA-512, 10 years; defaults CN "vRO Package Signer", OU "Automation", O "Orchestrator", optional country), or reuse an existing PEM key and certificate.
  - Every file is signed again, the old signatures and certificates are replaced, and `pkg-signer` is updated. An option also makes the certificate the package owner.
  - Shows the current and new publisher, validity and SHA-1 fingerprint. **Download signing key** gives a zip with the key, the certificate (PEM and DER) and keytool commands for a JCEKS keystore.
- **Typing animation** in the hero: "Your vRO …" types and replaces each role in a loop: content viewer, document generator, XML to JS converter, code parser, real-time code editor, package signer, workflow schema viewer, configuration element reader. With "reduce motion", the words swap without typing.

---

## 2026.12.0 (2026-10-14)

### Added
- **Edit a package and download it as a new .package.** Changes are kept for the whole session and can be imported back into Orchestrator.
  - **What you can edit:** action scripts and workflow scriptable-task scripts (with **Edit** on the script), and configuration element values of type string, number and boolean (with **Edit** on the value).
  - **Changes panel:** a **Changes** button in the top bar, with a count, lists every changed element and what changed. Each element can be undone, and **Download** builds `<package>-modified.package`. Changed elements are marked with a dot in the sidebar.
  - **Versions:** every changed element gets a suggested higher version (0.0.0 → 0.0.1, 1.4.0 → 1.4.1), which you can edit. Orchestrator only picks an element up on import when its version is higher, and a version that isn't higher blocks the download.
  - **How the rebuild works:** it starts from the original package and replaces only the edited scripts or values inside each element's existing XML. Every other file, including signatures and certificates, is kept byte for byte and in the same order. Orchestrator 9.1 rejects packages without their signature files, but accepts these.
  - **SecureStrings** can't be edited and are kept as they are. Plain-text values were rejected by Orchestrator on import, so set them in Orchestrator after importing.
  - **Unsaved changes:** a warning appears before closing the tab, going Home or opening another package while changes haven't been downloaded.
- Script viewers outside a package (the front-page sample, resource files) keep the scratch-only Edit button.

---

## 2026.11.1 (2026-10-10)

### Changed
- While a package loads, a full-screen overlay now shows what's happening, instead of only the small button text changing:
  - **Downloading package…**, with the source site and a live progress bar (for example "github.com · 611 KB of 1.80 MB")
  - **Reading package…**, with the file name and size, while it's parsed
- It covers shared links, the URL box, choosing a file and drag-and-drop. The animation stays still when "reduce motion" is on.

### Fixed
- Browser **Back** after **Home** now reopens a package that was opened from a link, on the item you were viewing. **Forward** returns to the front page. Previously the address bar changed but nothing happened.

---

## 2026.11.0 (2026-10-10)

### Added
- **Open a package from a link.** Paste a URL on the front page and the package is downloaded and opened automatically.
  - GitHub and GitLab "view file" links are turned into direct download links, and Dropbox share links ask for the file itself.
  - The browser downloads directly whenever the site allows it, which involves no server at all.
  - Only when a site blocks direct downloads does a small fallback (`/api/fetch-package`) fetch it instead. It is locked down for the Vercel Hobby plan:
    - public http(s) addresses only, with internal and private IPs refused, including after redirects
    - requests from vRO Peekage itself only
    - at most 4.4 MB, and the file must be a zip
    - cached at the CDN for an hour
- **Shareable links.** `vro-peekage.vercel.app/?url=<package-url>` opens that package straight away, which is handy in blog posts and READMEs. A **Share** button in the top bar copies the link for a package opened from a URL, and **Home** clears it.

### Changed
- The security policy allows the browser to download packages from https sites.
- The front page's privacy line now reads "Files you choose are never uploaded."

---

## 2026.10.0 (2026-10-09)

### Changed
- **The workflow schema now follows Orchestrator's own layout.** Items are drawn at the positions saved in the workflow, 1:1, instead of being stretched 1.5× across and 3× down. Each item type is anchored the way the Orchestrator client places it, so slopes and spacing match what you see in Orchestrator.
- The Start node uses the workflow's own saved position instead of being placed 180px left of the first item.
- Labels are regular weight, and Start and End no longer get "Start" / "End" captions, matching Orchestrator.
- Arrows are thin lines that stop short of each icon, with small arrowheads and finer red dashes. An arrow that would cross its own item's label now starts just past it.
- The background dot grid is larger and wider-spaced, like Orchestrator's canvas.

### Fixed
- Workflows with items stacked closely in a column no longer overlap. The vertical axis is stretched just enough to fit each icon and its label, horizontal positions stay 1:1, and single-row workflows are unchanged.

---

## 2026.9.2 (2026-10-08)

### Changed
- Action pages no longer show the one-line signature (`module/name(param: type, …) : type`). Instead they show:
  - an **Inputs** table with each parameter's name, type and description
  - an **Output** row with the return type, or "void (returns nothing)"
- The export report uses the same layout for actions.

---

## 2026.9.1 (2026-10-08)

### Fixed
- **PowerShell and Python actions shown as JavaScript.** An 8.x action that runs in an action environment can name that environment in a `<environment>` element instead of a `runtime` attribute. That element wasn't read, so the action fell back to "JavaScript (Rhino)". It was highlighted as JavaScript and exported as a `.js` file.
- Scriptable tasks that use an environment were always assumed to be Python.

### Changed
- The script language is now worked out in this order:
  1. the element's own runtime
  2. the runtime of its environment, if the environment is in the package
  3. detection from the script itself, labelled for example "PowerShell (detected) · environment not in package"
  4. JavaScript (Rhino) for ordinary scripts
- The viewer, the report and the exported files (`.ps1` / `.py` / `.js`) all use the same result.

---

## 2026.9.0 (2026-10-08)

### Added
- **Resizable table columns.** Drag the right edge of any column header to resize it, and double-click the edge to reset. This works on every data table in the app.
- **Readable composite and array values.** Values such as an `Array/CompositeType(...)` in a configuration element, previously shown raw as `[205:CompositeType(...)#{14:20:...}`, are now decoded:
  - an array of composite values becomes a small table with one row per item and one column per field
  - plain arrays become a numbered list, and properties become a key/value table
  - the same decoding is used in workflow-run values, and as one-line text in the export report

### Changed
- Composite types in the Type column show their short name (for example `Array/ABSADCToRubrikClusterMapping`), with the field names underneath and the full signature on hover.

### Fixed
- Long sidebar group titles such as "Configuration Elements" now wrap left-aligned instead of centred.

---

## 2026.8.2 (2026-10-08)

### Changed
- The AI note moved out of the "Browse and export" step and into the landing page hero, right under the main description. It now reads "Ready for your AI assistant".
- A small **AI** badge sits beside it, with a slow colour shimmer and two twinkling sparkles. The animation switches off when "reduce motion" is turned on.

---

## 2026.8.1 (2026-10-08)

### Changed
- The landing page now says what the export actually contains — report, inventory, diagrams and every script as a real file — and notes that the zip is plain text throughout, so an AI assistant can read it too: point one at the unzipped folder and ask it about your workflows.
- The third step is now "Browse and export" rather than "Browse and share", which better matches what it does.

---

## 2026.8.0 (2026-10-06)

### Added
- An **Edit** button on every script and code viewer for quick prototyping. It is scratch editing only: nothing is saved, and the package and the export are never changed.
  - Syntax colours update live as you type, and the line numbers follow.
  - **Tab** and **Shift+Tab** indent and outdent, including across several selected lines.
  - **Enter** keeps the current indentation, and adds one level after `{`, `(` or `[`.
  - **Esc** leaves the editor.
  - An **edited** badge appears once the script changes. **Reset** restores the original. **Copy** copies your edited version.
  - Edits are discarded when you open another item.

## 2026.7.0 (2026-10-06)

### Added
- Vercel Web Analytics (`@vercel/analytics`) for page views and visitors.
- Vercel Speed Insights (`@vercel/speed-insights`) for real-user performance metrics.
- App version shown next to "vRO Peekage" in the top bar, in a smaller and lighter style.
- This changelog, with year-based version numbers.

## 2026.6.1 (2026-10-06)

### Changed
- The exported report and zip no longer carry any vRO Peekage branding, so they can be shared with customers as they are. This covers the title, cover, footer, README, script headers and fonts.

### Fixed
- Removed a stray `.claude-update.tgz` from the repo and added `.claude-*` to `.gitignore`.

## 2026.6.0 (2026-10-05)

### Added
- An **Export everything** button in the top bar and on the Overview page, with progress. It produces one zip per package containing:
  - `report.html`: a self-contained, print-ready report with an inventory and a section per element type
  - workflow schema diagrams as SVG and PNG, with the run overlay where a run exists
  - action and workflow scripts as `.js` files with header comments
  - raw workflow XML, configurations, resources, environments and runs
  - `inventory.csv` / `inventory.md` and a `README.txt`
- SecureString values are masked everywhere in the export.

## 2026.5.0 (2026-10-02)

### Added
- A workflow schema that matches Orchestrator, ported from wdt4vro: the real Orchestrator item icons, layout, error handlers and connectors.
- Zoom (wheel or buttons), drag-to-pan and fit-to-view on the schema.
- **Download SVG** and **Download PNG** for the schema.
- The workflow run overlay on the schema, showing executed items in green.

## 2026.4.0 (2026-10-02)

### Changed
- An Orchestrator-like light theme: navy top bar and a grey side panel, with blue highlighting on the active item.
- The UI font is now Clarity City, the font Orchestrator uses. It replaced Metropolis, which was harder to read.

## 2026.3.0 (2026-10-02)

### Added
- A Home button in the top bar that closes the package and returns to the front page.
- A floating back-to-top button.
- A GitHub icon link.

### Changed
- A taller top bar with larger icons.

## 2026.2.1 (2026-10-02)

### Fixed
- CSS and JS failed to load on the live site after a host redirect. The redirect was removed and URLs now point at the current domain.
- Restored source files that the rebrand commit had removed.

## 2026.2.0 (2026-10-01)

### Added
- The **vRO Peekage** name, the Peek Box logo and the tagline "Peek into your vRO Packages — no Orchestrator needed".
- A new, modern landing page that keeps the in-app look.
- Supported products listed as vRealize Orchestrator 7.x, Aria Automation Orchestrator 8.x and VCF Operations Orchestrator 9.x.
- SEO: meta and Open Graph tags, an OG image, sitemap, robots.txt, web manifest and a prerendered landing page.
- Security headers (CSP) in `vercel.json`.

## 2026.1.1 (2026-10-01)

### Fixed
- Code in the code viewer no longer overlaps the line-number gutter.

## 2026.1.0 (2026-10-01)

### Added
- The first release of the vRO package viewer, which parses `.package` files entirely in the browser.
- Lists workflows, actions, configuration elements, resource elements, environments and other elements, with search.
- Workflow details: inputs, outputs, attributes, script items, schema and presentation.
- Action scripts with syntax highlighting.
- A workflow run (WorkflowToken) view showing status, timings, inputs and outputs, variables and logs.
