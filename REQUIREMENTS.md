# peterjur.co — Requirements

> Living document. Sections are added incrementally. Only light text/formatting edits applied to the author's wording.

## Public section (visible to unauthorized users)

- **Design should be non-trivial and very specific** — in the spirit of a music artist's page: unique and distinctive, not "just another website". (Exact direction TBD in a dedicated design session.)
- **Contains only specific photos, curated by me**, easily changeable in the admin.
- Photos display as **tiles**, with some spacing between them — but not large.
- **Not a strict grid** with precise columns/rows — rather **differently sized tiles** packed together so they fill the space.
- **Admin edit model (confirmed):** a **freeform canvas editor** (Canva/Photoshop-style), not an auto-packed grid. Per block I can adjust: **size, position, rotation, border, and hover effect**. Applies to photo tiles and text/quote tiles alike.
- **Subtle hover effect** when the mouse moves over a photo (slight, not flashy).
- Can also include **text blocks** — e.g. selected quotes.
- I'll host a **separate brainstorming / design session** to figure out the design direction.
- Length: **10 to 50 photos**, possibly with some tiles **cycling through photos every few seconds** (just an idea).
- Include **logo, contact information**, and possibly **links to my socials**.
- **No menu or public subpages for now.**

## Authenticated section (private — only me)

- After signing in, stay signed in **indefinitely on that device**.
- Sign in via **Google auth**.
- **Google must not have any access to the site's content** (auth for identity only).
- **Totally different layout** from the public section — no complex design needed; **more functional than pretty**.
- Has a **menu**.
- Has **search** (potentially complex — define it when we get to it).

### Authenticated homepage

- **Featured articles** — a handpicked list I curate; the ones I return to often and want kept on top.
- **Recent articles**.
- **Google Photos hub widget** — a list of all my Google Photos hubs (I'll have several, e.g. analogue photos, family photos, etc.).
- **My apps** — a list of my apps with links to them.

## Articles / writing

**Editing model**
- Like Google Docs: articles are **always in edit mode**, but also very easy to just **read**.
- Not editable **only** when permissions don't allow it (e.g. when shared with someone else).
- In read-only mode, **hide the toolbars / editing chrome** — show only the document itself.
- The editor should be **mobile friendly**.
- Minimum editor features: **section subtitles/headings, quotes, text transformations** (bold, italics, strikethrough, …), **text color, font families, lists, indentation, links, and images inside the article**.

**Metadata & organization**
- Every article has a **category** and **tags** (as on my current WP site).
- Every **category and every tag has its own page** listing all articles with that category/tag.
- Article can have a **featured photo**, but doesn't have to.
- Records **created** and **last-edited** timestamps. **No revision history needed.**

**Visibility & sharing**
- **Private by default**, can be switched to **public**.
- Public articles are **not listed anywhere** (for now) but are **accessible via link**.
- URLs **don't need to be pretty** — plain IDs in the URL are fine.
- When shared, links must produce **correct preview cards** (title etc.) in social/chat environments (Twitter, Slack, Facebook, Messenger, …).

## Sharing with friends

- Not a separate section. Handled by the **unified visibility model** — sharing
  with friends = a **public-by-link** resource (article, or a public-tagged photo
  page) that's reachable without authentication. See TECH_DECISIONS §9.

## Google Photos album hub

- Works **similarly to articles**: I add a **Google Photos album link** and give it **taxonomy (tags)**.
- When adding an album I also set a **cover photo** and a **name** — nice if these can be pulled automatically from Google Photos, but **manual entry is fine** if not.
- **Authenticated pages:**
  - A page listing **all albums**.
  - A page **per tag** showing all albums with that tag.
- **Public sharing via tags:** I can **mark some tags as public** (e.g. `family`). A public tag's page — the list of all albums with that tag — is then **shareable and viewable without authentication**.

## Analytics

- Want **usage stats** — probably **Google Analytics** (TBD).

## Admin

- **No design/visual customization through the admin** — visual changes are done via AI agents (code) when needed.
- Edit **categories and tags**.
- **Database backups on this site.** (Today WP backs the DB up to my Google Drive via a plugin; I want DB backups here too.)

## Migration

- I can provide a **DB dump** from the current WordPress site.
- We'll likely need a **migration script** to import existing content (articles, categories, tags, …) into the new schema.
