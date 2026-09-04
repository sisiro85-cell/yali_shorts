# Yali Render Composition Design

## Style Prompt

Warm-neutral editorial short-form compositions for Yali Short-form Studio. The
interface chrome may be monochrome, but source media remains natural color and
is never desaturated by default. Typography is quiet and legible, with restrained
motion that supports the narration instead of competing with it.

## Colors

- Background: `#F4F1EB`
- Surface: `#FFFEFB`
- Text: `#252421`
- Secondary text: `#6F6A62`
- Accent: `#817568`

## Typography

- `Pretendard Variable`, `Pretendard`, sans-serif
- Headlines use 700–800 weight; subtitles use 500–600 weight.

## Motion

- Use gentle 0.4s–0.6s entrances and editorial push transitions between scenes.
- Keep all timelines paused and deterministic so preview and final render share
  the same seekable composition.

## What NOT to Do

- Do not apply grayscale, sepia, opacity, or color filters to source media.
- Do not bake editable Korean captions into generated image pixels.
- Do not use infinite animation loops or random/time-based values.
- Do not use jump cuts between scenes without a transition layer.
