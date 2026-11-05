# tgfx vs skia 3.8.1 - full matrix, Samsung SM-E146B (90 Hz)

Samsung SM-E146B (Exynos 1330, Mali-G68), Android 15, refresh locked at 90 Hz. Release
build at 3e5157f, `react-native-skia@3.8.1`. `--order alternate --reps 2 --gap 30`. CPU
clusters uncapped before and after the run; thermal status read 2 at every combo start
(the skin sensor, clocks were not capped). Parity stills checked.

Present FPS per rep (tgfx / skia): shapes 49.9, 59.6 / 25.6, 25.4 - images 90.3, 90.3 /
71.9, 67.8 - shader 15.1, 15.0 / 9.3, 9.3 - pattern 90.3, 90.3 / 86.6, 87.8 - paths 90.0,
90.1 / 17.9, 18.0 - text 69.8, 69.0 / 38.1, 37.9.

CPU % here leaves out the `--gap` idle seconds (the runner dropped samples after the app's
`cool` line).


| engine · scene | Present FPS | UI FPS | JS FPS | CPU % (1 core = 100) | PSS MB | thermal | ticks |
|---|---|---|---|---|---|---|---|
| tgfx · shapes | 54.8 | 91 | 90 | 193 | 511.6 | 2 | 52 |
| skia · shapes | 25.5 | 91 | 90 | 103 | 568.3 | 2 | 51 |
| tgfx · images | 90.3 | 91 | 91 | 132 | 497.4 | 2 | 51 |
| skia · images | 69.8 | 91 | 91 | 121 | 498.6 | 2 | 51 |
| tgfx · shader | 15.1 | 91 | 91 | 25 | 510.4 | 2 | 51 |
| skia · shader | 9.3 | 91 | 91 | 26 | 479.8 | 2 | 51 |
| tgfx · pattern | 90.3 | 91 | 91 | 63 | 458.3 | 2 | 51 |
| skia · pattern | 87.2 | 91 | 91 | 74 | 431.9 | 2 | 51 |
| tgfx · paths | 90.1 | 91 | 91 | 82 | 466.0 | 2 | 51 |
| skia · paths | 17.9 | 91 | 91 | 49 | 505.9 | 2 | 51 |
| tgfx · text | 69.4 | 91 | 91 | 150 | 529.9 | 2 | 51 |
| skia · text | 38.0 | 91 | 90 | 135 | 605.8 | 2 | 51 |

`thermal` is the highest Android thermal status (0 none … 3 severe) seen at the start of the combo's runs.

## Where the CPU and memory go

| engine · scene | UI thread % | JS thread % | busiest other threads % | Graphics MB | Native MB | Java MB |
|---|---|---|---|---|---|---|
| tgfx · shapes | 7 | 3 | TgfxRender 153, nitro-thread 19, binder 8 | 248.1 | 158.5 | 6.1 |
| skia · shapes | 7 | 3 | RNSkia Render 60, RNSkia Present 24, binder 5 | 316.9 | 143.2 | 6.1 |
| tgfx · images | 8 | 3 | TgfxRender 84, nitro-thread 12, binder 8 | 255.0 | 136.2 | 6.1 |
| skia · images | 6 | 3 | RNSkia Render 63, RNSkia Present 37, binder 8 | 254.1 | 131.4 | 6.3 |
| tgfx · shader | 12 | 3 | binder 4, TgfxRender 4, mali-cmar-backe 1 | 269.4 | 127.4 | 6.1 |
| skia · shader | 12 | 3 | binder 5, RNSkia Present 4, RNSkia Render 1 | 241.1 | 124.6 | 6.1 |
| tgfx · pattern | 11 | 3 | TgfxRender 22, binder 11, mali-cmar-backe 10 | 224.5 | 119.8 | 6.1 |
| skia · pattern | 11 | 4 | RNSkia Present 26, binder 11, mali-cmar-backe 10 | 197.5 | 122.1 | 6.3 |
| tgfx · paths | 7 | 3 | TgfxRender 55, binder 10, mali-cmar-backe 5 | 225.0 | 128.1 | 6.0 |
| skia · paths | 12 | 3 | RNSkia Render 15, RNSkia Present 10, binder 5 | 260.8 | 126.9 | 6.1 |
| tgfx · text | 5 | 3 | TgfxRender 119, nitro-thread 8, binder 8 | 271.8 | 144.1 | 6.0 |
| skia · text | 6 | 2 | RNSkia Render 98, RNSkia Present 19, binder 6 | 331.2 | 138.3 | 6.1 |
