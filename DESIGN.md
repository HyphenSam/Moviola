---
name: Moviola
description: A quiet editing bench where the picture is the only colour on screen and every action says whether it loses quality.
colors:
  accent: "oklch(0.66 0.16 55)"
  accent-hover: "oklch(0.62 0.16 52)"
  accent-ink: "oklch(0.21 0.006 286)"
  accent-soft: "oklch(0.95 0.035 70)"
  accent-text: "oklch(0.52 0.11 58)"
  focus: "oklch(0.52 0.11 58)"
  canvas: "oklch(0.975 0.002 286)"
  panel: "oklch(1 0 0)"
  stage: "oklch(0.18 0.003 286)"
  sunken: "oklch(0.955 0.003 286)"
  line: "oklch(0.905 0.005 286)"
  line-strong: "oklch(0.83 0.008 286)"
  ink: "oklch(0.21 0.006 286)"
  ink-soft: "oklch(0.45 0.012 286)"
  danger: "oklch(0.55 0.2 25)"
  ok: "oklch(0.55 0.13 155)"
typography:
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.3
  heading:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.45
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "tnum"
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.45
  caption:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
  timecode:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.45
rounded:
  control: "8px"
  panel: "12px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  section: "28px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.control}"
    height: "36px"
    padding: "0 14px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "36px"
    padding: "0 14px"
  button-ghost:
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.control}"
    height: "28px"
    padding: "0 10px"
  segmented:
    backgroundColor: "{colors.sunken}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.control}"
    height: "32px"
  segmented-selected:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
  switch-on:
    backgroundColor: "{colors.accent}"
    rounded: "{rounded.pill}"
    width: "36px"
    height: "20px"
---

# Design System: Moviola

## Overview

**Creative North Star: "The Editing Bench"**

A bench you bring footage to: neutral surfaces, a rail of tools, a settings column of short labelled controls, and a dark stage where the picture plays with a timeline beneath it. Nothing on screen competes with the picture; the one amber accent marks the next thing to press, the current selection and whatever is in progress. The system is Bytesize's (itself Art Cleaner's), with its own accent so the three are told apart at a glance, and two changes for video: the stage is dark in both themes, and every action carries a "Lossless" or "Re-encodes" label.

Density is moderate: compact 13–14 px labels, tight groups, generous separation between groups. Light and dark are equal citizens and follow the system setting. Motion is limited to 150–200 ms state changes.

**Key Characteristics:**
- Zinc neutrals in OKLCH (hue 286), one amber accent (hue 55–70), the warm light of a projector lamp.
- System UI type with tabular figures everywhere; a monospace face only for timecodes.
- Hairline borders and tonal layers instead of shadows; one floating shadow for overlays.
- State carried by form as well as colour (dashed, filling, ticked, warned, dimmed).

## Colors

Neutral zinc greys with a single amber; the picture supplies every other colour.

### Primary
- **Projector Amber** (accent): the primary action (Extract, Trim, Compress…), switches that are on, slider ranges, the trim handles and progress bars. Text on it is dark ink, not white: amber light enough to read as amber can't hold white text at AA. The light theme's amber is deeper (0.66 L) so it keeps 3:1 against white panels; the dark theme's is brighter (0.78 L). Hover deepens it in light and brightens it in dark. accent-text is the readable version for links; accent-soft is the text-selection and drop-overlay tint.
- **Focus** (focus): focus rings and the selected tool's indicator. accent-text in both themes, which holds well above 3:1 on panels.

### Neutral
- **Canvas** (canvas): the page behind everything.
- **Panel** (panel): the tool rail, settings column, toolbars and exports strip.
- **Stage** (stage): the player and timeline area. Near-black in both themes (0.18 L light, 0.13 L dark), the way every player shows video, so letterboxing reads as black and brightness can be judged.
- **Sunken** (sunken): segmented-control tracks and hover fills.
- **Hairline** (line, line-strong): dividers and control outlines.
- **Ink** (ink, ink-soft): text and secondary text, both at least 4.5:1 on panel and canvas.
- **Danger / OK** (danger, ok): failures and problems; finished exports and the "Lossless" badge.

Dark mode redefines every token under `prefers-color-scheme: dark` in `src/index.css`: neutrals as Bytesize (canvas 0.165 L, panel 0.2 L, ink 0.965 L), stage 0.13 L, accent `oklch(0.78 0.15 70)`, accent-hover `oklch(0.82 0.14 72)`, accent-soft `oklch(0.3 0.05 60)`, accent-text and focus `oklch(0.82 0.13 75)`, danger `oklch(0.68 0.18 25)`, ok `oklch(0.72 0.14 155)`. accent-ink stays dark ink in both themes. Check every pair's contrast when changing a token.

### Named Rules
**The Picture Owns Colour Rule.** Nothing but the amber accent and the two status colours carries chroma. The stage stays neutral so colour and compression artefacts can be judged.

**The Accent Means Act Rule.** Amber appears only on the next action, the current selection, the trim range, focus and progress; never as decoration.

**The Honest Label Rule.** Every primary action shows, next to it, whether it is lossless or re-encodes. Never leave the user to guess.

## Typography

**Body Font:** the platform UI face (system-ui stack), no web fonts, so the app works offline and feels native. Timecodes use the platform monospace (`ui-monospace` stack) at 13 px so digits don't jump as they change.

**Character:** plain and quiet; weight and size do the ranking, never case or tracking.

