// The JS path utilities: boolean ops, tight bounds, hit tests and measurement along a curve.
import { useState } from 'react';
import { Text as RNText, StyleSheet, View } from 'react-native';
import {
  Canvas,
  Circle,
  Group,
  Path,
  Rect,
  pathBounds,
  pathContains,
  pathLength,
  pathOp,
  pathPointAtLength,
  pathSegment,
  pathTransform,
} from 'react-native-tgfx';

const PLATE = 'M10 10 L100 10 L100 100 L10 100 Z';
const DISC =
  'M55 30 C69 30 80 41 80 55 C80 69 69 80 55 80 C41 80 30 69 30 55 C30 41 41 30 55 30 Z';
const ROUTE = 'M12 80 q60 -70 110 0 t100 -10';
const ARCH = 'M20 90 C20 10 100 10 100 90';

export function PathSection() {
  const holed = pathOp(PLATE, DISC, 'difference');
  const lens = pathOp(PLATE, DISC, 'intersect');
  const both = pathOp(PLATE, DISC, 'union');

  const routeLength = pathLength(ROUTE);
  const [cut, setCut] = useState(0.6);
  const head = pathPointAtLength(ROUTE, routeLength * cut);

  // A cubic whose control points sit 20px above the ink, so the two boxes differ visibly.
  const arch = pathTransform(ARCH, [1, 0, 0, 1, 20, 0]);
  const tight = pathBounds(arch, true);
  const loose = pathBounds(arch);

  return (
    <>
      <Panel label="pathOp — difference · intersect · union" height={120}>
        <Path path={holed} color="#4F8EF7" />
        <Group transform={[{ translateX: 115 }]}>
          <Path path={lens} color="#34C759" />
        </Group>
        <Group transform={[{ translateX: 230 }]}>
          <Path path={both} color="#AF52DE" />
        </Group>
      </Panel>

      <Panel label="pathBounds — tight (orange) vs control-point (grey)" height={110}>
        <Rect
          x={loose.x}
          y={loose.y}
          width={loose.width}
          height={loose.height}
          color="#C7C7CC"
          style="stroke"
          strokeWidth={1}
        />
        <Rect
          x={tight.x}
          y={tight.y}
          width={tight.width}
          height={tight.height}
          color="#FF9500"
          style="stroke"
          strokeWidth={1}
        />
        <Path path={arch} color="#0A84FF" style="stroke" strokeWidth={4} />
      </Panel>

      <Panel label={`pathSegment + pathPointAtLength — ${Math.round(cut * 100)}% along`} height={120}>
        <Path path={ROUTE} color="#E5E5EA" style="stroke" strokeWidth={6} strokeCap="round" />
        <Path
          path={pathSegment(ROUTE, 0, routeLength * cut)}
          color="#0A84FF"
          style="stroke"
          strokeWidth={6}
          strokeCap="round"
        />
        <Circle cx={head.x} cy={head.y} r={7} color="#FF3B30" />
        <Group
          transform={[
            { translateX: head.x },
            { translateY: head.y },
            { rotate: head.angle },
          ]}>
          <Path path="M0 -3 L14 0 L0 3 Z" color="#FF3B30" />
        </Group>
      </Panel>

      <RNText style={styles.note} onPress={() => setCut(cut >= 0.95 ? 0.1 : cut + 0.15)}>
        {`tap to advance · length ${routeLength.toFixed(1)} · centre of the plate is ${
          pathContains(holed, 55, 55) ? 'inside' : 'punched out'
        }`}
      </RNText>
    </>
  );
}

function Panel({
  label,
  children,
  height,
}: {
  label: string;
  children: React.ReactNode;
  height: number;
}) {
  return (
    <View style={styles.section}>
      <RNText style={styles.sectionLabel}>{label}</RNText>
      <Canvas style={[styles.canvas, { height }]}>{children}</Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 16, paddingBottom: 18 },
  sectionLabel: { fontSize: 13, color: '#6b6b6f', marginBottom: 6 },
  canvas: { width: '100%', backgroundColor: '#fff', borderRadius: 12 },
  note: { fontSize: 12, color: '#6b6b6f', paddingHorizontal: 16, paddingBottom: 18 },
});
