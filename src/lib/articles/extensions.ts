import type { Extensions } from '@tiptap/core'
import { Node } from '@tiptap/core'
import { Image } from '@tiptap/extension-image'
import { Color, FontFamily, TextStyle } from '@tiptap/extension-text-style'
import { StarterKit } from '@tiptap/starter-kit'

/**
 * A hosted-video embed (YouTube/Vimeo `<iframe>`) or a self-hosted clip
 * (`<video>`), produced by the WP importer (scripts/migrate-wp/html-to-tiptap.ts)
 * — no editor UI inserts one today. Atom + no content model: it's rendered
 * whole from `attrs`, never edited in place. `render-doc.ts`'s sanitizer
 * re-validates `provider`/`src` before this ever runs, so `renderHTML` here
 * trusts its input.
 */
export const VideoEmbed = Node.create({
  name: 'videoEmbed',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      provider: { default: 'youtube' },
      src: { default: null },
      title: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-video-embed]' }]
  },

  renderHTML({ node }) {
    const { provider, src, title } = node.attrs as {
      provider: string
      src: string
      title: string | null
    }
    if (provider === 'file') {
      return ['video', { src, controls: 'controls' }]
    }
    return [
      'div',
      { 'data-video-embed': provider, class: 'video-embed' },
      [
        'iframe',
        {
          src,
          title: title ?? 'Embedded video',
          loading: 'lazy',
          allow:
            'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
          allowfullscreen: 'true',
          referrerpolicy: 'strict-origin-when-cross-origin',
        },
      ],
    ]
  },
})

/**
 * The single document schema shared by the editor island
 * (src/components/ArticleEditor.tsx) and the SSR renderer (render-doc.ts) —
 * one definition so stored JSON and rendered HTML can never drift apart.
 *
 * StarterKit (v3) covers headings, blockquote, bold/italic/strike, lists and
 * links; list indentation is TipTap's native list nesting
 * (sinkListItem/liftListItem). Color + FontFamily ride on the textStyle mark.
 */
export function documentExtensions(): Extensions {
  return [
    StarterKit.configure({
      link: {
        // Public read pages render this HTML verbatim — new tab + no opener.
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
        openOnClick: false,
      },
    }),
    Image,
    VideoEmbed,
    TextStyle,
    Color,
    FontFamily,
  ]
}
