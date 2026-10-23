# Huabu Web Design

## Overview

Huabu is an infinite-canvas workspace. Interaction feedback should be clear without competing with authored content. This document governs system-blue usage in `apps/web`; it is not a complete typography or layout specification.

[src/index.css](src/index.css) is the sole source of color values, theme overrides, and shared overlay recipes. This document defines how to use them, without duplicating their values. [Web architecture](../../docs/architecture/web-architecture.md#system-blue) documents implementation details and exceptions.

## Colors

Use semantic tokens instead of literal colors, Tailwind palette colors, or component-local blue mixtures. The four system-blue roles are:

| Token | Use | Avoid |
| --- | --- | --- |
| `info` | Bright graphical emphasis: selected toolbar icons, focus borders, selection outlines, guides, and active connection dots | Ordinary small text or solid backgrounds behind ordinary inverse text |
| `info-fg` | Blue text and foreground icons; solid info buttons, Prompt badges, and numbered chips carrying `fg-inverse` text | Replacing every graphical accent with this deeper shade |
| `info-light` | Auxiliary emphasis: idle connection dots, panel resize feedback, and secondary dividers | Using it as the sole necessary focus indicator |
| `info-bg` | Opaque tinted surfaces: selected rows, active toolbar backgrounds, info badges, and the Chat focus outer ring | Replacing a content-covering selection with an opaque wash |

Role names describe usage, not a fixed lightness order across themes. `fg-inverse` is theme-aware: do not hardcode white text on a blue background. `info-bg-hover` reuses the neutral hover surface; it does not introduce another blue.

Content Accent colors, Agent brand artwork, and other status families are separate systems. Do not recolor them as part of a system-blue cleanup.

### Transparency

Ordinary UI surfaces use the fixed roles above. Do not introduce local alpha variants, `color-mix()` expressions, or an extra focus blue to approximate an older appearance.

Transparency is appropriate when the user must still see the document or drawing underneath. Reuse the existing tokens rather than writing percentages in consumers:

| Token | Scenario |
| --- | --- |
| `--canvas-overlay-subtle` | Retained lasso region and Frame creation/fit previews |
| `--canvas-overlay-drop` | Structured-frame active tracks and insert targets |
| `--canvas-overlay-selection` | Live lasso fill |
| `--pdf-selection-bg` | PDF region selection |
| `--editor-selection-bg` | Selection over existing inline text highlights |
| `--sketch-reference-opacity` / `--sketch-selected-opacity` | Referenced / selected Ink stroke outlines |

These are separate purposes, not interchangeable opacity presets. Apply transparency to the overlay paint, not the parent container or underlying content. Existing animated running rings retain their component-owned effect recipe and color override; they are not a precedent for new translucent UI surfaces.

## Components

Reuse [Common components](src/components/Common) and their current contracts. Use `Button` for buttons and `TextInput` for styled text-like controls.

| Surface | Color contract |
| --- | --- |
| Solid info button | `info-fg` fill with `fg-inverse` text; hover adds an inset `fg-inverse` ring without changing the fill or dimensions |
| Chat composer focus | `info` 1px border and opaque `info-bg` 2px outer ring |
| Side-panel resize handle | `info-light` during both hover and dragging; neutral divider and transparent fill at rest |
| Selected toolbar control | `info` icon, `info-fg` text/shortcut, and `info-bg` surface |
| Connection control | Borderless `info-light` idle dot; larger `info` dot when targeted; preserve hit geometry |
| Resize grip | Surface fill with the existing `info` inset outline; do not copy the connection dot treatment |

## Do's and Don'ts

- Keep color changes separate from geometry and interaction changes. A request for a lighter color does not authorize removing a ring, changing border thickness, or replacing hover behavior.
- Reuse or adjust an existing role before proposing another color. Review all consumers of a shared token, not only the screenshot that prompted the change.
- Keep normal text contrast at least 4.5:1 and necessary graphical indicators at least 3:1 against their actual adjacent surfaces. Check both themes and default, hover, and selected states; white-background contrast alone is not enough.
- Preserve documented limitations honestly: idle light-blue connection dots do not guarantee 3:1 contrast, and authored content backgrounds can invalidate otherwise readable combinations. Do not claim universal accessibility from the palette alone.
- For a palette change, inspect rendered components and run the relevant [system-blue browser coverage](e2e/system-blue.spec.ts). Update this document when role assignments change and the architecture documentation when implementation contracts change.
- Do not restore scattered transparency recipes, add a local exception blue, or change other status/Accent palettes merely to make one component resemble its old appearance.
