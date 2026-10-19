---
name: "Kael"
description: "A personal picture of cinema, framed in ink blue and gold."
colors:
  bg: "#edf1f3"
  surface: "#f9fafb"
  surface-2: "#e2e8ed"
  text: "#142e43"
  muted: "#526574"
  line: "#d2dce3"
  line-2: "#a8bac7"
  accent: "#eac55c"
  accent-2: "#f4d883"
  ink: "#102c43"
  ink-soft: "#193b55"
  love: "#a54461"
  like: "#24714f"
  meh: "#586a79"
  nope: "#a64136"
  white: "#ffffff"
  focus: "#337ab0"
  primary-hover: "#234d6a"
  nav-muted: "#b9cbd8"
typography:
  display:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "52px"
    fontWeight: 550
    lineHeight: 1.04
    letterSpacing: "-.03em"
  headline:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "40px"
    fontWeight: 550
    lineHeight: 1.15
    letterSpacing: "-.025em"
  film-title:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "34px"
    fontWeight: 550
    lineHeight: 1.06
    letterSpacing: "-.025em"
  title:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "27px"
    fontWeight: 550
    lineHeight: 1.2
    letterSpacing: "normal"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "normal"
  metadata:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  badge:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: ".04em"
rounded:
  poster: "3px"
  frame: "4px"
  control: "5px"
  toast: "6px"
  dialog: "12px"
  circle: "50%"
spacing:
  "4": "4px"
  "8": "8px"
  "10": "10px"
  "12": "12px"
  "14": "14px"
  "16": "16px"
  "18": "18px"
  "20": "20px"
  "24": "24px"
  "28": "28px"
  "30": "30px"
  "32": "32px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.white}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-accent:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  button-accent-hover:
    backgroundColor: "{colors.accent-2}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-2}"
  input-search:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "15px 18px"
    width: "100%"
  option:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.metadata}"
    rounded: "{rounded.control}"
    padding: "10px 15px"
  option-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.white}"
  navigation:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.nav-muted}"
    height: "88px"
  title-frame:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.white}"
    rounded: "{rounded.frame}"
  poster-tile:
    textColor: "{colors.text}"
    width: "160px"
  rating-control:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "8px 1px"
  dialog:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text}"
    rounded: "{rounded.dialog}"
    padding: "30px"
---

# Design System: Kael

## Overview

**Creative North Star: "Title sequence"**

Kael takes its visual character from a film title sequence: custom KAEL lettering, ink blue frames, a single gold emphasis, expressive film titles, and real film artwork. Cool pale working surfaces give ratings, metadata, search, and personal history room to remain legible. The identity belongs to the films and the viewer’s relationship to them.

Fraunces is the existing locally hosted display family, deliberately retained with its SIL Open Font License. System sans-serif handles controls and factual detail. Recommendations pair a film with the actual explanation produced from the viewer’s ratings; visual framing must never imply a fabricated critic’s verdict.

**Key Characteristics:**
- A geometric KAEL wordmark and split K identify the app; real film art and serif titles identify its content.
- Ink blue frames and gold actions provide hierarchy.
- Open sections, thin rules, and compact metadata support repeated work.
- Touch, keyboard, and reduced-motion behavior are part of the component contract.

This document records the implemented system in `web/app.css`, `web/index.html`, and generated components in `web/app.js`. `PRODUCT.md` carries product truth; `.impeccable/direction.md` carries the direction study. The frontmatter owns reusable visual tokens. The sidecar adds previews, shadows, motion, responsive behavior, and narrative; it does not redefine token primitives.

## Colors

The palette combines a cool reading ground, deep cinema-blue framing, and restrained yellow-gold emphasis.

### Primary

- **Title gold** (`accent`): primary actions inside the featured-film and welcome frames, active navigation underlines, loading progress, and selection marks.
- **Pale title gold** (`accent-2`): gold-action hover, match percentages, text selection, and the active mobile navigation label.

### Secondary

- **Cinema ink** (`ink`): masthead, navigation, featured film, welcome panel, ordinary primary buttons, selected filters, and toast.
- **Soft cinema ink** (`ink-soft`): dark poster fallback and loading-button hover.
- **Lifted ink** (`primary-hover`): hover state for primary buttons on the pale working surface.

### Tertiary

- **Loved** (`love`), **liked** (`like`), **neutral opinion** (`meh`), and **disliked/error** (`nope`): rating icons, selected ratings, personal-history marks, and error or destructive-action text. Labels and icons accompany color. The liked color also identifies the viewer’s streaming services.

### Neutral

