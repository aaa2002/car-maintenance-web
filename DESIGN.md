# Design System: Vehix Web

The source of truth for how Vehix looks and moves. Tokens live in `src/theme/tokens.css`, component styles in `src/app/globals.css`. When this document and the code disagree, fix one of them; do not let them drift.

## 1. Visual Theme & Atmosphere

A calm, precise maintenance tool that feels like well-machined hardware: soft silver surfaces sitting in thin trays, one confident royal blue accent, and figures that read at a glance. It is a working app, not a brochure, so density is balanced rather than airy and motion confirms actions instead of performing.

- **Density 5, "Daily App Balanced":** every screen leads with one primary figure (this month's spend, a vehicle's stats) and keeps supporting data one step quieter.
- **Variance 5, "Offset Asymmetric":** asymmetric where it earns attention (the Garage summary bento, the sign-in split), predictable everywhere people do repeated work (lists, forms, settings).
- **Motion 4, "Fluid CSS":** staggered entrances, soft lifts on hover, physical press feedback. CSS only; no animation library.
- **Light and dark are equal citizens.** Both are designed, not inverted. The page follows the system setting unless the user picks one in Settings.

## 2. Color Palette & Roles

One accent, cool neutrals, and semantic colors that only ever mean status.

| Role | Light | Dark | Used for |
|---|---|---|---|
| **Silver Canvas** | `#F1F2F4` | `#070809` | Page background |
| **Soft Surface** | `#FCFCFD` | `#101114` | Panels, tiles, list rows |
| **Raised Surface** | `#FDFDFE` | `#15161A` | Dialogs, date picker, file drop |
| **Muted Surface** | `#ECEDF0` | `#1A1B20` | Segmented tracks, icon wells, hover fills |
| **Tray** | `#E6E7EB` | `#0C0D10` | The 5px ring every major surface sits in |
| **Hairline** | `rgba(22,26,40,0.07)` | `rgba(255,255,255,0.07)` | Edges and dividers instead of grey borders |
| **Ink** | `#111214` | `#EDEDEF` | Primary text |
| **Steel** | `#5C6069` | `#9A9CA6` | Secondary text, labels, metadata |
| **Royal Blue** (the accent) | `#1F55D6` | `#6B9BFF` | Primary buttons, active nav, focus rings, selected dates, the spend tile |
| **Royal Blue Wash** | `#E6EDFC` | `#11224A` | Accent backgrounds: icon circles, today's date, scheduled pills |
| **On Royal Blue** | `#FBFBFE` | `#06132E` | Text and icons on royal blue fills |
| **Trip Grey** | `#9AA0AD` | `#5D6272` | Second chart series (trips), never decorative |
| **Plate** | `#E3E9F5` | `#15203A` | Vehicle tile background when there is no photo |
| **Success** | `#137A4B` | `#5CC995` | Valid documents, completed state |
| **Warning** | `#9C5200` | `#F0A54C` | Expiring soon, scheduled work, attention counts |
| **Danger** | `#BF333B` | `#FF7178` | Expired, destructive actions, errors |

**Rules**
- Royal Blue is the only decorative color. If something is colored and is not a status, it is royal blue.
- Status colors always come with their soft background (`--app-*-soft`) as a pill or icon well. Never as a full-bleed fill, never as decoration.
- Dark mode lightens the accent (`#6B9BFF`) and puts dark text on it. Hierarchy must read the same in both modes.
- Never pure black or pure white. Never warm greys next to these cool ones.
- Body text on any surface keeps at least 4.5:1 contrast.

## 3. Typography Rules

- **Typeface:** Geist (variable), loaded with `next/font` and including the `latin-ext` subset for Romanian (ă, â, î, ș, ț). One family for everything.
- **Page titles:** `clamp(1.7rem, 2.6vw, 2.15rem)`, weight 640, tracking `-0.04em`, line-height 1.1.
- **Section headings:** 1.02rem, weight 620, tracking `-0.02em`, sentence case. Sections are named by real headings, not small uppercase labels.
- **Hero figures** (the spend tile, Spend total): up to `3.6rem`, weight 560, tracking `-0.05em`.
- **Body:** 15px, line-height 1.5, Steel for secondary copy.
- **Labels:** 0.84rem, weight 560, always above the field.
- **Numbers:** tabular figures (`font-variant-numeric: tabular-nums`) for every amount, distance and date column so they align. Standalone single counts (the bento stats) use normal figures, because Geist's tabular "1" carries a foot that looks wrong alone.
- **No monospace face.** Geist Mono was tried for numbers and read too heavy at display sizes.
- **Banned:** Inter as a default, serif fonts anywhere in the app, all-caps eyebrow labels above headings, gradient text.

## 4. Component Stylings

**Shape rule:** buttons, segmented controls, status pills and toasts are fully round. Inputs use 12px (`--app-radius-control`). Surfaces use 18px (`--app-radius-surface`); dialogs, the sidebar and the file/date trays use 22px.

