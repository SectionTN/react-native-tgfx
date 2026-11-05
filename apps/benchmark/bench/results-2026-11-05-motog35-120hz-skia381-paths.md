# tgfx vs skia 3.8.1 - paths (900 cubics, half stroked)

moto g35 5G (Unisoc T760, Mali-G57), Android 15, refresh locked at 120 Hz. Release build
at 3e5157f, `react-native-skia@3.8.1`. `--scenes paths --order alternate --reps 3 --gap 30`.
CPU clusters uncapped (screen on) before the run, thermal status 1 throughout.

Present FPS per rep: tgfx 111.5 / 110.1 / 112.3, skia 81.4 / 74.8 / 78.8.

The CPU % column is not valid for this run: `run.mjs` files samples from the 30 s
`--gap` idle under the combo that just ran. The per-thread split below comes from
mid-run snapshots and is unaffected.


| engine · scene | Present FPS | UI FPS | JS FPS | CPU % (1 core = 100) | PSS MB | thermal | ticks |
|---|---|---|---|---|---|---|---|
| tgfx · paths | 111.5 | 120 | 119 | 21 | 271.1 | 1 | 79 |
| skia · paths | 78.8 | 120 | 119 | 111 | 267.7 | 1 | 78 |

`thermal` is the highest Android thermal status (0 none … 3 severe) seen at the start of the combo's runs.

## Where the CPU and memory go

| engine · scene | UI thread % | JS thread % | busiest other threads % | Graphics MB | Native MB | Java MB |
|---|---|---|---|---|---|---|
| tgfx · paths | 14 | 3 | TgfxRender 93, binder 9, mali-cmar-backe 8 | 49.7 | 92.8 | 4.8 |
| skia · paths | 12 | 3 | RNSkia Render 61, RNSkia Present 29, binder 8 | 47.7 | 89.8 | 5.1 |