- **Cool reading ground** (`bg`): page and dialog foundation.
- **Light field** (`surface`): text inputs, rating controls, and service selections.
- **Tonal field** (`surface-2`): secondary hover, artwork fallback, badges, and chart tracks.
- **Reading ink** (`text`) and **secondary ink** (`muted`): primary content and supporting metadata.
- **Quiet rule** (`line`) and **control rule** (`line-2`): repeated row dividers and more visible control borders.
- **White** (`white`) and **muted navigation** (`nav-muted`): text on ink surfaces.
- **Focus blue** (`focus`): the keyboard focus outline and file-control focus-within outline.

**The Film and Reason Rule.** Present the film title, artwork, and model-derived reason as related information. Preserve readable titles while artwork loads or is unavailable.

**The Gold Emphasis Rule.** Use gold for the primary action on an ink surface, the active navigation marker, match emphasis, and selected artwork markers. Keep ordinary working-surface buttons ink blue.

Color aliases that are unused in the rendered interface are not promoted into new tokens. In particular, `surface-solid`, `glass`, and `seen` remain source declarations, not additional design roles. The existing `accent-ink` alias resolves to the reading-ink value. Sidecar tonal ramps are derived preview aids, not additional shipped color tokens.

## Typography

**Display font:** Fraunces, Georgia, serif. The normal variable font is locally supplied in Latin and Latin-extended WOFF2 files, with weights from 100–900, `font-display: swap`, and `web/fonts/OFL.txt`.

**Body and label font:** the platform sans-serif stack in the frontmatter. There is no separate monospaced interface family; keyboard hints inherit the surrounding text face.

The contrast is expressive titles beside compact, factual controls. Most headings use weight 550; controls use 600. Film and page headings balance wrapping, with slightly tightened tracking. Do not infer a mathematical type scale from these role-specific sizes.

| Role | Implemented use and responsive adjustment |
| --- | --- |
| Display | Welcome heading; 52px desktop becomes 39px at 760px and below, with line-height 1.08. |
| Headline | Page heading; 40px desktop becomes 32px on mobile. |
| Film title | Featured recommendation; 34px desktop, 31px at 761–1100px, 26px on mobile, and 25px below 360px. |
| Title | Shelf and panel headings; shelves become 24px and panels 25px on mobile. |
| Body | Default reading text; long film overviews use line-height 1.8 and a maximum width of 70ch. |
| Label | Primary and secondary actions; compact contexts use 12–13px while preserving the hit area. |
| Metadata | General supporting information; mobile film metadata and row descriptions use 11–12px. |
| Badge | Compact status labels; uppercase, with the tracked label role in the frontmatter. |

Additional intentional title roles are the desktop rating title (44px, weight 550), film-detail title (42px; 30px mobile), and dialog heading (30px; 28px mobile). The KAEL wordmark is custom path artwork, not a typography role. Counts and match values use tabular numerals. Fine print reaches 75ch; panel prose reaches 70ch.

**The Title and Task Rule.** Use Fraunces for film titles and editorial headings; use the system sans-serif for controls, dates, counts, and supporting metadata. Keep the locally hosted font and its license together.

## Layout

Desktop content follows a centered 1220px field, expressed as `max(32px, calc((100vw - 1220px) / 2))` outer gutters. The fixed masthead is 88px high; main destinations sit in the masthead. Each active view owns its scroll area. Search, Library, Your taste, and Settings cap their direct content at 980px. Film detail caps its body at 900px.

The featured recommendation uses a 260px poster column beside flexible explanatory text. Its neighboring Tonight/taste section is 260px wide, separated by a 30px gap. The desktop rating layout uses a 360px poster, a 70px gap, and a maximum width of 1000px. These are surface compositions, not mandatory layouts for every new screen.

The spacing vocabulary is a practical set of repeated 4–32px values, not a strict eight-point grid. Controls commonly pair 8px internal gaps with 10px by 16px padding. Open panels use 28px vertical padding; shelves begin after 42px, then a rule and 20px top inset. Poster shelves use 160px tiles and 20px gaps; libraries use five columns and the wall uses six columns.

| Condition | Implemented behavior |
| --- | --- |
| 761–1100px | Hide the brand note; reduce navigation spacing. Stack the home feature above a two-column aside. Feature poster becomes 240px; rating poster becomes 300px with a 35px gap; wall uses four columns. |
| 760px and below | Masthead is 64px plus top safe area. Move five navigation destinations to a 65px bottom bar plus bottom safe area. Use 20px gutters; view content ends above navigation. |
| Mobile feature | Use a 110px poster beside title/metadata, then span the explanation and actions across the full width. Shelves use 132px tiles and 14px gaps. |
| Mobile rating | Use a centered, scrollable stage, at most 280px wide; height is viewport-derived, bounded by 220px and 470px. Put the title over a protective image shade and place six opinion/action controls below. The stage intentionally uses a viewport-shaped poster frame rather than the usual 2:3 ratio. |
| Mobile collections | Library and wall use three columns; genre browse uses two. Open panels remain open sections. |
| Mobile dialog | Anchor to the bottom edge, allow 92dvh of height, round only the two top corners, and include bottom safe-area padding. |
| Below 360px | Gutters become 16px; feature poster becomes 90px and inner padding 14px; hide the brand note. |
| Desktop height at most 720px | Reduce rating poster to 290px, gap to 45px, and surrounding vertical spacing. |