- **Trays (the "double bezel"):** every major surface (panels, list groups, vehicle tiles, bento tiles, dialogs, the sidebar) uses `--app-bezel`: a hairline, a 5px Tray ring, a second hairline, and a 1px inner highlight. The ring follows the element's radius, so curves stay concentric. Lift comes from very soft, wide shadows tinted toward blue-grey, never from dark drop shadows.
- **Primary buttons:** Royal Blue pill, faint inner highlight, small Royal Blue-tinted shadow. Press scales to 0.98. Key actions ("Add vehicle", "Add repair") use the island pattern: the icon sits in its own translucent circle at the trailing edge and nudges on hover.
- **Secondary buttons:** Soft Surface pill with a hairline edge. Destructive actions are outlined in Danger and fill on hover.
- **Segmented controls:** a Muted pill track; the active option is a raised Soft Surface pill. Used for status (Done / Scheduled), filters and settings choices.
- **List rows:** 66px minimum, round icon well on the left, title and Steel subtitle, status pill and amount on the right, chevron that slides 3px on hover. Rows are divided by hairlines.
- **Vehicle tiles:** 16:9 media, then name, description and mileage. With no photo, the brand name is set large in a faint Royal Blue over the Plate color, cropped by the frame. Tiles lift 4px on hover; photos scale to 1.03.
- **Garage bento:** a tall Royal Blue "This month" tile (with a pill link into Spend), two stat tiles beside it, and one wide stat tile below. Exactly as many cells as values.
- **Stat strip:** inline figures separated by hairlines inside one tray, used on the vehicle page. The mileage figure is a button that opens the mileage editor.
- **Inputs:** Soft Surface fill, hairline edge, faint inset shadow, 46px tall. Focus is a Royal Blue edge plus a 3px Royal Blue halo. Errors sit below the field in Danger.
- **Date field:** looks like an input, shows the date written out ("Mon, 5 October 2026") with a Royal Blue calendar icon. Opens a calendar in the browser's top layer, so it floats over dialogs. It opens below the field and flips above when there is no room. Inside a tray, days are round, today has a Royal Blue outline, the selected day is a filled Royal Blue circle. Dates the form would reject are dimmed. Built on `react-day-picker` with English and Romanian locales and Monday as the first day.
- **File drop:** a dashed well inside a tray with a Royal Blue cloud icon and "Drop a file here or browse". While dragging, the tray tints Royal Blue Wash. A chosen file becomes a row (name, size, Replace, remove); images show as a preview card. Removing an existing file is undoable until save. Unsupported types are rejected inline.
- **Dialogs:** 22px tray, no header divider, larger 1.2rem title. On phones they become bottom sheets.
- **Loading:** skeletons shaped like the final layout (bento, tiles, rows). No spinners except tiny inline refresh indicators.
- **Empty states:** a round Royal Blue icon well, one sentence, and the action that fills the space.

## 5. Layout Principles

- **Shell:** a floating sidebar (236px) inset 14px from the window, framed like every other surface. Content is capped at 1180px.
- **Rhythm:** sections are separated by 40-44px. Grids use 22-26px gaps so tray rings never touch.
- **One focus per screen:** Garage leads with the spend tile, a vehicle leads with its actions and stat strip, Spend leads with the total.
- **Sign-in:** a split. Left is a deep navy panel with the headline, one sentence, and a stack of two slightly rotated cards previewing the real attention list. Right is the form. No feature bullets, no badges.
- **Grid over flex math.** Use CSS Grid for anything with columns.

## 6. Responsive Rules

- **Under 992px:** the sidebar becomes an icon rail; the bento becomes two columns with the spend tile on top; the sign-in preview hides.
- **Under 768px:** the sidebar is replaced by a frosted bottom bar; everything collapses to one column (the stat strip keeps a 2 by 2 grid). Activity rows drop their icon and stack status and amount on the right so titles keep their width. Dialogs become bottom sheets.
- **No horizontal scroll** at 390px wide. This is checked on every change.
- **Touch targets:** buttons and inputs are 42-46px tall; icon buttons are 36px, so keep them clear of each other.
- **Full-height layouts** use `100dvh`, never `100vh`.

## 7. Motion & Interaction

- **Easing:** `cubic-bezier(.32, .72, 0, 1)` for everything. Durations: 120ms for color, 260ms for most movement, 520ms for lifts and entrances.
- **Entrances:** the page fades up 10px. List items and tiles cascade in, 60ms apart (capped at eight), rising 16px out of a 6px blur.
- **Hover:** tiles lift, chevrons and back arrows slide 3px, island icons nudge diagonally.
- **Press:** buttons scale to 0.98, icon buttons to 0.92, calendar days to 0.92.
- **Purpose:** every animation either confirms an action, shows a state change, or orders what appears first. Nothing loops except skeleton shimmer while loading.
- **Performance:** animate `transform` and `opacity` (plus the short entrance blur). Backdrop blur only on fixed layers (bottom bar, dialog backdrop). The background glow is a fixed, non-interactive layer.
- **Reduced motion:** `prefers-reduced-motion: reduce` collapses all animation and transition durations to effectively zero.

## 8. Language & Copy

- Every visible string goes through `src/i18n/strings.ts` in English and Romanian. Validation and error messages are stored as keys and translated when shown, so switching language updates text already on screen.
- Counts use plural rules, including the Romanian "de" form from 20 up ("20 de vehicule").
- Plain, functional copy. No marketing verbs, no cute labels.

## 9. Anti-Patterns (Never Do)

- No second accent color, no purple, no neon glows, no gradient text.
- No grey 1px borders around surfaces; use the tray and hairlines.
- No uppercase eyebrow labels above headings, and no decorative dots on pills or rows.
- No rows of equal stat cards; lead with one figure.
- No em dashes or en dashes in the interface.
- No native, unstyled browser controls where the app provides its own (date fields, file uploads).
- No hardcoded English strings in components.
- No pure black or pure white, no warm greys.
- No fake product screenshots built from divs. The sign-in preview is rendered with the app's real components.
- No emojis.
