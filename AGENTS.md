# Agent instructions

## Imperative APIs first

When adding any new drawable, paint, or effect: design the imperative path
first — which props get value slots, what the wire format carries, what a
worklet write costs — then wrap the declarative component over it. Never ship a
declarative API whose animatable props only work via scene re-encode. See
[#204](https://github.com/riteshshukla04/react-native-tgfx/issues/204) for the
backlog of gaps this rule exists to prevent.

## Performance — no compromise

- Slot patches happen **in native**, on the render thread, from a flat buffer.
- Slot writes must be **worklet-safe** (work while the JS thread is blocked).
- No per-frame JS allocations: bulk data goes through a pre-allocated shared
  `ArrayBuffer`.
- Re-encode is the fallback, never the design. An animatable prop that only
  re-encodes is not done.

## Housekeeping

- Every public-surface change updates `docs/content/docs` and, when the wire
  format moves, `packages/react-native-tgfx/docs/wire-format.md`.
- A `SCENE_VERSION` bump requires a native rebuild — a blank canvas or an
  "unexpected header" error means a stale APK, not a render bug.
- Never switch git branches from an agent while a device build is live.
