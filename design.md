# FICAP — Design Language

> Derived from the supplied reference (a dental-clinic site): **its craft, not its content.**
> No clinic imagery, no medical copy, no marketing hero photography of people.
> What was taken is a *typographic and spatial system*: deep navy fields, an oversized
> high-contrast serif with an italic accent line, numbered section markers, pill
> geometry, capsule stat rails, and hairline rules. What was rejected is everything
> that would weaken a supervisory system: decorative neon, gradient meshes, and
> colour as the only carrier of meaning.

This document is normative. When a screen and this file disagree, this file wins.

---

## 1. What the reference actually is

Stripped of photography, the reference page is built from nine repeatable devices:

| # | Device | Where it appears | Why it reads as premium |
|---|--------|------------------|--------------------------|
| 1 | Deep, desaturated navy field | hero, footer, stat rail | Dark is quiet; quiet reads as expensive |
| 2 | Oversized serif, one **italic** line | `Più di` / *`un sorriso.`* | Contrast of voice inside a single sentence |
| 3 | Numbered section eyebrow, `01 ——` | every band | Orientation without a heading |
| 4 | Hairline rules, 1px, low opacity | dividers, brows | Structure with no visual weight |
| 5 | Pill controls with a circular arrow | every CTA | One shape, learned once, reused |
| 6 | Capsule stat rail: icon · number · caption | page footer | Numbers get their own furniture |
| 7 | Large-radius panels (24–28px) | content bands | Soft containers, hard content |
| 8 | Airy vertical rhythm (96–160px bands) | throughout | Nothing competes for the eye |
| 9 | Warm cream accent against cool blue | CTA on light panels | One warm note in a cool scene |

Those nine devices are the entire visual system. Everything below is their
translation into an application that a bank examiner uses for six hours a day.

---

## 2. Principles

1. **Authority is quiet.** No shouting. Urgency is expressed by hierarchy, wording and
   redundant encoding — never by saturation, glow or motion.
2. **The serif speaks, the sans works.** Display serif for orientation; sans for data.
   A finding never appears in display type.
3. **One warm note.** The champagne accent appears at most once per viewport and only
   on the single most important action.
4. **Structure over decoration.** Hairlines and whitespace do the dividing. Borders are
   thin and low-contrast; elevation is almost absent.
5. **Nothing is encoded by colour alone.** Every severity, status and risk carries a
   shape, a label and a token — see §7.
6. **Density is a right, not a default.** Analysts need tight rows; a reader needs air.
   Both use the same tokens at different spacing steps.
7. **Beauty never outranks safety.** No animation on destructive controls, no
   decorative motion on states that imply progress, no confetti on approval.

---

## 3. Colour

Semantic tokens only. A component may not reference a raw hex value; it references a
role. All pairs below meet **WCAG 2.2 AA** (4.5:1 body, 3:1 large text and UI bounds);
the measured ratios are recorded in §11.

### 3.1 Substrate

| Token | Hex | Role |
|---|---|---|
| `--ficap-bg` | `#F4F5F7` | Application canvas (cool paper, not white) |
| `--ficap-surface` | `#FFFFFF` | Panels, cards, tables |
| `--ficap-surface-sunken` | `#FAFAFB` | Table headers, inset wells |
| `--ficap-border` | `#E4E6EB` | Hairline rule |
| `--ficap-border-strong` | `#CBD0D9` | Input boundaries, focus containers |

### 3.2 Ink

| Token | Hex | Role | On |
|---|---|---|---|
| `--ficap-ink` | `#101828` | Primary text | surface |
| `--ficap-ink-muted` | `#556075` | Secondary text, captions | surface |
| `--ficap-ink-faint` | `#7A8496` | Tertiary, placeholders | surface |
| `--ficap-ink-inverse` | `#F7F8FA` | Text on navy | navy |
| `--ficap-ink-inverse-muted` | `#A9B4C6` | Captions on navy | navy |

### 3.3 Field (the deep navy)

