// <Group> clip, invertClip and layer: the three things that needed a saveLayer to be right.
import { Text as RNText, StyleSheet, View } from 'react-native';
import { Canvas, Circle, Group, TgfxImage, Line, Path, Rect, Text, useImage } from 'react-native-tgfx';

const SPOTLIGHT = 'M60 8 C90 8 108 32 108 56 C108 80 90 104 60 104 C30 104 12 80 12 56 C12 32 30 8 60 8 Z';

export function GroupSection() {
  const img = useImage(require('./assets/sample.png'));

  return (
    <>
      <Panel label="Group picture — a static grid recorded once, replayed every frame" height={130}>
        <Group picture>
          {[0, 1, 2, 3, 4, 5].map(i => (
            <Line
              key={`v${i}`}
              x1={12 + i * 56}
              y1={10}
              x2={12 + i * 56}
              y2={100}
              color="#d1d1d6"
              strokeWidth={1}
            />
          ))}
          {[0, 1, 2, 3].map(i => (
            <Line
              key={`h${i}`}
              x1={12}
              y1={10 + i * 30}
              x2={292}
              y2={10 + i * 30}
              color="#d1d1d6"
              strokeWidth={1}
            />
          ))}
          <Path
            path="M12 88 L68 60 L124 72 L180 34 L236 46 L292 20"
            color="#0a84ff"
            style="stroke"
            strokeWidth={3}
          />
          <Text x={12} y={118} text="recorded once" fontSize={11} color="#8e8e93" />
        </Group>
      </Panel>

      <Panel label="Group clip — rect · rounded · path" height={130}>
        {img != null && (
          <>
            <Group clip={{ x: 4, y: 4, width: 100, height: 110 }}>
              <TgfxImage x={4} y={4} width={100} height={110} image={img} fit="cover" />
            </Group>
            <Group clip={{ x: 118, y: 4, width: 100, height: 110, r: 24 }}>
              <TgfxImage x={118} y={4} width={100} height={110} image={img} fit="cover" />
            </Group>
            <Group clip={SPOTLIGHT} transform={[{ translateX: 232 }]}>
              <TgfxImage x={0} y={0} width={116} height={116} image={img} fit="cover" />
            </Group>
          </>
        )}
      </Panel>

      <Panel label="invertClip — the same shape, keeping the complement" height={130}>
        {img != null && (
          <>
            <Group clip={{ x: 20, y: 20, width: 70, height: 70, r: 18 }} invertClip>
              <TgfxImage x={4} y={4} width={110} height={110} image={img} fit="cover" />
            </Group>
            <Group clip={SPOTLIGHT} invertClip transform={[{ translateX: 130 }]}>
              <TgfxImage x={0} y={0} width={116} height={116} image={img} fit="cover" />
            </Group>
          </>
        )}
      </Panel>

      <Panel label="layer — overlap blends once (left) vs twice (right)" height={120}>
        <Group layer opacity={0.5}>
          <Circle cx={45} cy={55} r={34} color="#4F8EF7" />
          <Circle cx={90} cy={55} r={34} color="#4F8EF7" />
        </Group>
        <Group opacity={0.5} transform={[{ translateX: 190 }]}>
          <Circle cx={45} cy={55} r={34} color="#4F8EF7" />
          <Circle cx={90} cy={55} r={34} color="#4F8EF7" />
        </Group>
      </Panel>

      <Panel label="clip + layer together — the subtree is confined, then faded once" height={120}>
        <Group clip={{ x: 20, y: 10, width: 200, height: 100, r: 16 }} layer opacity={0.6}>
          <Rect x={20} y={10} width={110} height={100} color="#FF3B30" />
          <Rect x={100} y={10} width={140} height={100} color="#34C759" />
        </Group>
      </Panel>
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
  canvas: { backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden' },
});
