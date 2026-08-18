// The #204 surface: every write here is a slot patch — no re-encode, no React.
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text as RNText, View } from 'react-native';
import { useFrameCallback, useSharedValue } from 'react-native-reanimated';
import {
  Atlas,
  Canvas,
  Circle,
  createHandle,
  LinearGradient,
  DropShadow,
  Image,
  Path,
  Rect,
  RoundedRect,
  Text,
  useImage,
  useNode,
  useSpriteBuffer,
} from 'react-native-tgfx';

const sheet = require('./assets/sprites.png');
const sampleA = require('./assets/sample.png');
const sampleB = require('./assets/tile.png');

const W = 350;

/** A timer readout re-shaped natively per tick: `set({ text })`, no re-encode. */
function LiveText() {
  const label = useNode();
  const started = useRef(Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      const seconds = (Date.now() - started.current) / 1000;
      label.set({ text: `${seconds.toFixed(1)}s` });
    }, 100);
    return () => clearInterval(id);
  }, [label]);
  return (
    <Text ref={label} x={12} y={44} fontSize={36} text="0.0s" color="#4F8EF7" />
  );
}

/** A wave whose points move per tick through `set({ path })`. */
function LivePath() {
  const wave = useNode();
  useEffect(() => {
    let phase = 0;
    const id = setInterval(() => {
      phase += 0.25;
      let d = 'M130 40';
      for (let x = 10; x <= 200; x += 10) {
        const y = 40 + Math.sin(phase + x / 22) * 18;
        d += ` L${130 + x} ${y.toFixed(1)}`;
      }
      wave.set({ path: d });
    }, 33);
    return () => clearInterval(id);
  }, [wave]);
  return (
    <Path
      ref={wave}
      path="M130 40 L330 40"
      style="stroke"
      strokeWidth={3}
      color="#FF9500"
    />
  );
}

/** Press feedback on a shadow: `set({ blur, dy })` patches the filter params. */
function GlowCard() {
  const glow = useNode();
  return (
    <Pressable
      onPressIn={() => glow.set({ blur: 16, dy: 10 })}
      onPressOut={() => glow.set({ blur: 4, dy: 3 })}
    >
      <Canvas style={{ width: W, height: 90 }}>
        <RoundedRect x={16} y={12} width={150} height={56} r={14} color="#1c1c1e">
          <DropShadow dx={0} dy={3} blur={4} color="#4F8EF7" ref={glow} />
        </RoundedRect>
        <Text x={40} y={47} fontSize={16} text="press me" color="#fff" />
        <GradientBar />
      </Canvas>
    </Pressable>
  );
}

/** A gradient whose endpoint sweeps through `set({ end })` on the fade's ref. */
function GradientBar() {
  const fade = useNode();
  useEffect(() => {
    let t = 0;
    const id = setInterval(() => {
      t += 0.08;
      fade.set({ end: { x: 210 + Math.sin(t) * 120, y: 0 } });
    }, 33);
    return () => clearInterval(id);
  }, [fade]);
  return (
    <Rect x={190} y={12} width={144} height={56}>
      <LinearGradient
        ref={fade}
        start={{ x: 190, y: 0 }}
        end={{ x: 334, y: 0 }}
        colors={['#FF3B30', '#4F8EF7']}
      />
    </Rect>
  );
}

/** `set({ image })` re-points the node at other pixels; `style` flips by enum slot. */
function SwapAndEnums() {
  const pic = useNode();
  const box = useNode();
  const imageA = useImage(sampleA);
  const imageB = useImage(sampleB);
  // Refs, not state: a re-render would recommit the JSX, and the commit wins.
  const which = useRef(false);
  const stroked = useRef(false);
  return (
    <View>
      <Canvas style={{ width: W, height: 90 }}>
        <Image
          ref={pic}
          x={12}
          y={8}
          width={110}
          height={72}
          image={imageA}
          fit="cover"
        />
        <RoundedRect
          ref={box}
          x={150}
          y={12}
          width={110}
          height={60}
          r={10}
          color="#34C759"
          strokeWidth={5}
        />
      </Canvas>
      <View style={styles.row}>
        <Pressable
          style={styles.button}
          onPress={() => {
            which.current = !which.current;
            const image = which.current ? imageB : imageA;
            if (image != null) {
              pic.set({ image });
            }
          }}
        >
          <RNText style={styles.buttonText}>swap image</RNText>
        </Pressable>
        <Pressable
          style={styles.button}
          onPress={() => {
            stroked.current = !stroked.current;
            box.set({ style: stroked.current ? 'stroke' : 'fill' });
          }}
        >
          <RNText style={styles.buttonText}>fill / stroke</RNText>
        </Pressable>
      </View>
    </View>
  );
}