| Token | Hex | Role |
|---|---|---|
| `--ficap-field` | `#0B1B2E` | Sidebar, hero field |
| `--ficap-field-raised` | `#132741` | Sidebar hover, chips on navy |
| `--ficap-field-deep` | `#07121F` | Footer, deepest well |
| `--ficap-field-line` | `rgba(255,255,255,0.10)` | Hairline on navy |

### 3.4 Accents

| Token | Hex | Role |
|---|---|---|
| `--ficap-accent` | `#0E7C71` | Institutional seal green — links, focus, primary action on light |
| `--ficap-accent-hover` | `#0A6158` | Hover |
| `--ficap-warm` | `#E8D5B7` | Champagne — the single warm note, on navy only |
| `--ficap-warm-ink` | `#2A2116` | Text on champagne |

Champagne is **never** used for a data value, a status, or a control inside a table.
It is reserved for one primary call to action per view.

### 3.5 Severity

Severity is a five-step ordinal scale. Each step has a colour, a **glyph**, a **border
style** and a **word**. Any one of those alone is sufficient to identify the level.

| Level | Token | Colour | Glyph | Border | Word |
|---|---|---|---|---|---|
| Critical | `--sev-critical` | `#8E1230` | ◆ filled diamond | solid 1px | Critical |
| High | `--sev-high` | `#A8410F` | ▲ filled triangle | solid 1px | High |
| Medium | `--sev-medium` | `#8A5A06` | ● filled circle | solid 1px | Medium |
| Low | `--sev-low` | `#0E7C71` | ■ filled square | solid 1px | Low |
| Info | `--sev-info` | `#4A5568` | ○ hollow circle | dashed 1px | Informational |

**Unscored is not Low.** A record with no score renders as `Unscored` in a hollow,
dashed, neutral treatment. A missing measurement must never look like a good one.

### 3.6 Status palettes are separate from severity

Workflow status uses neutral chips with a dot + label. Green is reserved for
*verified* states only. `not_assessed`, `blocked`, `skipped` and `untested` are
rendered in the neutral family — never green, never red.

---

## 4. Typography

Self-hosted only. No third-party font request, so `font-src 'self'` stays strict and
no visitor IP leaks to a font CDN.

| Family | Package | Use |
|---|---|---|
| **Playfair Display** (variable) | `@fontsource-variable/playfair-display` | Display: page titles, hero, section numerals |
| **Inter** (variable) | `@fontsource-variable/inter` | Everything else, tabular figures via `tnum` |
| **ui-monospace / SFMono** | system | Hashes, IDs, CVSS vectors, evidence digests |

### Scale

| Step | Size / line | Family | Use |
|---|---|---|---|
| `display-xl` | 56 / 1.02 | Playfair 500 | Sign-in hero only |
| `display-lg` | 40 / 1.06 | Playfair 500 | Page title |
| `display-md` | 30 / 1.12 | Playfair 500 | Panel heading, empty states |
| `eyebrow` | 11 / 1.2, `0.18em` tracking, uppercase | Inter 600 | Numbered section marker |
| `title` | 15 / 1.35 | Inter 600 | Card title |
| `body` | 13 / 1.6 | Inter 400 | Prose |
| `datum` | 12 / 1.5 | Inter 400 `tnum` | Table cells |
| `micro` | 11 / 1.45 | Inter 500 | Captions, hints |

**Italic is a voice, not a style.** It appears in display type only, on the second
clause of a two-clause sentence — the reference's `Più di / un sorriso.` pattern.
Example: **"Every finding / *has a verifier.*"** Never in body copy, never in a table,
never for emphasis inside a sentence.

Numerals in tables, counters and digests always use tabular figures.

---

## 5. Geometry

| Token | Value | Applies to |
|---|---|---|
| `--r-xs` | 6px | Inputs, chips |
| `--r-sm` | 10px | Badges, small buttons |
| `--r-md` | 16px | Cards, panels |
| `--r-lg` | 24px | Hero panels, login card |
| `--r-pill` | 999px | All primary/secondary buttons, stat capsules |

The reference's 24–28px radius is used for *containers*, never for controls. Controls
are pills or 6px inputs — a control is never a rounded rectangle with a large radius,
because that reads as decoration rather than affordance.

