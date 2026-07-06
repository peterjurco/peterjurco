import type { Extensions } from '@tiptap/core'
import { Image } from '@tiptap/extension-image'
import { Color, FontFamily, TextStyle } from '@tiptap/extension-text-style'
import { StarterKit } from '@tiptap/starter-kit'

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
    TextStyle,
    Color,
    FontFamily,
  ]
}