The interface uses native document zoom. Horizontal shelves scroll within their own region and use proximity snapping; they do not displace the page viewport.

On mobile Home Screen launches, the `html` and `body` roots, navigation, view content, and full-screen overlays share an explicit height measured from the top. Size both roots explicitly: percentage root heights can clip the controls even when the navigation itself has the correct bounds. Use the smaller of `100vh` and `100dvh` plus the top safe area, with `100vh` as the older-browser fallback; keep bottom safe-area padding inside the bar. Browser tabs retain their existing bottom anchoring.

## Elevation & Depth

Ordinary surfaces remain flat, separated through background tone and single-pixel rules. There is no global backdrop blur. Poster depth, modal protection, and transient feedback are the deliberate exceptions. Dark image gradients protect overlaid film text; they are not a general decoration for controls.

- **Rating poster:** `0 12px 28px #00000020`.
- **Film-detail poster:** `0 9px 24px #00000020`.
- **Dialog:** `0 18px 60px #00000044`, above a `#071c30a8` scrim.
- **Toast:** `0 8px 28px #00000030`.

**The Quiet Surface Rule.** Use tonal separation and thin rules for ordinary sections. Reserve shadows for floating feedback, protected dialogs, and selected poster presentations.

## Shapes

Small, nearly square corners are the default: poster frames and compact badges use the poster radius; feature frames use the frame radius; buttons, fields, and service choices use the control radius. Dialogs use the larger dialog radius, while toasts use the toast radius. Circular silhouettes belong to icon-only controls, status dots, and selection marks. Rounded pills are not the general control language, regardless of legacy CSS class names.

Use one-pixel borders for ordinary controls and dividers. Selected service tiles increase to a two-pixel border while reducing padding to retain their size. A selected wall poster has a three-pixel inset outline plus a visible check. Poster shelves, grids, and featured art keep the 2:3 film-poster frame; film stills and the mobile rating stage use their explicit contextual crops.

## Components

### Wordmark and app mark

The uppercase KAEL wordmark uses custom geometric paths on a 490 × 128 drawing field. The separated stem and diagonals of its K suggest a film splice. Wide, definite lettering gives the app a recognizable title card while leaving Fraunces to the films and editorial headings. The K is title gold (`#eac55c`); AEL is cream (`#f7f6ee`), shown on cinema ink (`#102c43`). Use the supplied paths and their proportions. Do not reconstruct the logo with a font, close the K’s open joins, add a period, or apply gradients, glows, or drop shadows to the mark.

The masthead wordmark is 118px wide on desktop and 100px at 760px and below; the loading wordmark is 216px wide. Height follows the artwork’s aspect ratio. The home button retains a 44px minimum height, the accessible name “Kael home,” an empty decorative image alternative, an 80% opacity hover, and a gold keyboard focus outline. The loading image has the alternative “Kael.” The mark adds no independent animation.

Install icons use only the gold K on a full-bleed navy square. On the 512px source field, the K is 300px high and its outer corners remain inside the central 80% safe circle, so circular and rounded masks retain the complete letter. Keep this safe area when exporting the 192px, 512px, and 180px Apple touch assets. The favicon has its own larger optical size: a 128px-high K within a 160px square, exported as SVG and a 32px PNG. Use that favicon artwork for browser tabs rather than shrinking the more generously inset install icon.

`web/brand.js` owns the color values and path geometry. Its `drawWordmark` function renders the same artwork directly to the taste-card canvas, without font loading or a separate raster logo. `scripts/brand-assets.mjs` generates the committed wordmark SVG, app-mark SVG, favicons, install PNGs, and 1200 × 630 social artwork from that source. Run `node scripts/brand-assets.mjs` with the development-only `sharp` package available, or pass its absolute entry-point path as the first argument. The shipped app does not depend on `sharp`. Preserve the wordmark source, generated assets, and asset references together when updating the identity.

### Buttons

Quiet, definite controls. Primary buttons use ink on the working surface; primary actions inside dark recommendation/welcome frames use gold. Secondary buttons are transparent with a control-rule border. Their shared base is the control radius, 10px by 16px padding, 14px weight-600 text, and a 44px minimum height. Icon-only controls use a 44px square circular hit area, with 18–22px SVG artwork.

