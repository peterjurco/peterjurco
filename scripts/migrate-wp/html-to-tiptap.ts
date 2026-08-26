import type {
  HTMLElement as ParsedHTMLElement,
  Node as ParsedNode,
} from 'node-html-parser'
import { NodeType, parse, TextNode } from 'node-html-parser'

/**
 * WordPress `wp_posts.post_content` HTML → ProseMirror JSON, in the exact
 * node/mark vocabulary the editor and SSR renderer share
 * (src/lib/articles/extensions.ts, src/lib/articles/render-doc.ts):
 * doc/paragraph/text/heading/blockquote/bulletList/orderedList/listItem/
 * hardBreak/image/videoEmbed/table/tableRow/tableCell/tableHeader nodes,
 * bold/italic/strike/link marks. Tags
 * outside that vocabulary never crash the conversion — they degrade to plain
 * paragraphs
 * (or are dropped, for non-content tags like <script>/<style>) so a messy
 * real-world WP export always produces a document the editor can open.
 *
 * Parser choice: `node-html-parser` — a small, dependency-light HTML parser
 * (no DOM/browser, works under plain Node) that's lenient with malformed
 * markup, which real WP exports are full of. Alternatives considered:
 * `linkedom`/`jsdom` build a full DOM (heavier, and jsdom is already avoided
 * elsewhere in this repo for the Workers runtime); `htmlparser2` is a lower
 * level SAX-style parser that would need a separate tree-builder on top.
 */

interface PMMark {
  type: string
  attrs?: Record<string, unknown>
}

interface PMNode {
  type: string
  attrs?: Record<string, unknown>
  content?: PMNode[]
  text?: string
  marks?: PMMark[]
}

export interface ProseMirrorDoc {
  type: 'doc'
  content: PMNode[]
}

const EMPTY_PARAGRAPH: PMNode = { type: 'paragraph', content: [] }
const EMPTY_DOC: ProseMirrorDoc = { type: 'doc', content: [EMPTY_PARAGRAPH] }

/**
 * Mirrors render-doc.ts's `isSafeUrl` (http(s)/mailto/relative only, never
 * `javascript:`/`data:`/etc). Not imported from there — it isn't exported,
 * and reaching into the app's private renderer internals from a standalone
 * migration script would be the wrong kind of coupling. Kept in lockstep by
 * the round-trip test below, which renders this converter's output through
 * the real `renderDoc`.
 */
function isSafeUrl(value: string | undefined): value is string {
  if (!value) return false
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matches render-doc.ts's isSafeUrl exactly
  const normalized = value.replace(/[\u0000-\u0020]/g, '')
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(normalized)
  if (!scheme?.[1]) return true // relative URL
  return ['http', 'https', 'mailto'].includes(scheme[1].toLowerCase())
}

/**
 * Recognized video hosts, matched against raw `<iframe src>`, `<video src>`
 * and Gutenberg's `wp-block-embed` bare-URL blocks (see `convertBlocks`).
 * Anything else — Komoot route maps, Spotify/Twitter embeds, etc. — keeps
 * degrading to the pre-existing "unknown tag" behavior below, unchanged.
 */
const YOUTUBE_ID_RE =
  /youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|v\/|shorts\/)([\w-]{11})|youtu\.be\/([\w-]{11})/i
const VIMEO_ID_RE = /vimeo\.com\/(?:video\/)?(\d+)/i

interface VideoEmbedAttrs {
  [key: string]: unknown
  provider: 'youtube' | 'vimeo'
  src: string
}

/** Normalizes a YouTube/Vimeo watch/share URL to its `videoEmbed` node attrs, or null for anything else. */
function videoEmbedFromUrl(url: string | undefined): VideoEmbedAttrs | null {
  if (!isSafeUrl(url)) return null
  const youtube = YOUTUBE_ID_RE.exec(url)
  const youtubeId = youtube?.[1] ?? youtube?.[2]
  if (youtubeId) {
    return {
      provider: 'youtube',
      src: `https://www.youtube.com/embed/${youtubeId}`,
    }
  }
  const vimeo = VIMEO_ID_RE.exec(url)
  if (vimeo?.[1]) {
    return {
      provider: 'vimeo',
      src: `https://player.vimeo.com/video/${vimeo[1]}`,
    }
  }
  return null
}

/** First `http(s)://…` substring in `text` — Gutenberg embed blocks store the bare oEmbed URL as their only text content. */
function firstUrlIn(text: string): string | undefined {
  return /https?:\/\/\S+/.exec(text)?.[0]
}

const MARK_TAGS: Record<string, string> = {
  strong: 'bold',
  b: 'bold',
  em: 'italic',
  i: 'italic',
  s: 'strike',
  strike: 'strike',
  del: 'strike',
}

/** Tags whose content should be flattened into the surrounding block flow. */
const CONTAINER_TAGS = new Set([
  'div',
  'section',
  'article',
  'main',
  'header',
  'footer',
  'figure',
  'figcaption',
  'body',
  'html',
])

