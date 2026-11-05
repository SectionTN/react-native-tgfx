# tgfx vs skia 3.8.1 - full matrix, moto g35 (120 Hz)

moto g35 5G (Unisoc T760, Mali-G57), Android 15, refresh locked at 120 Hz. Release build
at 3e5157f, `react-native-skia@3.8.1`. `--order alternate --reps 2 --gap 30`. CPU clusters
uncapped (screen on) before the run, thermal status 1 throughout. Parity stills checked.

Present FPS per rep (tgfx / skia): shapes 53.4, 53.4 / 22.6, 22.3 - images 118.6, 118.9 /
76.4, 73.3 - shader 20.5, 20.5 / 13.1, 12.9 - pattern 119.0, 118.8 / 117.5, 117.4 - paths
111.0, 109.0 / 73.1, 76.5 - text 43.1, 43.3 / 25.1, 24.1.

CPU % here leaves out the `--gap` idle seconds (the runner dropped samples after the app's
`cool` line).


| engine · scene | Present FPS | UI FPS | JS FPS | CPU % (1 core = 100) | PSS MB | thermal | ticks |
|---|---|---|---|---|---|---|---|
| tgfx · shapes | 53.4 | 120 | 119 | 279 | 329.4 | 1 | 52 |
| skia · shapes | 22.4 | 119 | 119 | 148 | 305.6 | 1 | 51 |
| tgfx · images | 118.8 | 120 | 119 | 162 | 301.2 | 1 | 51 |
| skia · images | 74.8 | 120 | 119 | 161 | 295.2 | 1 | 51 |
| tgfx · shader | 20.5 | 120 | 119 | 26 | 295.8 | 1 | 51 |
| skia · shader | 13.0 | 120 | 119 | 28 | 292.8 | 1 | 51 |
| tgfx · pattern | 118.9 | 120 | 119 | 59 | 294.3 | 1 | 51 |
| skia · pattern | 117.4 | 120 | 119 | 76 | 293.7 | 1 | 51 |
| tgfx · paths | 110.0 | 120 | 119 | 126 | 310.6 | 1 | 51 |
| skia · paths | 74.8 | 120 | 119 | 118 | 298.9 | 1 | 51 |
| tgfx · text | 43.2 | 120 | 119 | 218 | 324.4 | 1 | 51 |
| skia · text | 24.6 | 120 | 119 | 145 | 319.4 | 1 | 51 |

`thermal` is the highest Android thermal status (0 none … 3 severe) seen at the start of the combo's runs.

## Where the CPU and memory go

| engine · scene | UI thread % | JS thread % | busiest other threads % | Graphics MB | Native MB | Java MB |
|---|---|---|---|---|---|---|
| tgfx · shapes | 13 | 3 | TgfxRender 211, nitro-thread 38, binder 6 | 56.6 | 139.8 | 5.5 |
| skia · shapes | 16 | 3 | RNSkia Render 94, RNSkia Present 22, binder 6 | 47.5 | 115.4 | 5.4 |
| tgfx · images | 12 | 3 | TgfxRender 109, nitro-thread 16, binder 9 | 47.7 | 95.6 | 5.4 |
| skia · images | 14 | 3 | RNSkia Render 91, RNSkia Present 39, binder 9 | 46.7 | 89.2 | 5.6 |
| tgfx · shader | 10 | 3 | binder 6, TgfxRender 5, mali-cmar-backe 2 | 51.6 | 86.7 | 5.3 |
| skia · shader | 12 | 3 | binder 6, RNSkia Present 4, RNSkia Render 2 | 46.8 | 85.0 | 5.4 |
| tgfx · pattern | 12 | 3 | TgfxRender 27, binder 9, mali-cmar-backe 7 | 47.7 | 84.9 | 5.4 |
| skia · pattern | 12 | 3 | RNSkia Present 32, binder 10, RNSkia Render 9 | 46.6 | 84.7 | 5.8 |
| tgfx · paths | 13 | 3 | TgfxRender 94, binder 11, mali-cmar-backe 8 | 52.0 | 89.9 | 5.4 |
| skia · paths | 12 | 3 | RNSkia Render 59, RNSkia Present 29, binder 8 | 47.8 | 85.5 | 5.8 |
| tgfx · text | 13 | 3 | TgfxRender 169, nitro-thread 25, binder 7 | 47.6 | 105.8 | 5.4 |
| skia · text | 12 | 3 | RNSkia Render 100, RNSkia Present 21, binder 7 | 46.7 | 94.3 | 5.4 |
