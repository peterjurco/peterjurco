/**
 * Google-Docs-style heading sections, shared by the editor plugin
 * (collapsible-headings.ts) and the public read page's DOM script
 * (collapsible-headings-dom.ts) so both agree on what a heading "owns".
 *
 * A heading's section runs from the block after it up to (not including) the
 * next heading of the same or a higher level — so an H2 owns its paragraphs
 * and any nested H3s, but not the following H2.
 */

/**
 * `levels[i]` is block i's heading level (1–6), or null for a non-heading.
 * Returns, for every heading index, the exclusive end index of its section.
 */
export function sectionEnds(levels: (number | null)[]): Map<number, number> {
  const ends = new Map<number, number>()
  const open: { index: number; level: number }[] = []
  levels.forEach((level, index) => {
    if (level === null) return
    while (open.length > 0 && open[open.length - 1].level >= level) {
      const closed = open.pop()
      if (closed) ends.set(closed.index, index)
    }
    open.push({ index, level })
  })
  for (const { index } of open) ends.set(index, levels.length)
  return ends
}

/**
 * Which blocks are hidden given the set of collapsed heading indexes: any
 * block inside a collapsed heading's section (the heading itself stays
 * visible). A collapsed parent keeps hiding a nested heading's section
 * whether or not that nested heading is itself collapsed.
 */
export function hiddenBlocks(
  levels: (number | null)[],
  collapsed: ReadonlySet<number>,
): boolean[] {
  const ends = sectionEnds(levels)
  const hidden: boolean[] = levels.map(() => false)
  for (const index of collapsed) {
    const end = ends.get(index)
    if (end === undefined) continue
    for (let i = index + 1; i < end; i++) hidden[i] = true
  }
  return hidden
}
