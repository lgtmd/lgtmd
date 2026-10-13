//! CommonMark validation and provenance for framework-generated HTML.
use crate::{
    Result,
    model::{Inline, Prose},
};
use pulldown_cmark::{BrokenLink, Event, Options, Parser, Tag};
use std::ops::Range;

/// Keep provenance for the small amount of HTML emitted by typed bindings and
/// anchors. Authored Markdown never acquires that permission by sharing a page.
#[derive(Default)]
pub(crate) struct Rendered {
    pub(crate) text: String,
    html: Vec<Range<usize>>,
}

impl Rendered {
    pub(crate) fn text(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            html: Vec::new(),
        }
    }

    pub(crate) fn html(text: String) -> Self {
        let len = text.len();
        Self {
            text,
            html: std::iter::once(0..len).collect(),
        }
    }

    pub(crate) fn push(&mut self, other: Self) {
        let offset = self.text.len();
        self.text.push_str(&other.text);
        self.html.extend(
            other
                .html
                .into_iter()
                .map(|range| range.start + offset..range.end + offset),
        );
    }

    pub(crate) fn quote(self) -> Self {
        let mut result = Self::default();
        let mut offset = 0;
        for line in self.text.split_inclusive('\n') {
            let start = result.text.len() + 2;
            result.text.push_str("> ");
            result.text.push_str(line);
            for range in &self.html {
                let left = range.start.max(offset);
                let right = range.end.min(offset + line.len());
                if left < right {
                    result
                        .html
                        .push(start + left - offset..start + right - offset);
                }
            }
            offset += line.len();
        }
        // Match str::lines(), used by the original note renderer.
        if result.text.ends_with('\n') {
            result.text.pop();
        }
        result
    }
}

pub(crate) fn markdown_links(text: &str) -> Result<Vec<String>> {
    parsed_links(&Rendered::text(text), &[])
}

/// Parse the bytes that will actually be exported. Every HTML token must come
/// from a generated span, every generated tag must survive Markdown parsing,
/// and code/container blocks cannot consume the next authored node. Plain
/// paragraphs may continue across MarkdownParts nodes, whose whitespace is literal.
pub(crate) fn parsed_links(
    rendered: &Rendered,
    boundaries: &[(usize, &str)],
) -> Result<Vec<String>> {
    let text = &rendered.text;
    let mut unresolved = Vec::new();
    let mut callback = |link: BrokenLink<'_>| {
        unresolved.push(link.reference.to_string());
        None
    };
    let mut links = Vec::new();
    let mut html_ranges = Vec::new();
    for (event, range) in Parser::new_with_broken_link_callback(
        text,
        Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH,
        Some(&mut callback),
    )
    .into_offset_iter()
    {
        if matches!(
            &event,
            Event::Code(_)
                | Event::Start(
                    Tag::CodeBlock(_)
                        | Tag::HtmlBlock
                        | Tag::BlockQuote(_)
                        | Tag::List(_)
                        | Tag::Item
                        | Tag::Table(_)
                        | Tag::TableHead
                        | Tag::TableRow
                )
        ) && boundaries
            .iter()
            .any(|(boundary, _)| range.start < *boundary && *boundary < range.end)
        {
            return Err(format!(
                "Markdown block crosses a document block boundary at {range:?} ({event:?}){}; close fences and separate blocks explicitly",
                block_context(range.start, boundaries),
            ));
        }
        match event {
            Event::Start(Tag::Link { dest_url, .. } | Tag::Image { dest_url, .. }) => {
                links.push(dest_url.to_string())
            }
            Event::Html(_) | Event::InlineHtml(_) => {
                if (range.clone()).any(|position| {
                    !text.as_bytes()[position].is_ascii_whitespace()
                        && !rendered
                            .html
                            .iter()
                            .any(|allowed| allowed.contains(&position))
                }) {
                    return Err(format!(
                        "Raw HTML is unsupported in authored Markdown{} at {range:?}; use typed document blocks",
                        block_context(range.start, boundaries),
                    ));
                }
                html_ranges.push(range);
            }
            _ => {}
        }
    }
    if !unresolved.is_empty() {
        return Err(format!(
            "Unresolved Markdown references: {}",
            unresolved.join(", ")
        ));
    }
    if let Some(expected) = rendered.html.iter().find(|expected| {
        (*expected).clone().any(|position| {
            !text.as_bytes()[position].is_ascii_whitespace()
                && !html_ranges.iter().any(|actual| actual.contains(&position))
        })
    }) {
        return Err(format!(
            "Markdown swallowed a generated binding or block anchor{} at {expected:?}; typed HTML cannot be placed inside code or HTML syntax",
            block_context(expected.start, boundaries),
        ));
    }
    Ok(links)
}

fn block_context(position: usize, boundaries: &[(usize, &str)]) -> String {
    boundaries
        .iter()
        .rev()
        .find(|(start, _)| *start <= position)
        .map(|(_, id)| format!(" in block {id}"))
        .unwrap_or_default()
}

pub(crate) fn validate_markdown_parts(parts: &Prose) -> Result<()> {
    let template: String = parts
        .0
        .iter()
        .map(|part| match part {
            Inline::Text(text) => text.as_str(),
            _ => "EXECUTABLEDOCREFERENCE",
        })
        .collect();
    markdown_links(&template).map(|_| ())
}

pub(crate) fn escape(text: &str) -> String {
    let mut result = String::new();
    for c in text.chars() {
        match c {
            '&' => result.push_str("&amp;"),
            '<' => result.push_str("&lt;"),
            '>' => result.push_str("&gt;"),
            '\\' | '`' | '~' | '*' | '_' | '[' | ']' | '(' | ')' | '#' | '+' | '-' | '!' | '|'
            | '{' | '}' | '.' => {
                result.push('\\');
                result.push(c);
            }
            _ => result.push(c),
        }
    }
    result
}
