# Hyperframes Composition Brief: react-native-tgfx

## Objective
One-minute cinematic launch trailer for react-native-tgfx.

## Output
- Composition: brag-output/composition/
- Render: brag-output/brag.mp4
- Landscape 1920x1080, 60s, 30fps

## Source material
- Project: react-native-tgfx (packages/react-native-tgfx), docs site docs/
- Files read: docs/app/global.css, docs/components/hero.tsx, docs/content/docs/performance.mdx, package.json
- Device captures (user supplied): chrome TGFX melt/explode/fall, physics ramp, camera face liquify
- Verbatim copy: "Animate on the thread that paints." / "A declarative GPU 2D canvas for React Native." / benchmark numbers from performance.mdx (react-native-skia 3.8.1, Samsung SM-E146B, 90 Hz)

## Creative direction
- Tone: cinematic, game-engine launch trailer
- Spine: procedural particle sphere inspired by sphere-waves (own maths: ripple travelling from the pole, depth-sorted, copper↔blue by depth), morphing into wordmark and bars
- Avoid: generic SaaS lines, waveform visuals, claims not in the docs

## Visual identity
Background #0d1017, text #e6eaf2, muted #8b93a5, copper #d98a4a, blue #6aa9ff. Geist / Geist Mono.

## Storyboard
See brag-plan.md (8 scenes, 60s).

## Audio
- Music: assets/music/happy-beats-business-moves-vol-10-by-ende-dot-app.mp3, volume 0.4, fade out last 1.5s
- Cues: <skill-dir>/assets/music/cues/happy-beats-business-moves-vol-10-by-ende-dot-app.music-cues.json
- Audio-reactive: bass → sphere dot radius and glow (subtle)
- SFX: impactSoft_medium on bloom/cuts, impactBell_heavy on wordmark + outro, glitch on explode, drop/click on bench rows. Guidance: <skill-dir>/assets/sfx/sfx-analysis.md