Primary hover uses lifted ink; secondary hover uses the tonal field; gold hover uses pale title gold. All buttons transition background, text color, and opacity over 160ms with CSS’s default `ease`. Pressed buttons use opacity 0.78; disabled buttons use opacity 0.45 and a non-interactive cursor. The declared source `--ease` custom property is currently unused and is not a motion token.

### Inputs and options

Search is a full-width light field, with a 56px minimum height, 15px by 18px inset, control radius, and control-rule border. Ordinary date/select fields have a 44px minimum height and 11px by 13px inset. Placeholder text uses secondary ink at full opacity. Errors appear adjacent to the field in the error/status color. File inputs retain a visible outline around their parent when focused.

Filter options use the same border/radius grammar with 10px by 15px inset and a 44px minimum height. Selected options become ink with white text and expose `aria-pressed`. Library tabs use `aria-selected`, a three-pixel underline, and a 48px minimum height; arrow keys plus Home and End move between them.

### Navigation

Desktop destinations sit in the ink masthead with icons beside 14px labels. The active destination is white with a gold underline. On mobile, five equal bottom destinations place 20px icons over 11px labels; the active label becomes pale gold. The selected destination exposes `aria-current="page"`. Keep visible labels in both arrangements.

### Film title frame and poster collection

The signature title frame combines real art, a Fraunces film title, compact factual metadata, the model’s match estimate, and a personal reason. The explanation uses a quiet separator and highlights cited film titles. Action labels remain visible. The layout changes at the documented breakpoints without dropping the recommendation reason.

Poster tiles use real 2:3 art, a readable title below, and supporting metadata. Hover underlines the title instead of lifting the entire tile. Missing art remains an explicit “Artwork unavailable” field; title text is not replaced by the image. Inside the dark feature frame its label uses the light caption color (`#c3d3de`). The sidecar preview uses this actual fallback to remain self-contained, rather than inventing film artwork or a personal prediction.

### Rating controls

The six-control opinion row keeps distinct inline SVG icons and visible labels. Opinion color appears in the icon; text remains readable in the normal foreground color. Controls are at least 70px high on desktop and 63px on mobile. Keyboard actions remain 1–4 for opinions, S for unseen, W for save, and Z for undo. The next image is prepared behind the current one; a rating fades the outgoing card over 180ms. Poster loading also uses a 180ms opacity transition.

### Dialogs and feedback

Dialogs have solid reading-ground surfaces, a 590px maximum width, 30px desktop inset, and a 44px close control. They use the dialog shadow and scrim. Focus enters the dialog container, Tab stays within the topmost dialog, background navigation/content becomes inert, Escape dismisses the active dialog, and focus returns to the originating control. Redrawn option groups preserve the focused selection when possible. Film detail follows the same protected-focus behavior.

A toast uses the ink surface, white message, and gold action. It clears the bottom navigation on mobile. Film-still reveal and loading dismissal use 200ms opacity transitions. Under `prefers-reduced-motion: reduce`, all animation and transition are disabled and scrolling uses `auto`.

### Accessibility contract

The shared keyboard treatment is a three-pixel focus-blue outline with a four-pixel offset and small corner rounding. Do not remove it from interactive controls. The masthead brand uses a gold focus outline on its navy background. Dialog containers suppress their own decorative outline after programmatic focus while their child controls retain visible focus. Labels, SVG icons, selected borders, and semantic states accompany color. New standalone controls should follow the 44px target convention. The compact rating choices below 360px retain a 38px minimum width within the dense repeated row; their height remains 44px. This specific density compromise does not establish a smaller general target token. Toast actions, the mobile picks action, and diary title buttons use a 44px minimum height.

## Do's and Don'ts

### Do:

- Do pair real film artwork with readable titles and actual recommendation explanations.
- Do reuse the ink, accent, surface, and status tokens rather than introduce a new decorative palette.
- Do preserve 2:3 poster frames in shelves, grids, and the featured recommendation; apply the explicit mobile rating exception only in the rating stage.
- Do retain visible keyboard focus, semantic selected states, protected dialog focus, and reduced-motion behavior.
- Do make new standalone controls at least 44px high and icon controls at least 44px by 44px.
- Do use open sections and rules for settings and personal history.
- Do generate logo assets from `web/brand.js` and preserve the split K, aspect ratio, and icon safe area.

### Don't:

- Don’t invent reviews, critic endorsements, user statistics, or model explanations to fill the layout.
- Don’t replace the locally hosted Fraunces title face with a system display face.
- Don’t turn every section into a rounded, shadowed card.
- Don’t remove visible text labels or rely on rating color alone.
- Don’t infer a universal ban on gradients: the mobile rating caption and film-detail still use protective image shading.
- Don’t propagate documented target-size exceptions as new component defaults.
- Don’t recreate KAEL with a font, close the K’s open joins, or add gradients or shadows to the logo.