### Spacing

4px base. Bands: 96px desktop / 40px mobile between major sections on public surfaces;
24px inside the application. Table row height 36px `compact`, 44px `comfortable`.

### Rules

- Hairlines are 1px at `--ficap-border`. Never 2px, never a double border.
- Shadow is used only for floating layers (popover, dialog, command palette):
  `0 24px 48px -24px rgba(11,27,46,0.35), 0 0 0 1px rgba(11,27,46,0.06)`.
- Panels in the application body are **flat**. Elevation is reserved for things that
  actually float.

---

## 6. Components

### 6.1 Section marker (`01 —— LABEL`)
The reference's strongest orientation device. Format: two-digit index in Playfair
`display-md`, a 40px hairline, then an Inter uppercase eyebrow. Used once per page band,
never twice in the same band.

### 6.2 Pill button
`--r-pill`, height 40 (default) / 32 (compact) / 28 (inline). Three variants:

- **Primary** — filled `--ficap-accent`, white text, trailing circular arrow badge.
  Exactly one per view.
- **Secondary** — 1px border, transparent fill, navy text.
- **Quiet** — text only with a leading chevron, for in-table actions.

**Destructive actions never use the pill.** A destructive control is a bordered,
rectangular, low-radius button in the critical family, visually set apart from
navigation, and it always requires an explicit confirmation step naming the object
being destroyed. It must never sit where a user's eye expects "Save".

### 6.3 Stat capsule
The reference's footer rail, adapted. A horizontal capsule containing an icon, a
Playfair numeral, and an uppercase caption, separated by hairline dividers.

Used for at most four figures per band, on a navy field. Each figure carries its own
qualification below (`as at 2026-10-29`, `of 412 assessed`) — a number without its
denominator is not a statistic.

### 6.4 Panel
White, `--r-md`, 1px hairline, no shadow. Header holds an Inter title and, on the right,
at most one action. Body is either prose (max 72ch) or a table.

### 6.5 Command palette
`⌘K` / `Ctrl K`. Keyboard-first, focus-trapped, `role="dialog"` + `aria-modal`,
Escape closes, arrow keys move, Enter activates, results grouped by task verb not by
route. It is an accelerator: every destination it reaches is also reachable without it.

### 6.6 Evidence chip
A hash is not a visual. Evidence references render as a monospace chip truncated to
8 hex characters with the full digest in `title` and an accessible name, next to a
verification glyph whose state is one of *verified / unverified / broken*.

---

## 7. Encoding rules (non-negotiable)

1. Severity: colour + glyph + border + word. Remove colour and the level survives.
2. Status: dot + label. Green means *verified*, not *good news*.
3. No colour-only deltas. A trend needs an arrow and a word.
4. Charts: every series has a distinct luminance *and* a distinct dash pattern; every
   chart has a text-equivalent table beneath or in `aria-describedby`.
5. `blocked`, `skipped`, `untested`, `not_assessed`, `unavailable` are visually
   distinct from both success and failure — they sit in the neutral family with a
   dashed boundary. **A check that did not run never renders as passed.**

---

## 8. Motion

| Token | Value | Use |
|---|---|---|
| `--dur-fast` | 120ms | Hover, focus |
| `--dur-base` | 200ms | Panel reveal, palette |
| `--ease-out` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | Default |

Only `transform` and `opacity` animate. Nothing animates on load except the page
transition. `prefers-reduced-motion: reduce` collapses every duration to 0.001ms —
already enforced globally in `globals.css`. No looping animation anywhere.

---

## 9. Accessibility (WCAG 2.2 AA)

- Every interactive element has a 2px focus ring at `--ficap-focus` with 2px offset,
  never removed, visible against both light and navy surfaces.
- Skip link is the first focusable element on every page.
- Target size ≥ 24×24 CSS px (AA 2.5.8); in-table icon actions pad to 32px.
- Colour is never the only channel (§7).
- `aria-live="polite"` for result counts after filtering; `role="alert"` for errors.
- Forms: label is always visible — placeholders are never the label.
- The palette and every dialog trap focus and restore it on close.
- Reflow at 320px with no horizontal scroll on body copy; tables scroll in their own
  container with `role="region"` and `aria-label`.

