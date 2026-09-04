# YALI Short-form Studio Design System

> Global visual source of truth for the YALI Short-form Studio desktop app.

## Product direction

- Product: local desktop studio for Shorts, Reels, and card-news production.
- Brand label: `얄리 숏폼 스튜디오`.
- UI direction: warm-neutral monochrome minimalism, editorial workspace, typography-led.
- Media direction: user images and videos are displayed in their original color by default. The UI theme must never desaturate media previews.
- Content outputs share the project source but keep output-specific crop, text, subtitle, and layout overrides.

## Layout principles

```text
left rail      global navigation and grouped categories
top bar        current project and workflow progress
main canvas    active work or project list
right panel    selected item inspector or focused preview
bottom strip   quick actions or persistent job queue
```

- Keep global navigation separate from the current project workflow.
- Prefer rows, timelines, and focused panels over repeated equal-sized card grids.
- Keep the main task visible without requiring a modal for ordinary editing.
- Use a minimum desktop content width of 1180px; collapse secondary panels before creating horizontal scroll.
- Use a 4/8px spacing rhythm with section gaps of 24px and 32px.

## Color tokens

The application chrome uses warm neutral tones. These tokens do not apply as filters to media.

| Role | Hex | CSS variable |
|---|---|---|
| Background | `#F4F1EB` | `--color-background` |
| Surface | `#FFFEFB` | `--color-surface` |
| Surface muted | `#ECE8E1` | `--color-surface-muted` |
| Text primary | `#252421` | `--color-text-primary` |
| Text secondary | `#6F6A62` | `--color-text-secondary` |
| Text disabled | `#9C978F` | `--color-text-disabled` |
| Border | `#D8D2C9` | `--color-border` |
| Border strong | `#BEB7AD` | `--color-border-strong` |
| Action primary | `#2D2B28` | `--color-action-primary` |
| Action primary text | `#FFFEFB` | `--color-action-primary-text` |
| Focus ring | `#6D6257` | `--color-focus-ring` |
| Attention | `#817568` | `--color-attention` |
| Error | `#574B45` | `--color-error` |

### Media color rule

```css
--media-filter: none;
```

- Project thumbnails, video frames, card-news previews, and uploaded assets use natural source color.
- Do not apply grayscale, sepia, opacity, or desaturation to media because the surrounding UI is monochrome.
- A visual effect is allowed only when the user explicitly selects an output style that contains that effect.
- Preview and final render must use the same media color pipeline.

## Typography

- Primary: `Pretendard Variable`, `Pretendard`, `Noto Sans KR`, sans-serif.
- Headings: 600–700 weight, compact editorial hierarchy.
- Body: 400–500 weight, minimum 14px for secondary text and 16px for editable content.
- Use sentence case Korean labels; avoid all-caps UI labels except technical status codes.
- Keep long text blocks within a readable measure; use line-height 1.45–1.6.

## Components

### Navigation

- Group labels: `홈`, `제작`, `라이브러리`, `운영`, `시스템`.
- Use one consistent outline icon family with 1.5–2px stroke.
- Do not use emoji as structural icons.
- Selected navigation uses a warm-gray surface and strong text, not a saturated color.

### Buttons

- Primary action: charcoal fill, ivory text, 8px radius, minimum 40px height.
- Secondary action: transparent or surface fill with 1px border.
- Destructive action: neutral dark treatment plus a clear error label; never rely on red alone.
- Hover and pressed states change surface or opacity without changing layout bounds.
- Focus rings remain visible for keyboard users.

### Project rows

- Use a compact original-color thumbnail on the left.
- Show title, output type, updated time, current workflow step, and progress.
- Use a thin step line for workflow status instead of multiple colorful badges.
- Provide `이어서 작업` as the primary row action.

### Inspector

- The right panel is contextual: project, cut, subtitle, or output settings.
- Keep fields grouped under clear labels and preserve unsaved edits during regeneration.
- For media controls, show a source/original preview before output-specific effects.

### Preview

- Default preview is WYSIWYG: source colors, crop, motion, subtitles, bubbles, and safe areas match the selected output.
- Show a clear `원본` or `출력 미리보기` context when the user is comparing source and rendered output.
- Do not hide color or contrast changes behind the app theme.

## Motion and interaction

- Use subtle 150–220ms transitions for hover, selection, drawer, and progress changes.
- Avoid scroll-triggered storytelling or decorative motion in the desktop app.
- Respect `prefers-reduced-motion`; replace nonessential animation with an immediate state change.
- Generation progress must remain visible and must not depend on animation alone.

## Accessibility and quality gates

- Normal text contrast target: at least 4.5:1.
- Meaningful states must be conveyed by text, icon, or structure in addition to color.
- All controls need accessible names and visible focus states.
- Keyboard users must be able to navigate, regenerate, lock, reorder, and inspect cuts without drag-only interaction.
- Thumbnail and preview alt text should include project/cut context.
- Validate at 1280px, 1440px, and 1920px desktop widths before release.

## Approved screen direction

- The approved direction is the YALI editorial workspace concept: narrow grouped rail, project workflow in the top bar, project rows and expanded current work in the main canvas, focused preview/inspector on the right, and quick actions at the bottom.
- The screen is a design reference only until UI implementation is explicitly started after mockup review.