/** Non-content tags dropped entirely, never surfaced as text. */
const DROPPED_TAGS = new Set(['script', 'style', 'noscript', 'template'])

function isElement(node: ParsedNode): node is ParsedHTMLElement {
  return node.nodeType === NodeType.ELEMENT_NODE
}

function tagNameOf(node: ParsedHTMLElement): string {
  return node.rawTagName?.toLowerCase() ?? ''
}

function addMark(marks: PMMark[], mark: PMMark): PMMark[] {
  // Nested identical tags (e.g. <strong><strong>) would otherwise duplicate
  // the mark — dedupe by type instead of emitting a redundant mark.
  return marks.some((existing) => existing.type === mark.type)
    ? marks
    : [...marks, mark]
}

/** Converts one HTML node (text or element) to zero or more inline PM nodes. */
function convertInline(node: ParsedNode, marks: PMMark[]): PMNode[] {
  if (node instanceof TextNode) {
    const text = node.text
    if (text.length === 0) return []
    return [{ type: 'text', text, ...(marks.length > 0 ? { marks } : {}) }]
  }
  if (!isElement(node)) return [] // comments etc.

  const tag = tagNameOf(node)

  if (tag === 'br') return [{ type: 'hardBreak' }]

  if (tag === 'img') {
    const src = node.getAttribute('src')
    if (!isSafeUrl(src)) return []
    const attrs: Record<string, unknown> = { src }
    const alt = node.getAttribute('alt')
    const title = node.getAttribute('title')
    if (alt !== undefined) attrs.alt = alt
    if (title !== undefined) attrs.title = title
    return [{ type: 'image', attrs }]
  }

  if (DROPPED_TAGS.has(tag)) return []

  const markType = MARK_TAGS[tag]
  if (markType) {
    const nextMarks = addMark(marks, { type: markType })
    return node.childNodes.flatMap((child) => convertInline(child, nextMarks))
  }

  if (tag === 'a') {
    const href = node.getAttribute('href')
    const nextMarks = isSafeUrl(href)
      ? addMark(marks, { type: 'link', attrs: { href } })
      : marks
    return node.childNodes.flatMap((child) => convertInline(child, nextMarks))
  }

  // Unknown inline-ish tag (span, code, sup, …): keep its text, drop the tag.
  return node.childNodes.flatMap((child) => convertInline(child, marks))
}

/** A cell's content model is "block+" — never zero blocks, even when empty. */
function convertTableCellContent(cell: ParsedHTMLElement): PMNode[] {
  const blocks = convertBlocks(cell.childNodes)
  return blocks.length > 0 ? blocks : [EMPTY_PARAGRAPH]
}

function convertTableRow(tr: ParsedHTMLElement): PMNode | null {
  const cells = tr.children
    .filter((child) => ['td', 'th'].includes(tagNameOf(child)))
    .map((cell) => ({
      type: tagNameOf(cell) === 'th' ? 'tableHeader' : 'tableCell',
      content: convertTableCellContent(cell),
    }))
  return cells.length > 0 ? { type: 'tableRow', content: cells } : null
}

/**
 * `querySelectorAll('tr')` finds rows regardless of whether they sit
 * directly under <table> or inside <thead>/<tbody>/<tfoot> — the real WP
 * dump always wraps in <tbody>, so this sidesteps needing to special-case
 * those wrapper tags the way CONTAINER_TAGS does for div/section/etc.
 */
function convertTable(table: ParsedHTMLElement): PMNode | null {
  const rows = table
    .querySelectorAll('tr')
    .map((tr) => convertTableRow(tr))
    .filter((row): row is PMNode => row !== null)
  return rows.length > 0 ? { type: 'table', content: rows } : null
}

function convertListItem(li: ParsedHTMLElement): PMNode {
  const blocks = convertBlocks(li.childNodes)
  // listItem's content model is "paragraph block*" — it must start with a
  // paragraph, even when the source <li> only ever held a nested list.
  if (blocks.length === 0)
    return { type: 'listItem', content: [EMPTY_PARAGRAPH] }
  if (blocks[0]?.type !== 'paragraph') {
    return { type: 'listItem', content: [EMPTY_PARAGRAPH, ...blocks] }
  }
  return { type: 'listItem', content: blocks }
}

