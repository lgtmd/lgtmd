import { Fragment, useState, type ReactNode } from "react";
import {
  resourceUrl,
  type Bundle,
  type ContentNode,
  type Note,
  type Page,
} from "./protocol.ts";

export function pageHref(page: string, anchor?: string): string {
  return `#/${encodeURIComponent(page)}${anchor ? `/${encodeURIComponent(anchor)}` : ""}`;
}
function safeHref(url: string): string | undefined {
  if (/^(https?:|mailto:|tel:)/i.test(url)) return url;
  return undefined;
}
export function ResourceImage({
  src,
  alt,
  title,
}: {
  src: string;
  alt: string;
  title?: string;
}) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span className="notice warning">
      Image unavailable: {alt || title || "resource"}
    </span>
  ) : (
    <img
      src={src}
      alt={alt}
      title={title}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
export function DocumentContent({
  page,
  bundle,
  resourceBase,
  notes = true,
}: {
  page: Page;
  bundle: Bundle;
  resourceBase: string;
  notes?: boolean;
}) {
  const attached = new Map<string, Note[]>();
  const loose: Note[] = [];
  for (const note of notes && bundle.audience === "contributor"
    ? page.notes
    : []) {
    if (note.anchor)
      attached.set(note.anchor, [...(attached.get(note.anchor) ?? []), note]);
    else loose.push(note);
  }
  const emitted = new Set<string>();
  const inNode = (node: ContentNode): Note[] => [
    ...(node.type === "anchor" && node.id ? (attached.get(node.id) ?? []) : []),
    ...(node.children ?? []).flatMap(inNode),
  ];
  const renderNotes = (items: Note[]) =>
    items.length ? (
      <aside
        data-lgtmd-part="notes"
        className="contributor-notes"
        aria-label="Contributor notes"
      >
        {items.map((note) => (
          <div className="contributor-note" key={note.id}>
            <div className="note-label">
              Contributor note
              {note.target ? (
                <span>
                  {" "}
                  · {note.target.kind}: {note.target.id}
                </span>
              ) : null}
            </div>
            {render(note.content, false)}
          </div>
        ))}
      </aside>
    ) : null;
  function render(
    nodes: ContentNode[],
    attach = true,
    header = false,
    align: string[] = [],
  ): ReactNode {
    return nodes.map((node, index) => {
      const ownsNotes = attach && node.type !== "document";
      const children = () =>
        render(
          node.children ?? [],
          attach && !ownsNotes,
          header || node.type === "table_head",
          node.type === "table" ? (node.align ?? []) : align,
        );
      let content: ReactNode;
      const resource = node.resource_id
        ? bundle.resources.find(
            (r) =>
              r.id === node.resource_id &&
              r.page_id === (node.page_id ?? page.id),
          )
        : undefined;
      const href = resource
        ? resourceUrl(resourceBase, resource)
        : node.page_id
          ? pageHref(node.page_id, node.id)
          : node.url
            ? safeHref(node.url)
            : undefined;
      switch (node.type) {
        case "document":
          content = children();
          break;
        case "text":
          content = node.text;
          break;
        case "paragraph":
          content = <p>{children()}</p>;
          break;
        case "heading": {
          const Tag = `h${Math.min(6, Math.max(1, node.level ?? 2))}` as "h1";
          const anchor =
            node.id ??
            (nodes[index - 1]?.type === "anchor"
              ? nodes[index - 1].id
              : undefined);
          content = (
            <Tag id={node.id}>
              {children()}
              {anchor ? (
                <a
                  className="heading-link"
                  href={pageHref(page.id, anchor)}
                  aria-label="Link to section"
                >
                  #
                </a>
              ) : null}
            </Tag>
          );
          break;
        }
        case "anchor":
          content = <span id={node.id} className="content-anchor" />;
          break;
        case "blockquote":
          content = <blockquote>{children()}</blockquote>;
          break;
        case "list":
          content =
            node.start == null ? (
              <ul>{children()}</ul>
            ) : (
              <ol start={node.start}>{children()}</ol>
            );
          break;
        case "item":
          content = <li>{children()}</li>;
          break;
        case "emphasis":
          content = <em>{children()}</em>;
          break;
        case "strong":
          content = <strong>{children()}</strong>;
          break;
        case "strikethrough":
          content = <s>{children()}</s>;
          break;
        case "key":
          content = <kbd>{node.text ?? children()}</kbd>;
          break;
        case "code":
          content = <code>{node.text ?? children()}</code>;
          break;
        case "code_block":
          content = (
            <pre data-lgtmd-part="code" data-language={node.language}>
              <code>{node.text ?? children()}</code>
            </pre>
          );
          break;
        case "soft_break":
          content = "\n";
          break;
        case "hard_break":
          content = <br />;
          break;
        case "rule":
          content = <hr />;
          break;
        case "link":
          content = href ? (
            <a
              href={href}
              title={node.title}
              download={resource ? resource.path.split("/").at(-1) : undefined}
              rel="noopener noreferrer"
            >
              {children()}
            </a>
          ) : (
            <span>{children()}</span>
          );
          break;
        case "image":
          content = resource ? (
            <ResourceImage
              src={resourceUrl(resourceBase, resource)}
              alt={node.text ?? ""}
              title={node.title}
            />
          ) : href ? (
            <a href={href} rel="noopener noreferrer">
              {node.text || node.title || "External image"}
            </a>
          ) : (
            <span className="notice warning">
              Image reference is unavailable.
            </span>
          );
          break;
        case "table":
          content = (
            <div className="table-scroll">
              <table>{children()}</table>
            </div>
          );
          break;
        case "table_head":
          content = (
            <thead>
              <tr>{children()}</tr>
            </thead>
          );
          break;
        case "table_row":
          content = (
            <tbody>
              <tr>{children()}</tr>
            </tbody>
          );
          break;
        case "table_cell": {
          const textAlign = ["left", "center", "right"].includes(align[index])
            ? (align[index] as "left" | "center" | "right")
            : undefined;
          content = header ? (
            <th scope="col" style={{ textAlign }}>
              {children()}
            </th>
          ) : (
            <td style={{ textAlign }}>{children()}</td>
          );
          break;
        }
        default:
          content = (
            <span className="notice warning">Unsupported content.</span>
          );
      }
      const notesHere = ownsNotes
        ? inNode(node).filter((note) => !emitted.has(note.id))
        : [];
      notesHere.forEach((note) => emitted.add(note.id));
      return (
        <Fragment key={index}>
          {content}
          {renderNotes(notesHere)}
        </Fragment>
      );
    });
  }
  return (
    <div className="prose" data-lgtmd-part="prose">
      {render(page.content)}
      {renderNotes(loose)}
    </div>
  );
}
