# Augmentation Films — Design Direction

## Audience
Friends and visitors browsing a chronological archive of energetic short films.

## Mood
Cinematic, archival, deliberate, and slightly raw — an editing bay rather than a generic streaming service.

## Direction
A single near-black film archive with bright limestone typography and a heat-red timecode accent; dates form the navigational spine.

## Palette
- Background: `#10100f`
- Surface: `#171715`
- Raised surface: `#20201d`
- Primary text: `#f1eee6`
- Muted text: `#aaa69b`
- Divider: `#393831`
- Accent: `#ff5c35`
- Accent hover: `#ff7b5c`
- Success: `#8cbf74`
- Warning: `#e6ad47`
- Danger: `#ef625c`

## Typography
- Display: local Turnpike (`pike`), used for the logotype and large numerals.
- UI/body: system sans stack (`Inter`, `Arial`, sans-serif).
- Scale: 12 / 14 / 16 / 20 / 28 / clamp(42, 8vw, 104) px.
- Metadata uses tabular numerals with moderate tracking.

## Geometry and rhythm
- Radius: 4px for controls, 10px for video frames, 16px for large panels.
- Spacing: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 72 px.
- Main content uses a 12-column frame with a persistent date rail on larger screens.

## Component rules
- Buttons are square, labelled where icon meaning is not universal, and have a visible focus ring.
- Film entries are separated by lines and space, not a card grid.
- Video controls sit in a solid dark control rail and use the accent only for current state and progress.
- Timeline markers show a date, active state, and clear play affordance.
- Empty and media failure states remain readable against the film frame.

## Avoid
- No second theme, theme switcher, gradients, glowing blobs, or blurred cursor.
- No oversized pill controls, floating bento cards, or decorative metrics.
- No animation that obscures the video, date, or playback state.
