import type JSZip from "jszip";

export type KnownType =
  | "Workflow"
  | "ScriptModule"
  | "ConfigurationElement"
  | "ResourceElement"
  | "ActionEnvironment"
  | "PolicyTemplate";

export interface Param {
  name: string;
  type: string;
  description?: string;
  value?: string;
}

export interface Attrib extends Param {
  readOnly?: boolean;
  confId?: string;
  confKey?: string;
  encoded?: string;
}

export interface Bind {
  name: string;
  type: string;
  exportName?: string;
}

export interface WfItem {
  name: string;
  type: string;
  displayName?: string;
  description?: string;
  script?: string;
  runtime?: string;
  /** Highlighting language for the script: javascript | python | powershell */
  lang: string;
  /** Human-readable runtime, e.g. "JavaScript (Rhino)", "python:3.10", "PowerShell (detected) · environment not in package" */
  runtimeLabel: string;
  /** Environment id when the script runs in an action environment */
  environmentId?: string;
  outName?: string;
  altOutName?: string;
  catchName?: string;
  linkedWorkflowId?: string;
  scriptModule?: string;
  prototypeId?: string;
  launchedWorkflowId?: string;
  endMode?: string;
  inBindings: Bind[];
  outBindings: Bind[];
  conditionTargets: string[];
  x?: number;
  y?: number;
}

export interface ElementFile {
  name: string;
  size: number;
  /** Decoded text if the file looks like text, otherwise undefined */
  text?: string;
}

export interface BaseElement {
  id: string;
  /** Folder name under elements/ in the package zip (normally the same as id) */
  folder: string;
  type: string;
  name: string;
  /** Folder / category path, outermost first. For actions this is the module name. */
  path: string[];
  version?: string;
  description?: string;
  allowedOperations?: string;
  files: ElementFile[];
  /** Main XML/JSON text from the `data` file, when it is text */
  raw?: string;
  /** Every searchable script body in this element: label -> code */
  scripts: { label: string; code: string; lang: string; itemName?: string }[];
  signed: boolean;
  /** Raw bytes of any file in the element folder */
  getFile: (name: string) => Promise<Uint8Array>;
}

export interface WorkflowElement extends BaseElement {
  kind: "workflow";
  rootName?: string;
  apiVersion?: string;
  inputs: Param[];
  outputs: Param[];
  attributes: Attrib[];
  items: WfItem[];
  start?: { x: number; y: number };
  /** Items that have a workflow-level error handler attached (<error-handler name="item…">) */
  errorHandlers: string[];
  inputForms: { name: string; json: unknown; text: string }[];
}

export interface ActionElement extends BaseElement {
  kind: "action";
  module: string;
  resultType?: string;
  runtime?: string;
  entryHandler?: string;
  memoryLimit?: string;
  timeout?: string;
  environmentId?: string;
  /** Highlighting language for the script: javascript | python | powershell */
  lang: string;
  /** Human-readable runtime, e.g. "JavaScript (Rhino)", "powercli:7.4 · environment datasets_1_0_0" */
  runtimeLabel: string;
  params: Param[];
  script: string;
  hasBundle: boolean;
}

export interface ConfigElement extends BaseElement {
  kind: "config";
  attributes: Attrib[];
}

export interface ResourceElement extends BaseElement {
  kind: "resource";
  mimeType?: string;
  size?: number;
  fileName: string;
  getBytes: () => Promise<Uint8Array>;
}

export interface EnvironmentElement extends BaseElement {
  kind: "environment";
  runtime?: string;
  dependencies: Record<string, string>;
  environmentVariables: Record<string, string>;
  meta: Record<string, unknown>;
  hasBundle: boolean;
  listBundle: () => Promise<{ name: string; size: number; dir: boolean }[]>;
  getBundleBytes: () => Promise<Uint8Array | undefined>;
}

export interface RunValue {
  name: string;
  type: string;
  value?: string;
  /** which <atts> block it came from (0 = main stack) */
  block: number;
  scope?: string;
}

export interface ProfileNode {
  id: string;
  depth: number;
  totalTime?: number;
  maxTime?: number;
  executions?: number;
}

export interface RunElement extends BaseElement {
  kind: "run";
  title: string;
  workflowId?: string;
  /** workflow ids from outermost to innermost (nested sub-workflow calls) */
  workflowStack: string[];
  itemStack: string[];
  currentItemState?: string;
  globalState?: string;
  businessState?: string;
  start?: Date;
  end?: Date;
  values: RunValue[];
  exception?: string;
  transitionType?: string;
  ancestorTokenId?: string;
  tags: { name: string; value: string; global: boolean }[];
  profile?: {
    metrics: Record<string, number>;
    items: ProfileNode[];
  };
  /** extension files other than the profiler (e.g. logs), parsed when JSON */
  extensions: { name: string; text: string; json?: unknown }[];
}

export interface GenericElement extends BaseElement {
  kind: "generic";
}

export type PkgElement =
  | WorkflowElement
  | ActionElement
  | ConfigElement
  | ResourceElement
  | EnvironmentElement
  | RunElement
  | GenericElement;

export interface PackageInfo {
  fileName: string;
  fileSize: number;
  meta: Record<string, string>;
  certificates: string[];
  signed: boolean;
  elements: PkgElement[];
  byId: Map<string, PkgElement>;
  /** element id -> ids it references */
  refs: Map<string, Set<string>>;
  /** element id -> ids that reference it */
  usedBy: Map<string, Set<string>>;
  warnings: string[];
  /** action "module/name" -> element id */
  actionIndex: Map<string, string>;
  /** The opened package archive, kept for rebuilding a modified package */
  zip: JSZip;
}