/** Converts a run of sibling HTML nodes into block-level PM nodes. */
function convertBlocks(nodes: ParsedNode[]): PMNode[] {
  const result: PMNode[] = []
  let inlineBuffer: ParsedNode[] = []

  const flushBuffer = () => {
    if (inlineBuffer.length === 0) return
    const content = inlineBuffer.flatMap((node) => convertInline(node, []))
    inlineBuffer = []
    if (content.length > 0) result.push({ type: 'paragraph', content })
  }

  for (const node of nodes) {
    if (node instanceof TextNode) {
      if (node.text.trim().length === 0) continue // whitespace between tags
      inlineBuffer.push(node)
      continue
    }
    if (!isElement(node)) continue // comments etc.

    const tag = tagNameOf(node)

    if (tag === 'p') {
      flushBuffer()
      const content = node.childNodes.flatMap((child) =>
        convertInline(child, []),
      )
      result.push({ type: 'paragraph', content })
      continue
    }

    const headingLevel = /^h([1-6])$/.exec(tag)?.[1]
    if (headingLevel) {
      flushBuffer()
      const content = node.childNodes.flatMap((child) =>
        convertInline(child, []),
      )
      if (content.length > 0) {
        result.push({
          type: 'heading',
          attrs: { level: Number(headingLevel) },
          content,
        })
      }
      continue
    }

    if (tag === 'blockquote') {
      flushBuffer()
      const inner = convertBlocks(node.childNodes)
      result.push({
        type: 'blockquote',
        content: inner.length > 0 ? inner : [EMPTY_PARAGRAPH],
      })
      continue
    }

    if (tag === 'ul' || tag === 'ol') {
      flushBuffer()
      const items = node.children
        .filter((child) => tagNameOf(child) === 'li')
        .map((li) => convertListItem(li))
      if (items.length > 0) {
        result.push({
          type: tag === 'ul' ? 'bulletList' : 'orderedList',
          content: items,
        })
      }
      continue
    }

    if (tag === 'img') {
      // Bare <img> outside a <p> — image is an inline node, so it still
      // needs a paragraph wrapper to be valid block content.
      flushBuffer()
      const inline = convertInline(node, [])
      if (inline.length > 0) result.push({ type: 'paragraph', content: inline })
      continue
    }

    if (tag === 'video') {
      // Self-hosted WP video (wp-block-video) — src rehosted to R2 by
      // import.ts, same pass as inline images.
      flushBuffer()
      const source =
        node.getAttribute('src') ??
        node.querySelector('source')?.getAttribute('src')
      if (isSafeUrl(source)) {
        result.push({
          type: 'videoEmbed',
          attrs: { provider: 'file', src: source },
        })
      }
      continue
    }

    if (tag === 'table') {
      flushBuffer()
      const converted = convertTable(node)
      if (converted) result.push(converted)
      continue
    }

    if (tag === 'iframe') {
      flushBuffer()
      const embed = videoEmbedFromUrl(node.getAttribute('src'))
      if (embed) {
        result.push({ type: 'videoEmbed', attrs: embed })
      } else {
        // Not a recognized video provider (Komoot route maps, etc.) — same
        // degrade-to-child-text behavior as any other unsupported tag.
        for (const child of node.childNodes) {
          result.push(...convertBlocks([child]))
        }
      }
      continue
    }

    // Inline-level tags (links, bold/italic/strike) reach here when they sit
    // directly inside a flattened container instead of a <p> — the real WP
    // dump does this for <figcaption><a>…</a></figcaption> image credits.
    // Buffering them like a text node (rather than falling to the generic
    // "unknown block tag" case below) routes them through convertInline, so
    // the mark survives instead of being silently dropped.
    if (tag === 'a' || MARK_TAGS[tag]) {
      inlineBuffer.push(node)
      continue
    }

    if (tag === 'figure') {
      // Gutenberg's embed block stores just the bare oEmbed URL as text
      // (WP resolves it to a real iframe at WP render time, never in
      // post_content) — recognized providers get a real videoEmbed node
      // instead of falling through to the plain-text paragraph below.
      const classAttr = node.getAttribute('class') ?? ''
      const isVideoEmbedBlock =
        classAttr.includes('wp-block-embed') &&
        (classAttr.includes('is-provider-youtube') ||
          classAttr.includes('is-provider-vimeo') ||
          classAttr.includes('is-type-video'))
      const embed = isVideoEmbedBlock
        ? videoEmbedFromUrl(firstUrlIn(node.text))
        : null
      if (embed) {
        flushBuffer()
        result.push({ type: 'videoEmbed', attrs: embed })
        continue
      }
    }

    if (CONTAINER_TAGS.has(tag)) {
      flushBuffer()
      result.push(...convertBlocks(node.childNodes))
      continue
    }

    if (DROPPED_TAGS.has(tag)) continue

    // Unknown/unsupported block tag (table, iframe, form, …): degrade to a
    // plain paragraph per element that actually has text, never crash.
    flushBuffer()
    for (const child of node.childNodes) {
      result.push(...convertBlocks([child]))
    }
  }

  flushBuffer()
  return result
}

/**
 * Converts WP post HTML into a ProseMirror document valid against the
 * article editor's schema. Never throws — malformed/unexpected input falls
 * back to an empty-paragraph doc rather than aborting a migration run.
 */
export function htmlToTiptap(html: string): ProseMirrorDoc {
  if (typeof html !== 'string' || html.trim().length === 0) return EMPTY_DOC
  try {
    const root = parse(html)
    const content = convertBlocks(root.childNodes)
    return {
      type: 'doc',
      content: content.length > 0 ? content : [EMPTY_PARAGRAPH],
    }
  } catch (error) {
    console.error('htmlToTiptap failed, falling back to an empty doc:', error)
    return EMPTY_DOC
  }
}
