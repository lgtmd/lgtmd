import type { Decoration } from "./text-diff.ts";
import { ImageComparison } from "./image-comparison.tsx";
import { ContributorComments } from "./contributor-comments.tsx";
import {
  Fragment,
  Children,
  cloneElement,
  isValidElement,
  useState,
  type ReactNode,
  type ReactElement,
} from "react";
import {
  resourceUrl,
  type Bundle,
  type ContentNode,
  type Note,
  type Page,
  type ResourcePair,
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
  imageReview,
  textReview,
}: {
  page: Page;
  bundle: Bundle;
  resourceBase: string;
  notes?: boolean;
  textReview?: Decoration[];
  imageReview?: {
    enabled: boolean;
    pairs: ResourcePair[];
    beforeBase: string;
    afterBase: string;
    previousRevision: string;
    currentRevision: string;
  };
}) {
  const changes = new Map<ContentNode, Decoration>();
  for (const decoration of textReview ?? []) {
    let nodes = page.content;
    let node: ContentNode | undefined;
    for (const index of decoration.path) {
      node = nodes[index];
      nodes = node?.children ?? [];
    }
    if (node) changes.set(node, decoration);
  }
  function highlighted(node: ContentNode): ReactNode {
    const text = node.text ?? "";
    const change = changes.get(node);
    if (!change?.ranges) return text;
    const result: ReactNode[] = [];
    let offset = 0;
    const Tag = change.change === "removed" ? "del" : "ins";
    for (const range of change.ranges) {
      result.push(text.slice(offset, range.start));
      result.push(
        <Tag
          key={range.start}
          data-lgtmd-part="text-change"
          data-change={change.change}
        >
          {text.slice(range.start, range.end)}
        </Tag>,
      );
      offset = range.end;
    }
    result.push(text.slice(offset));
    return result;
  }
  // Decorate existing block elements, including lifted image fragments, without
  // adding wrappers that change prose margins, valid table markup or geometry.
  function markBlock(content: ReactNode, change: Decoration): ReactNode {
    return Children.map(content, (child) => {
      if (!isValidElement(child)) return child;
      const element = child as ReactElement<{ children?: ReactNode }>;
      if (child.type === Fragment)
        return cloneElement(
          element,
          {},
          markBlock(element.props.children, change),
        );
      if (typeof child.type !== "string") return child;
      if ((child.props as Record<string, unknown>)["data-lgtmd-part"])
        return cloneElement(
          element,
          {},
          markBlock(element.props.children, change),
        );
      return cloneElement(child as ReactElement<Record<string, unknown>>, {
        "data-lgtmd-part": "block-change",
        "data-change": change.change,
        "data-change-reason": change.reason,
        title: `${change.change === "modified" ? "Modified block" : change.change === "added" ? "Added block" : "Removed block"}${change.reason ? ` (${change.reason}; includes non-text or whitespace changes)` : ""}`,
      });
    });
  }
  const imagePair = (node: ContentNode) =>
    node.type === "image"
      ? imageReview?.pairs.find(
          (pair) =>
            pair.status !== "unchanged" &&
            pair.id === node.resource_id &&
            pair.page_id === (node.page_id ?? page.id),
        )
      : undefined;
  // Lift interactive comparisons out of paragraph/link/emphasis wrappers while
  // preserving the surrounding authored text and its original inline markup.
  type InlinePart =
    | { image: ContentNode; link?: ContentNode }
    | { nodes: ContentNode[] };
  function splitImages(nodes: ContentNode[]): InlinePart[] {
    const parts: InlinePart[] = [];
    const append = (node: ContentNode) => {
      const last = parts.at(-1);
      if (last && "nodes" in last) last.nodes.push(node);
      else parts.push({ nodes: [node] });
    };
    for (const node of nodes) {
      if (imagePair(node)) parts.push({ image: node });
      else if (
        node.children &&
        ["link", "emphasis", "strong", "strikethrough"].includes(node.type)
      ) {
        for (const part of splitImages(node.children)) {
          if ("image" in part)
            parts.push({
              ...part,
              link: part.link ?? (node.type === "link" ? node : undefined),
            });
          else append({ ...node, children: part.nodes });
        }
      } else append(node);
    }
    return parts;
  }
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
      <ContributorComments count={items.length}>
        {items.map((note) => (
          <div className="contributor-note" key={note.id}>
            {render(note.content, false)}
          </div>
        ))}
      </ContributorComments>
    ) : null;
  function render(
    nodes: ContentNode[],
    attach = true,
    header = false,
    align: string[] = [],
    imageLink?: ContentNode,
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
      const inlineChildren = () =>
        splitImages(node.children ?? []).map((part, partIndex) => (
          <Fragment key={partIndex}>
            {"image" in part
              ? render([part.image], false, header, align, part.link)
              : render(part.nodes, attach && !ownsNotes, header, align)}
          </Fragment>
        ));
      switch (node.type) {
        case "document":
          content = children();
          break;
        case "text":
          content = highlighted(node);
          break;
        case "paragraph":
          content = imageReview ? (
            splitImages(node.children ?? []).map((part, partIndex) => (
              <Fragment key={partIndex}>
                {"image" in part ? (
                  render([part.image], false, false, [], part.link)
                ) : (
                  <p>{render(part.nodes, attach && !ownsNotes)}</p>
                )}
              </Fragment>
            ))
          ) : (
            <p>{children()}</p>
          );
          break;
        case "heading": {
          const Tag = `h${Math.min(6, Math.max(1, node.level ?? 2))}` as "h1";
          const anchor =
            node.id ??
            (nodes[index - 1]?.type === "anchor"
              ? nodes[index - 1].id
              : undefined);
          const heading = (body: ReactNode, first = true) => (
            <Tag id={first ? node.id : undefined}>
              {body}
              {anchor && first ? (
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
          content = imageReview
            ? splitImages(node.children ?? []).map((part, partIndex) => (
                <Fragment key={partIndex}>
                  {"image" in part
                    ? render([part.image], false, false, [], part.link)
                    : heading(
                        render(part.nodes, attach && !ownsNotes),
                        partIndex === 0,
                      )}
                </Fragment>
              ))
            : heading(children());
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
          content = <li>{imageReview ? inlineChildren() : children()}</li>;
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
          content = (
            <kbd>
              {node.text !== undefined ? highlighted(node) : children()}
            </kbd>
          );
          break;
        case "code":
          content = (
            <code>
              {node.text !== undefined ? highlighted(node) : children()}
            </code>
          );
          break;
        case "code_block":
          content = (
            <pre data-lgtmd-part="code" data-language={node.language}>
              <code>
                {node.text !== undefined ? highlighted(node) : children()}
              </code>
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
        case "image": {
          const pair = imagePair(node);
          const linkedResource = imageLink?.resource_id
            ? bundle.resources.find(
                (item) =>
                  item.id === imageLink.resource_id &&
                  item.page_id === (imageLink.page_id ?? page.id),
              )
            : undefined;
          const imageHref = linkedResource
            ? resourceUrl(resourceBase, linkedResource)
            : imageLink?.page_id
              ? pageHref(imageLink.page_id, imageLink.id)
              : imageLink?.url
                ? safeHref(imageLink.url)
                : undefined;
          content =
            pair && imageReview && resource ? (
              <ImageComparison
                pair={pair}
                active={imageReview.enabled}
                source={resourceUrl(resourceBase, resource)}
                alt={node.text ?? ""}
                title={node.title}
                link={
                  imageHref
                    ? {
                        href: imageHref,
                        title: imageLink?.title,
                        download: linkedResource?.path.split("/").at(-1),
                      }
                    : undefined
                }
                beforeBase={imageReview.beforeBase}
                afterBase={imageReview.afterBase}
                previousRevision={imageReview.previousRevision}
                currentRevision={imageReview.currentRevision}
              />
            ) : resource ? (
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
        }
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
              {imageReview ? inlineChildren() : children()}
            </th>
          ) : (
            <td style={{ textAlign }}>
              {imageReview ? inlineChildren() : children()}
            </td>
          );
          break;
        }
        default:
          content = (
            <span className="notice warning">Unsupported content.</span>
          );
      }
      const change = changes.get(node);
      if (change && !change.ranges) content = markBlock(content, change);
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