---

## 10. Security expressed in the interface

Design carries security obligations, not just looks:

- **Confidential by default.** Evidence thumbnails and record previews render redacted
  until the viewer's entitlement is checked server-side. The UI never *decides* this.
- **Honest affordances.** Nothing that cannot succeed is rendered as enabled. If an
  operation is unavailable (no engine, out of scope, no entitlement) the control is
  either absent or explicitly disabled with the reason in text.
- **Step-up before harm.** Publishing a report, revoking an authorization, suspending an
  institution, or exporting evidence triggers a re-authentication step. The confirmation
  names the object, the effect, and the irreversibility.
- **No secrets in the interface.** No token, key, digest-of-secret or internal URL is
  ever rendered, and none appears in a shareable link.
- **Time is shown, not implied.** Evidence links and access grants display their
  remaining validity as text.
- **No false completeness.** Every dashboard states what it cannot see
  ("checks not run are excluded" / "engines unavailable are listed").

---

## 11. Contrast record

Measured against their intended background. Recomputed by
`tests/design-tokens.test.ts` so a token edit cannot silently break AA.

| Pair | Ratio | Required | Result |
|---|---|---|---|
| `--ficap-ink` on `--ficap-surface` | 17.75:1 | 4.5 | pass |
| `--ficap-ink-muted` on `--ficap-surface` | 6.33:1 | 4.5 | pass |
| `--ficap-ink-faint` on `--ficap-surface` | 4.95:1 | 4.5 | pass |
| `--ficap-accent` on `--ficap-surface` | 5.07:1 | 4.5 | pass |
| `--ficap-accent` on `--ficap-surface-sunken` | 4.86:1 | 4.5 | pass |
| `--ficap-ink-muted` on `--ficap-bg` | 5.80:1 | 4.5 | pass |
| `--ficap-ink-inverse` on `--ficap-field` | 16.33:1 | 4.5 | pass |
| `--ficap-ink-inverse-muted` on `--ficap-field` | 8.29:1 | 4.5 | pass |
| `--ficap-ink-inverse-muted` on `--ficap-field-deep` | 8.99:1 | 4.5 | pass |
| `--ficap-warm-ink` on `--ficap-warm` | 11.02:1 | 4.5 | pass |
| `--sev-critical` on `--ficap-surface` | 9.21:1 | 4.5 | pass |
| `--sev-high` on `--ficap-surface` | 6.13:1 | 4.5 | pass |
| `--sev-medium` on `--ficap-surface` | 5.92:1 | 4.5 | pass |
| `--sev-low` on `--ficap-surface` | 5.07:1 | 4.5 | pass |
| `--sev-critical` on `--ficap-bg` | 8.45:1 | 4.5 | pass |

These are computed values, not estimates: `tests/design-tokens.test.ts` resolves every
pair from the tokens in `globals.css` and fails the build if any drops below its
threshold. The first draft of this document listed estimated ratios and one of them
(`--ficap-ink-faint` at 3.77:1) was wrong; the test caught it and the token was
darkened to `#667180` rather than the claim being softened.

---

## 12. What we deliberately did **not** take

- **The clinic.** No photography of people, no stock imagery, no smiles, no "book a
  visit". A regulator's interface is not a brochure.
- **The neon/glow direction of the earlier reference.** Rejected on both brand and
  accessibility grounds; it also violates the standing rule that colour must not be the
  sole carrier of severity.
- **Gradient decoration.** The only permitted gradient is a single vertical legibility
  scrim behind text over the navy hero, and it exists to raise contrast — it is a
  contrast device, documented here, and it is never used on cards, buttons or data.
- **Marketing composition inside the application.** The numbered-band, oversized-serif
  treatment is for the public sign-in surface and page headers. A findings table has no
  hero.
- **Infinite carousels, autoplay, parallax.** Motion that performs while a user reads a
  risk register is an accessibility hazard.
