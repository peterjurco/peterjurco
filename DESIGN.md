# peterjur.co — Public Page Design

Visual language for the public (unauthenticated) homepage, locked 2026-07-06
after an interactive design session. Reference mockup (full CSS/markup):
`design/public-homepage-directions.html` (Artifact:
https://claude.ai/code/artifact/b3f91443-3d57-4112-8b69-e9a535026eec).

## Concept

A quiet, warm **poster wall**. A faded-ochre ground makes the owner's cold,
cinematic, muted photographs sit like prints. Character comes from **tilted
quote tiles** (one styled as a cinema marquee) breaking an otherwise calm
field of large photo tiles — provocative, not conventional. No menu, no
subpages.

## Palette

| Token | Hex | Role |
| --- | --- | --- |
| `--ground` | `#c9a23c` | faded-ochre page ground (the poster wall) |
| `--ink` | `#17140f` | near-black text / dark quote tile |
| `--accent` | `#b23a26` | oxblood/marquee red — used sparingly |
| `--cream` | `#f0e7d3` | marquee-quote lightbox |

Photo grades in the mock are placeholder gradients sampled from the owner's
real set (Nordic red house + snow + teal sky, the Lada road, grazing horses,
brutalist steps, the "Neues Off" marquee). Real photos replace them.

## Type

- **Unbounded** (variable, 100–900) — display: masthead logo, headings.
  Uppercase, tight tracking, weight ~800.
- **Big Shoulders Display** (variable) — quote voice (marquee + ink quote).
  Condensed, uppercase for the marquee.
- System sans — tiny labels, footer, per-tile captions.
- Fonts are embedded as **@font-face data-URIs** (Artifact CSP blocks font
  CDNs; the real site can load them normally but self-hosting is fine too).

## Layout

- Masthead: "Peter Jurčo" (single title — no competing in-grid headline) +
  small right-aligned meta.
- Body: **freeform canvas** of large tiles (photos + quotes). The mock uses a
  dense grid to preview it; the real page is absolute-positioned per the
  `home_tiles` layout data (size/position/rotation/border per tile).
- Footer: social links — Instagram, LinkedIn, Goodreads, Last.fm, Strava,
  GitHub, Email.

## Motion

- **Hover — "Develop" (chosen):** photos rest quietly muted
  (`filter: saturate(.74) contrast(.94) brightness(.98)`); on hover the single
  photo slowly (~1s ease) comes to full life
  (`saturate(1.08) contrast(1.04) brightness(1.03)`). **Filter only — no
  transform, no shapes, no click-cue.** Exact curve to be fine-tuned once real
  photos are in. (Two alternates — "Warm wash", "Cool fade" — were explored and
  set aside; the switcher in the mock is review scaffolding, not a site feature.)
- **Tilted quotes:** the rotation *is* the statement; hover only gently steadies
  the tilt (e.g. −1.6° → −0.6°). Marquee quote has faint lightbox slat-lines.
- **Cycling:** some tiles slowly crossfade between photos (~1.6s), on a ~5s
  interval. Subtle — explicitly *not* a flip/flash. Grouped via
  `home_tiles.cycle_group`.
- Respect `prefers-reduced-motion` (mock disables transitions/cycling under it).

## Rejected directions (do not revisit)

- **Console/contact-sheet** aesthetic (mono type, catalog codes) — reads as a
  programmer's site; not wanted.
- **Poster hover** with scale + geometric stamp — felt like a link, urged
  clicking.
- **Flip** cycling animation — disliked.
- **Soft/editorial "gallery wall"** — too feminine, read as wedding/baby
  photography.
