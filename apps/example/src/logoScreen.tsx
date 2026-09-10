// A screen of its own for the logos: one canvas, so every animating path shares
// a single surface instead of competing for slots on the one tgfx render thread.
// Each mark appears twice — waving as a fill, then drawing itself as a stroke.
import { useEffect } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import {
  cancelAnimation,
  Easing,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Canvas, Fill, Group, Path } from 'react-native-tgfx';
import { ICON, ICON_AMPLITUDE, ICON_VIEWBOX } from './iconPath';
import { AMPLITUDE, JELLYFISH, LOGO_VIEWBOX } from './logoPath';
import { wavePath } from './logoWave';

const MARGIN = 20;
const GAP = 14;
// Room for the tab bar under the canvas.
const TABS = 90;
// How the four rows divide the height that is left.
const SHARE = { logo: 0.4, logoTrace: 0.15, icon: 0.28, iconTrace: 0.17 };

export function LogoScreen() {
  const { width, height } = useWindowDimensions();
  const phase = useSharedValue(0);
  const drawn = useSharedValue(0);

  useEffect(() => {
    // A full 2π every cycle, so the restart lands on the shape it left.
    phase.value = withRepeat(
      withTiming(Math.PI * 2, { duration: 2200, easing: Easing.linear }),
      -1,
      false
    );
    drawn.value = withRepeat(
      withTiming(1, { duration: 3200, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
    return () => {
      cancelAnimation(phase);
      cancelAnimation(drawn);
    };
  }, [drawn, phase]);

  // String slots: the engine re-parses on the render thread, with no re-encode
  // and no React render per frame. One phase, so both marks ride the same wave.
  const logo = useDerivedValue(() => wavePath(JELLYFISH, phase.value, AMPLITUDE));
  const icon = useDerivedValue(() => wavePath(ICON, phase.value, ICON_AMPLITUDE));

  const usable = height - MARGIN * 2 - GAP * 3 - TABS;
  const room = width - MARGIN * 2;
  const fit = (box: { width: number; height: number }, share: number) =>
    Math.min(room / box.width, (usable * share) / box.height);

  const logoScale = fit(LOGO_VIEWBOX, SHARE.logo);
  const logoTraceScale = fit(LOGO_VIEWBOX, SHARE.logoTrace);
  const iconScale = fit(ICON_VIEWBOX, SHARE.icon);
  const iconTraceScale = fit(ICON_VIEWBOX, SHARE.iconTrace);

  const rows = [
    { y: MARGIN, h: LOGO_VIEWBOX.height * logoScale, w: LOGO_VIEWBOX.width * logoScale },
    { y: 0, h: LOGO_VIEWBOX.height * logoTraceScale, w: LOGO_VIEWBOX.width * logoTraceScale },
    { y: 0, h: ICON_VIEWBOX.height * iconScale, w: ICON_VIEWBOX.width * iconScale },
    { y: 0, h: ICON_VIEWBOX.height * iconTraceScale, w: ICON_VIEWBOX.width * iconTraceScale },
  ];
  for (let r = 1; r < rows.length; r++) {
    rows[r]!.y = rows[r - 1]!.y + rows[r - 1]!.h + GAP;
  }
  const centre = (w: number) => (width - w) / 2;

  return (
    <View style={styles.root}>
      <Canvas style={styles.canvas}>
        <Fill color="#0b0b0f" />

        <Group
          transform={[
            { translate: [centre(rows[0]!.w), rows[0]!.y] },
            { scale: logoScale },
          ]}
        >
          <Path path={logo} color="#ffffff" />
        </Group>

        <Group
          transform={[
            { translate: [centre(rows[1]!.w), rows[1]!.y] },
            { scale: logoTraceScale },
          ]}
        >
          <Path
            path={JELLYFISH.rest}
            end={drawn}
            color="#34C759"
            style="stroke"
            strokeWidth={6}
            strokeCap="round"
            strokeJoin="round"
          />
        </Group>

        <Group
          transform={[{ translate: [centre(rows[2]!.w), rows[2]!.y] }, { scale: iconScale }]}
        >
          <Path path={icon} color="#4F8EF7" />
        </Group>

        <Group
          transform={[
            { translate: [centre(rows[3]!.w), rows[3]!.y] },
            { scale: iconTraceScale },
          ]}
        >
          <Path
            path={ICON.rest}
            end={drawn}
            color="#FF9F0A"
            style="stroke"
            strokeWidth={6}
            strokeCap="round"
            strokeJoin="round"
          />
        </Group>
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0b0f' },
  canvas: { flex: 1 },
});
