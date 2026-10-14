/** Wire contracts are data, independent of the reading/review presentation. */
export type Audience = "reader" | "contributor";
export interface ContentNode {
  type:
    | "document"
    | "paragraph"
    | "heading"
    | "blockquote"
    | "list"
    | "item"
    | "emphasis"
    | "strong"
    | "strikethrough"
    | "link"
    | "image"
    | "code_block"
    | "table"
    | "table_head"
    | "table_row"
    | "table_cell"
    | "key"
    | "code"
    | "text"
    | "soft_break"
    | "hard_break"
    | "rule"
    | "anchor";
  children?: ContentNode[];
  text?: string;
  level?: number;
  start?: number;
  url?: string;
  title?: string;
  language?: string;
  id?: string;
  resource_id?: string;
  page_id?: string;
  align?: string[];
}
export interface Note {
  id: string;
  target?: { id: string; kind: string };
  anchor?: string;
  content: ContentNode[];
}
export interface Page {
  id: string;
  title: string;
  content: ContentNode[];
  anchors: string[];
  notes: Note[];
}
export interface Resource {
  page_id: string;
  id: string;
  path: string;
  mime: string;
  producer: string;
  profile: string;
  bytes: number;
  sha256: string;
}
export interface Bundle {
  schema_version: 1;
  audience: Audience;
  title: string;
  navigation: string[];
  pages: Page[];
  resources: Resource[];
  digest: string;
}
export type Change = "added" | "removed" | "changed" | "unchanged";
export interface ResourcePair {
  page_id: string;
  id: string;
  status: Change;
  before?: Resource;
  after?: Resource;
  compatible: boolean;
  compatibility: string;
}
export interface Comparison {
  schema_version: 1;
  audience: Audience;
  before: string;
  after: string;
  site_changed: boolean;
  pages: { id: string; status: Change; before?: Page; after?: Page }[];
  resources: ResourcePair[];
}
export interface GitCommit {
  revision: string;
  subject: string;
  committedAt: number;
  decorations: string;
}
export interface SiteState {
  /** Retained comparison fixtures; no Git identity or live execution. */
  reviewSource?: {
    kind: "fixture";
    beforeLabel: string;
    afterLabel: string;
    description: string;
  };
  history?: {
    commits: GitCommit[];
    truncated: boolean;
    offset: number;
    message?: string;
  };
  mode: "dev" | "static";
  title: string;
  audience: Audience;
  run: {
    status: "idle" | "running" | "succeeded" | "failed" | "cancelled";
    retained: boolean;
    stale: boolean;
    message?: string;
  };
  candidateId?: string;
  current?: Bundle;
  currentResourceBase?: string;
  baseline?: {
    status: "available" | "unavailable" | "loading";
    ref: string;
    revision?: string;
    commit?: GitCommit;
    code?: string;
    message?: string;
    bundle?: Bundle;
    resourceBase?: string;
  };
  comparison?: Comparison;
  canRun: boolean;
  token?: string;
}
export interface Boot {
  mode: "dev" | "static" | "review";
  basePath: string;
  dataUrl: string;
}
declare global {
  interface Window {
    __LGTMD__?: Boot;
  }
}
export function resourceUrl(base: string, resource: Resource): string {
  return new URL(
    base + resource.path.split("/").map(encodeURIComponent).join("/"),
    document.baseURI,
  ).href;
}
