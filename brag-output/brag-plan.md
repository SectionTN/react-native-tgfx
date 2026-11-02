# Brag Plan: react-native-tgfx

## What is this app?
A declarative GPU 2D canvas for React Native, backed by Tencent's tgfx and Nitro Modules, that animates on its own render thread.

## The angle
React Native drawing like a game engine. A living particle sphere (inspired by, not copied from, Enzo Manuel Mangano's sphere-waves: our own ripple-from-the-pole sphere, coloured by the docs' copper JS / blue native palette) is the video's spine. It blooms, becomes the wordmark, splits into threads, and becomes the benchmark bars. Real device captures carry the proof.

## Hook (0-4.4s)
One dot in the dark blooms into a rippling 2,000-dot sphere. Line: "What if React Native drew like a game engine?"

## Key moments
- Chrome "TGFX" 3D text melting, exploding into beads, then a diamond fall, full-bleed (real capture).
- Draw a ramp with a finger, balls roll into a bucket, counter climbs (real capture).
- Live camera face liquify with an "MNN 3.5 ms" pill (real capture).
- Benchmark vs react-native-skia 3.8.1: paths 90.3 vs 17.6 fps, shapes 60.5 vs 25.8, text 68.3 vs 34.4.

## Outro
Sphere returns, tightens into the Margelo mark glow. "react-native-tgfx" / "Animate on the thread that paints." / tgfx.margelo.com

## User flow worth showing
Pick a demo → touch it (draw ramp / switch Melt→Explode→Fall / switch face effect) → GPU result at full frame rate.

## Tone
- Preset: cinematic
- Creative direction: kickass game-engine launch trailer for a graphics library
- Interpretation: big type, hard beat-locked cuts on the drop, real footage held long enough to enjoy; copy is short and declarative.

## Format: landscape — 1920x1080
## Duration: 60s (user asked for a one-minute video; overrides the 15-25s default)

## Visual identity (from docs/app/global.css)
- Background: #0d1017 (black #000 under the chrome-text footage)
- Accent: copper #d98a4a (JS thread), blue #6aa9ff (native render thread)
- Text: #e6eaf2, muted #8b93a5
- Display/body font: Geist, mono Geist Mono
- Strongest visual element: giant faint "tgfx" wordmark from the hero

## Share copy (draft)
React Native, drawing like a game engine. react-native-tgfx renders on its own GPU thread: 5x skia on paths, melting chrome text, live face liquify.

## Audio direction
- Role: cinematic support, rhythmic layer on the drop
- Music: happy-beats-business-moves-vol-10 (60.0s, 110 BPM) — length matches exactly
- Treatment: in at 0.35, full through, natural ending at 60s with a short fade
- Music cue guidance: preset read. Strong cues 15.82, 18.01, 20.19, 22.92, 45.82, 50.19. Beat grid ~0.545s.
- Audio-reactive: subtle; bass drives sphere dot size and glow only.
- SFX posture: moderate, motion-matched; no SFX under dense footage beyond 1-2 accents.
- Restraint: no equalizer visuals, no SFX on every cut.

## Storyboard
1. Hook — 0-4.37 — sphere blooms from a dot; hook line. Audio: soft impact on bloom.
2. Reveal — 4.37-9.29 — sphere dots fly into giant "tgfx" letters; "react-native-tgfx" + "A GPU 2D canvas for React Native." Bell on wordmark lock.
3. Threads — 9.29-15.82 — "Animate on the thread that paints." JS lane stutters (copper), render lane steady (blue), sphere keeps spinning beside it.
4. Chrome text — 15.82-28.92 — full-bleed capture; Melt / Explode / Fall labels light up in sync. Explode beat-locked near 22.37-22.92.
5. Physics — 28.92-37.11 — phone with physics capture 3x; "Draw it. Physics does the rest."
6. Camera — 37.11-45.82 — phone with face liquify capture; "Live camera. On-device face mesh."
7. Benchmark — 45.82-52.37 — three rows, bars race (paths/shapes/text), beat-grid reveals every other beat.
8. Outro — 52.37-60 — sphere returns, name, tagline, URL, Margelo credit; fade.