const POOL = 12;

/** The pool pattern: mounted nodes toggled by their `visible` slot. */
function VisiblePool() {
  // createHandle, not useNode: a pool wants N handles from one hook-free factory.
  const refs = useRef(
    Array.from({ length: POOL }, () => createHandle())
  ).current;
  const alive = useRef(0);
  return (
    <View>
      <Canvas style={{ width: W, height: 70 }}>
        {refs.map((ref, i) => (
          <Circle
            key={i}
            ref={ref}
            cx={22 + i * 28}
            cy={35}
            r={11}
            visible={false}
            color="#AF52DE"
          />
        ))}
      </Canvas>
      <View style={styles.row}>
        <Pressable
          style={styles.button}
          onPress={() => {
            if (alive.current < POOL) {
              refs[alive.current]!.set({ visible: true });
              alive.current++;
            }
          }}
        >
          <RNText style={styles.buttonText}>spawn</RNText>
        </Pressable>
        <Pressable
          style={styles.button}
          onPress={() => {
            if (alive.current > 0) {
              alive.current--;
              refs[alive.current]!.set({ visible: false });
            }
          }}
        >
          <RNText style={styles.buttonText}>despawn</RNText>
        </Pressable>
      </View>
    </View>
  );
}

const PARTICLES = 120;

/** Shared sprite buffer: a worklet writes 120 sprites per frame, zero JS objects. */
function ParticleField() {
  const atlas = useImage(sheet);
  const sprites = useSpriteBuffer(PARTICLES);
  const count = useSharedValue(PARTICLES);
  const seeds = useRef(
    Array.from({ length: PARTICLES }, (_, i) => ({
      speed: 18 + ((i * 37) % 40),
      lane: (i * 61) % 320,
      row: (i % 4) * 32,
      size: 0.35 + ((i * 13) % 10) / 18,
    }))
  ).current;
  useFrameCallback(frame => {
    'worklet';
    const t = (frame.timeSinceFirstFrame ?? 0) / 1000;
    for (let i = 0; i < PARTICLES; i++) {
      const seed = seeds[i]!;
      const y = (seed.lane + t * seed.speed) % 130;
      sprites.set(i, seed.row, 0, 32, 32, seed.size, 15 + ((i * 89) % 320), y);
    }
    count.value = PARTICLES;
  });
  return (
    <Canvas style={{ width: W, height: 120 }}>
      <Rect x={0} y={0} width={W} height={120} color="#101014" />
      <Atlas image={atlas} buffer={sprites} count={count} />
    </Canvas>
  );
}

export function ImperativeSlotsSection() {
  return (
    <View style={styles.section}>
      <RNText style={styles.sectionLabel}>
        Imperative slots (#204) — live text + path (string slots)
      </RNText>
      <Canvas style={{ width: W, height: 80 }}>
        <LiveText />
        <LivePath />
      </Canvas>
      <RNText style={styles.sectionLabel}>
        Filter params + gradient geometry, patched per frame
      </RNText>
      <GlowCard />
      <RNText style={styles.sectionLabel}>
        Image swap + enum slots via handle.set
      </RNText>
      <SwapAndEnums />
      <RNText style={styles.sectionLabel}>
        Pool pattern — visible slots, no commits
      </RNText>
      <VisiblePool />
      <RNText style={styles.sectionLabel}>
        Shared sprite buffer — 120 particles, zero JS allocations per frame
      </RNText>
      <ParticleField />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 24 },
  sectionLabel: {
    color: '#8E8E93',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 12,
  },
  row: { flexDirection: 'row', gap: 12, marginTop: 8 },
  button: {
    backgroundColor: '#2c2c2e',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  buttonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
});
