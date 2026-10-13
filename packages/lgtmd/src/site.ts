import { bridgeRequest } from "./compiler.js";
import type { FrozenDocument } from "./model.js";
export type Audience = "reader" | "contributor";
export type SiteFiles = Record<string, number[]>;
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
export interface SiteTarget {
  id: string;
  kind: string;
}
export interface SiteNote {
  id: string;
  target?: SiteTarget;
  anchor?: string;
  content: ContentNode[];
}
export interface SitePage {
  id: string;
  title: string;
  content: ContentNode[];
  anchors: string[];
  notes: SiteNote[];
  targets?: SiteTarget[];
}
export interface SiteResource {
  page_id: string;
  id: string;
  path: string;
  mime: string;
  producer: string;
  profile: string;
  bytes: number;
  sha256: string;
}
export interface SiteBundle {
  schema_version: 1;
  audience: Audience;
  title: string;
  navigation: string[];
  pages: SitePage[];
  resources: SiteResource[];
  digest: string;
}
export type ChangeStatus = "added" | "removed" | "changed" | "unchanged";
export interface SitePagePair {
  id: string;
  status: ChangeStatus;
  before?: SitePage;
  after?: SitePage;
}
export interface SiteResourcePair {
  page_id: string;
  id: string;
  status: ChangeStatus;
  before?: SiteResource;
  after?: SiteResource;
  compatible: boolean;
  compatibility:
    | "matching"
    | "different-format"
    | "different-profile"
    | "missing-side";
}
export interface SiteReview {
  schema_version: 1;
  audience: Audience;
  before: string;
  after: string;
  site_changed: boolean;
  pages: SitePagePair[];
  resources: SiteResourcePair[];
}
export interface Projection {
  bundle: SiteBundle;
  files: SiteFiles;
}
export interface SiteCompilation {
  reader: Projection;
  contributor: Projection;
  markdown: { reader: SiteFiles; contributor: SiteFiles };
  candidate_id: string;
}
export type SiteStoreKind = "snapshot" | "static" | "markdown";
export async function compileSite(
  documents: readonly FrozenDocument[],
  options: { title?: string; navigation?: readonly string[] } = {},
): Promise<SiteCompilation> {
  return (await bridgeRequest({
    operation: "compile-site",
    input: { schema_version: 1, documents },
    title: options.title ?? "Documentation",
    ...(options.navigation ? { navigation: options.navigation } : {}),
  })) as SiteCompilation;
}
export function validateSite(
  files: SiteFiles,
  kind: "markdown",
): Promise<{ files: SiteFiles }>;
export function validateSite(
  files: SiteFiles,
  kind?: "snapshot" | "static",
): Promise<Projection>;
export async function validateSite(
  files: SiteFiles,
  kind: SiteStoreKind = "snapshot",
): Promise<Projection | { files: SiteFiles }> {
  return (await bridgeRequest({
    operation: "validate-site",
    files,
    kind,
  })) as Projection;
}
export async function compareSite(
  before: SiteFiles,
  after: SiteFiles,
): Promise<SiteReview> {
  return (await bridgeRequest({
    operation: "compare-site",
    before,
    after,
  })) as SiteReview;
}
export async function storeSite(
  command: "build" | "check" | "update",
  path: string,
  files: SiteFiles,
  kind: SiteStoreKind = "snapshot",
): Promise<SiteFiles> {
  const result = (await bridgeRequest({
    operation: "site-store",
    command,
    path,
    files,
    kind,
  })) as { files: SiteFiles };
  return result.files;
}
