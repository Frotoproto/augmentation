# augmentation films
A portfolio for a bunch of fun short films me and my friends made!

---

# Player contract

This document is the source of truth for the custom video player and timeline. Both `index.html` (dark) and `home1.html` (light) must conform to it. Any change to a token name, DOM hook, or event name is a breaking change and must be made here first.

## CSS variable contract

Both stylesheets (`styles.css`, `styles1.css`) must define these tokens in `:root`. The two themes override *values*, never *names*. No hardcoded color, duration, or radius is allowed outside the `:root` block.

### Color tokens
- `--bg` — page background
- `--fg` — primary text
- `--fg-muted` — secondary text
- `--fg-subtle` — tertiary text
- `--surface` — card surface
- `--surface-2` — elevated surface (player chrome)
- `--surface-3` — highest surface (scrubber track)
- `--accent` — primary accent (active marker, scrubber fill)
- `--accent-2` — secondary accent (hover)
- `--accent-soft` — translucent accent (glows)
- `--border` — default border
- `--border-strong` — focus / hover border

### Geometry tokens
- `--radius-sm` — 6px
- `--radius-md` — 12px
- `--radius-lg` — 20px

### Shadow tokens
- `--shadow-sm` — subtle elevation
- `--shadow-md` — card elevation
- `--shadow-lg` — modal / fullscreen elevation
- `--shadow-glow` — accent glow

### Motion tokens
- `--ease-out` — `cubic-bezier(0.16, 1, 0.3, 1)`
- `--ease-in-out` — `cubic-bezier(0.65, 0, 0.35, 1)`
- `--ease-spring` — `cubic-bezier(0.34, 1.56, 0.64, 1)`
- `--dur-fast` — 120ms
- `--dur-med` — 240ms
- `--dur-slow` — 420ms

### Typography tokens
- `--font-display` — `"pike", serif`
- `--font-body` — `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`

### Cursor tokens
- `--cursor-size` — 12px
- `--cursor-ring-size` — 36px

### Asset tokens
- `--grain-url` — `url("grain.png")`

## DOM contract

Every video card must emit this exact structure. Selectors are stable; do not add ad-hoc `data-x-` attributes.

```html
<article class="container right" data-timeline-item id="<stable-id>">
  <div class="title">Display Title</div>
  <div class="content player" data-player data-player-id="<stable-id>">
    <video class="player__video" preload="metadata" playsinline>
      <source src="filename.mp4" type="video/mp4">
    </video>
    <button class="player__big-play" data-player-action="toggle" aria-label="Play">▶</button>
    <div class="player__chrome" data-player-chrome hidden>
      <button class="player__btn player__play" data-player-action="toggle" aria-label="Play/Pause"></button>
      <div class="player__time">
        <span data-player-time="current">0:00</span>
        <span class="player__time-sep"> / </span>
        <span data-player-time="duration">0:00</span>
      </div>
      <div class="player__scrubber" role="slider"
           data-player-scrubber
           tabindex="0"
           aria-label="Seek"
           aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <div class="player__scrubber-buffer" data-player-buffer></div>
        <div class="player__scrubber-fill" data-player-fill></div>
        <div class="player__scrubber-thumb" data-player-thumb></div>
      </div>
      <button class="player__btn player__mute" data-player-action="mute" aria-label="Mute"></button>
      <button class="player__btn player__fs" data-player-action="fullscreen" aria-label="Fullscreen"></button>
    </div>
  </div>
</article>
```

The `id` on `.container` and `data-player-id` on the video must match. The id scheme is a filename slug (e.g., `march-11-23`, `aug-10-24`, `railer-1`).

The timeline spine is a single element:

```html
<div class="timeline">
  <div class="timeline__spine" data-timeline></div>
  <!-- markers injected by timeline.js -->
</div>
```

## Event contract

A single `EventTarget` is exposed on `window` as `window.AugPlayerBus`. Both `player.js` and `timeline.js` publish and subscribe through it. No cross-module imports, no shared state object, no globals beyond the bus.

### Events

| Event | Payload | Notes |
|-------|---------|-------|
| `player:ready` | `{ id, duration }` | Fired once after `loadedmetadata` |
| `player:play` | `{ id }` | Fired on `play` event |
| `player:pause` | `{ id, currentTime }` | Fired on `pause` event |
| `player:ended` | `{ id }` | Fired on `ended` event |
| `player:timeupdate` | `{ id, currentTime, duration }` | Throttled to ≤30Hz |
| `player:progress` | `{ id, buffered }` | Raw `TimeRanges` from `buffered` |
| `player:volumechange` | `{ id, muted, volume }` | Fired on `volumechange` |
| `player:fullscreen` | `{ id, isFullscreen }` | Fired on fullscreen change |
| `player:scrub` | `{ id, from, to }` | Envelope: dragstart publishes `from`, dragend publishes `to` |
| `timeline:marker-click` | `{ id }` | Player listens, calls `play()` |
| `timeline:active` | `{ id }` | Last-write-wins; subscribers read latest on mount |
| `timeline:viewport` | `{ id, isNear }` | Used by player for autoload upgrade |

### Rules

1. `player:timeupdate` is throttled to ≤30Hz. Subscribers can assume this rate.
2. `player:scrub` is an envelope, not a stream. The timeline pauses its own progress fill during a drag.
3. `timeline:active` is last-write-wins. Whoever is "active" writes it; subscribers read the latest value when they mount.
4. `player:play` from any video immediately publishes `timeline:active { id }`. IntersectionObserver publishes `timeline:active` only when no `player:play` has fired in the last 1.5s AND no `player:pause` is outstanding.

## Storage contract

- Key: `aug:mute`
- Value: `"true"` or `"false"` (string)
- Scope: same-origin, persistent across cards and pages
- Fallback: if `localStorage` throws (sandboxed / file://), use in-memory default of `unmuted`

## Compatibility contract

- `scrollIntoView({ behavior: 'smooth' })` must short-circuit to `behavior: 'auto'` when `prefers-reduced-motion: reduce` matches.
- `requestFullscreen()` must be called on the `.content.player` wrapper, not the `<video>` element, for iOS Safari compatibility.
- The scrubber must have `touch-action: pan-y` so vertical page scroll still works when a drag starts on it.
- The spacebar handler must be attached to the player root and must `preventDefault()` to prevent page scroll.
- `preload="metadata"` upgrade to `"auto"` via IntersectionObserver must downgrade back to `"metadata"` when the card leaves the 2-viewport window.

## Keyboard contract

- `Tab` — nav → card play → scrubber → mute → fullscreen
- `Space` (on player) — toggle play/pause
- `←` / `→` (on scrubber) — seek ±5s
- `M` — toggle mute
- `F` — toggle fullscreen

## Player controls (user-facing)

- Click the big play overlay or the video itself to toggle play/pause.
- Drag the scrubber to seek; click anywhere on the scrubber to jump to that time.
- `←` / `→` on the focused scrubber seek ±5 seconds.
- The mute button is sticky across cards and pages (stored in `localStorage` under `aug:mute`).
- The fullscreen button enters browser fullscreen on the player wrapper.
- Hovering the scrubber shows a time tooltip at the cursor position.

## Theming

Both pages share the same player class. Only the values of the CSS tokens in `:root` differ between `styles.css` (dark) and `styles1.css` (light). Adding a new visual treatment means adding a new token here first, then consuming it in both stylesheets.
