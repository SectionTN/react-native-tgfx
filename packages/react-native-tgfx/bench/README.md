# Engine micro-benchmark + performance regression gate

Proves (and guards) the core performance property of the native engine: the
scene is compiled **once** per change instead of re-parsed every frame.

```bash
bash packages/react-native-tgfx/bench/run.sh
```

It generates representative scenes via the **real** reconciler/compiler
(`generate-scenes.ts`), then runs `engine-bench.cpp` for 100 rounds × 500 frames,
comparing two implementations that do **identical logical work** (same field
reads + transform math) and differ only in data access:

- **OLD** — `json::parse` the scene + walk it every frame (the pre-refactor hot path)
- **NEW** — compile once into a flat command list, then per-frame resolve only the
  animated value slots (the current engine)

The GPU draw is identical between the two, so it is intentionally excluded — the
ratio isolates exactly the compile-once optimization.

### Representative results (Apple Silicon, clang -O2)

| Scene | OLD / frame | NEW / frame | Speedup |
|---|---|---|---|
| Heavy (120-circle spiral, 15.7 KB) | ~195 µs | ~0.7 µs | ~270–300× |
| Full (mixed, ~30 nodes) | ~19 µs | ~0.06 µs | ~290–350× |
| Animated (4 live slots) | ~11 µs | ~0.05 µs | ~210–220× |

### Regression gate

`engine-bench` exits non-zero if NEW per-frame time or the speedup regresses past
the thresholds in `main()` (e.g. heavy: NEW ≤ 5 µs and speedup ≥ 50×). Wire it
into CI to catch anyone re-introducing per-frame parsing.