### Hierarchy
- **Title** (600, 18px): the empty stage's "Drop a video here"; the About dialog's title is 16px.
- **Heading** (600, 14px): the app name (15px), the tool's name at the top of the settings column.
- **Body** (400, 14px, 1.45): dialog prose and button text.
- **Label** (500, 13px): section headings (sentence case, ink-soft), field labels, segmented options, file and track names.
- **Caption** (400, 12px): hints under controls, status lines, file sizes, tool-rail labels.
- **Timecode** (500, 13px mono): the player's position and duration, trim in and out fields.

### Named Rules
**The Sentence Case Rule.** Headings and labels are sentence case at normal tracking. No uppercase tracked labels or eyebrows.

## Layout

Desktop (1024 px and up): three columns. A 72 px **tool rail** (icon above a 12 px caption, one per tool), a 320 px **settings column** (the open file's card, the tool's settings scrolling, the primary action and its Lossless/Re-encodes badge pinned at the foot), and the **stage** filling the rest: the player, the transport and timeline beneath it, and the exports strip at the bottom. The page itself never scrolls.

Mobile: one column in reading order: header, stage (player and timeline, at least 50% of the viewport height), a horizontally scrolling row of tool chips, settings, exports. The primary action is fixed to the bottom of the screen.

Spacing: 4 px base; 8–12 px inside groups, 16–20 px panel padding, 28 px between settings sections.

## Elevation & Depth

Flat by default: depth comes from tonal layers (canvas, panel, stage, sunken) and 1 px hairlines. One shadow, `--shadow-float`, is reserved for things that float above the page: dialogs, the update notice, tooltips. Labels over the picture use a translucent black chip with a small backdrop blur.

### Named Rules
**The Flat-By-Default Rule.** Surfaces don't cast shadows at rest; only overlays float.

## Shapes

Gently rounded: 8 px for controls and thumbnails, 6 px for a segmented option inside its 8 px track, 12 px for panels, dialogs and the drop area, full pills for switches and badges. The empty stage uses a 2 px dashed outline as the drop target.

## Components

### Buttons
As Bytesize: 8 px radius; heights 28 / 36 / 44 px. Primary is amber with dark ink text; secondary is panel with a line-strong ring; ghost is ink-soft text with a sunken hover. Icons are lucide at 16 px, 1.75–2 stroke, before the label.

### Tool rail
One button per tool: a 20 px lucide icon above its name in caption type. Selected: sunken fill, ink text and a 3 px focus-colour bar on the rail's inner edge. A tool that can't apply to the open file (say, Remove audio for a file with none) is dimmed, stays focusable and shows why in a tooltip. Arrow keys move between tools.

### File card
Top of the settings column: a 64 × 36 px thumbnail, the file name (label, truncates in the middle so the extension stays visible), and a caption line of size, duration and resolution. A ghost "Replace" button.

### Lossless badge
A pill beside the primary action. "Lossless": ok-coloured text and a check icon on a transparent fill with an ok hairline. "Re-encodes": ink-soft text and a refresh icon with a line-strong hairline. Form (icon) and words carry the meaning, not colour alone. A short caption under it can say what re-encoding touches ("Video re-encoded, audio copied").

### Segmented control, switch row, number field, slider
As Bytesize. Number fields gain units: kbps, MB, px, fps, s.

### Timecode field
A number field for times: `h:mm:ss.mmm` in the timecode face. Accepts `90`, `1:30`, `1:30.5` and `0:01:30.500`, normalises when it's left, and goes back if invalid. Paired with a ghost "Set to playhead" icon button.

### Player and transport
The video sits centred on the stage, letterboxed. Beneath it, on the stage: play/pause, the timecode (position / duration), a mute toggle with volume, and frame-step buttons. Controls on the stage use light ink at 0.9 L for contrast on the dark stage in both themes. When the browser can't play the file natively, a small translucent chip says "Preview without sound" and the stage shows decoded frames instead.

### Timeline
A 48 px strip of thumbnails across the stage's width, on a slightly lighter dark track. The playhead is a 2 px light line with a small handle at the top; click or drag anywhere to seek. Tools that use a range (Trim, Make animation) add two amber handles; outside the range the strip is dimmed to 35%. Fast trim draws a dashed light marker where the real cut will land (the keyframe) when it differs from the handle. Keyboard: the handles are sliders (arrow keys step a frame, Shift+arrow a second).

### Progress
Replaces the primary action while a job runs: an amber bar filling left to right, the percentage and time remaining in caption type, and a secondary "Cancel" button. Indeterminate phases (opening, finalising) use a pulsing bar.

### Exports strip
Bottom of the stage on panel: one card per result, newest first. An icon for the kind (audio, video, image), the file name, the size and the change against the source (−83%, or "+4%" in ink when it grew), and either "Download" or "Saved" with a tick. A remove button frees the memory. Failed jobs show a danger ring and the reason.

## Do's and Don'ts

### Do:
- **Do** keep the stage dark and neutral and let the picture be the only colour.
- **Do** use the amber accent only for the next action, selection, the trim range, focus and progress.
- **Do** label every action Lossless or Re-encodes, with an icon as well as words.
- **Do** show state by form as well as colour (dashed, bar, tick, warning, dimmed).
- **Do** use sentence-case headings at 13–14 px, ranked by weight.
- **Do** keep colour transitions to 150–200 ms.

### Don't:
- **Don't** put white text on the amber.
- **Don't** use gradients, glass, glows, film-strip textures, sprocket holes or other cinema kitsch.
- **Don't** add uppercase tracked labels, eyebrows or numbered sections.
- **Don't** tint the stage or put colour behind the picture.
- **Don't** load web fonts; the app must work offline with the system faces.
