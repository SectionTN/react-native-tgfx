// Port of rimax200's Skia physics demo: balls rain onto the lines you draw, and
// the eraser burns a line away from the touch, shedding dust, and a bucket at
// the bottom counts what it catches. Balls and dust are one atlas over a baked
// sprite sheet; every line is one path slot.
import { useState } from 'react';
import {
  Dimensions,
  Pressable,
  StyleSheet,
  Text as RNText,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import {
  Atlas,
  Canvas,
  Circle,
  DropShadow,
  Fill,
  Group,
  Path,
  RoundedRect,
  Text,
  useNode,
  useOffscreenImage,
  useSpriteBuffer,
} from 'react-native-tgfx';

const BALL_COLORS = [
  '#9AAFA9',
  '#B1A49D',
  '#A9B7C5',
  '#C7B7A6',
  '#B7C7A8',
  '#D2B8B5',
  '#A8B6AD',
  '#C4C8B6',
  '#B8ADC9',
  '#D4C3A5',
  '#B7F0AD',
  '#C8B8B2',
  '#D4A04C',
  '#DD84B0',
  '#3B8177',
  '#36B77E',
  '#89B4E6',
];

const BG = '#F3F6F4';
const LINE_COLOR = '#7F948D';
const GRAVITY = 420;
const SPAWN_INTERVAL = 840;
const MAX_BALLS = 26;
const MAX_SPEED = 0.92;
const WALL_BOUNCE = 0.82;
const LINE_BOUNCE = 0.24;
const LINE_FRICTION = 0.988;
const BALL_BOUNCE = 0.86;
const LINE_WIDTH = 13;
const MIN_POINT_DISTANCE = 5;
const ERASE_ACCELERATION = 1950;
const ERASE_MAX_SPEED = 1196;
const ERASER_RADIUS = 28;
const DUST_STEP = 6;
const DUST_GRAVITY = 105;
const MAX_DUST = 480;
const BUCKET_W = 150;
const BUCKET_H = 110;
const BUCKET_MARGIN = 28;
// Sprite sheet: one ball cell per colour at the largest radius, then a row of dust dots fading in steps.
const BALL_R = 20;
const CELL = 80;
const DUST_R = 2;
const DUST_CELL = 8;
const DUST_STEPS = 8;
const PR = 2;
const CAPACITY = MAX_BALLS + MAX_DUST;
const WIN = Dimensions.get('window');

type Ball = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: number;
};

type Dust = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  age: number;
  life: number;
};

type Line = {
  pts: number[];
  lens: number[];
  total: number;
  origin: number;
  radius: number;
  speed: number;
  lastDust: number;
  eroded: boolean;
  dust: Dust[];
};

type World = {
  balls: Ball[];
  lines: Line[];
  current: Line | null;
  lastSpawn: number;
  caught: number;
  shown: number;
  dirty: boolean;
};

function bucketRect(width: number, height: number) {
  'worklet';
  const left = (width - BUCKET_W) / 2;
  const bottom = height - BUCKET_MARGIN;
  return { left, right: left + BUCKET_W, top: bottom - BUCKET_H, bottom };
}

function bucketPath(width: number, height: number) {
  const { left, right, top, bottom } = bucketRect(width, height);
  return (
    `M${left} ${top} L${right} ${top} L${right} ${bottom - 16} ` +
    `Q${right} ${bottom} ${right - 16} ${bottom} L${left + 16} ${bottom} ` +
    `Q${left} ${bottom} ${left} ${bottom - 16} Z`
  );
}

function clamp(v: number, lo: number, hi: number) {
  'worklet';
  return v < lo ? lo : v > hi ? hi : v;
}

function rand(min: number, max: number) {
  'worklet';
  return min + Math.random() * (max - min);
}

function pointAt(line: Line, distance: number) {
  'worklet';
  const { pts, lens } = line;
  const target = clamp(distance, 0, line.total);
  for (let i = 1; i < lens.length; i++) {
    if (lens[i]! < target) {
      continue;
    }
    const seg = lens[i]! - lens[i - 1]!;
    const ax = pts[i * 2 - 2]!;
    const ay = pts[i * 2 - 1]!;
    const dx = pts[i * 2]! - ax;
    const dy = pts[i * 2 + 1]! - ay;
    const t = seg <= 0 ? 0 : (target - lens[i - 1]!) / seg;
    return {
      x: ax + dx * t,
      y: ay + dy * t,
      tx: seg <= 0 ? 1 : dx / seg,
      ty: seg <= 0 ? 0 : dy / seg,
    };
  }
  const n = pts.length;
  const p = n >= 4 ? n - 4 : 0;
  const x = pts[n - 2]!;
  const y = pts[n - 1]!;
  const len = Math.max(Math.hypot(x - pts[p]!, y - pts[p + 1]!), 1);
  return { x, y, tx: (x - pts[p]!) / len, ty: (y - pts[p + 1]!) / len };
}

function addLine(w: World, x: number, y: number) {
  'worklet';
  const line: Line = {
    pts: [x, y],
    lens: [0],
    total: 0,
    origin: -1,
    radius: 0,
    speed: 0,
    lastDust: 0,
    eroded: false,
    dust: [],
  };
  w.lines.push(line);
  w.current = line;
  w.dirty = true;
}

function addPoint(w: World, x: number, y: number) {
  'worklet';
  const line = w.current;
  if (line === null) {
    return;
  }
  const n = line.pts.length;
  const d = Math.hypot(x - line.pts[n - 2]!, y - line.pts[n - 1]!);
  if (d < MIN_POINT_DISTANCE) {
    return;
  }
  line.pts.push(x, y);
  line.total += d;
  line.lens.push(line.total);
  w.dirty = true;
}

function finishLine(w: World) {
  'worklet';
  const line = w.current;
  if (line !== null && line.total < 18) {
    const at = w.lines.indexOf(line);
    if (at >= 0) {
      w.lines.splice(at, 1);
      w.dirty = true;
    }
  }
  w.current = null;
}

function hitDistance(line: Line, x: number, y: number) {
  'worklet';
  const { pts, lens } = line;
  const reach = ERASER_RADIUS + LINE_WIDTH / 2;
  let best = -1;
  let bestScore = Infinity;
  for (let i = 1; i < lens.length; i++) {
    const ax = pts[i * 2 - 2]!;
    const ay = pts[i * 2 - 1]!;
    const dx = pts[i * 2]! - ax;
    const dy = pts[i * 2 + 1]! - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq <= 0.001) {
      continue;
    }
    const t = clamp(((x - ax) * dx + (y - ay) * dy) / lenSq, 0, 1);
    const score = Math.hypot(x - ax - dx * t, y - ay - dy * t);
    if (score <= reach && score < bestScore) {
      bestScore = score;
      best = lens[i - 1]! + Math.sqrt(lenSq) * t;
    }
  }
  return best;
}

function eraseAt(w: World, x: number, y: number) {
  'worklet';
  for (let i = 0; i < w.lines.length; i++) {
    const line = w.lines[i]!;
    if (line.eroded || line.origin >= 0) {
      continue;
    }
    const hit = hitDistance(line, x, y);
    if (hit >= 0) {
      line.origin = hit;
      line.radius = 0;
      line.speed = 0;
      line.lastDust = 0;
    }
  }
}

function spawnDust(line: Line, distance: number, direction: number) {
  'worklet';
  if (distance < 0 || distance > line.total) {
    return;
  }
  const p = pointAt(line, distance);
  const side = Math.random() > 0.5 ? 1 : -1;
  const nx = -p.ty * side;
  const ny = p.tx * side;
  const speed = rand(14, 46);
  const drift = rand(20, 68);
  line.dust.push({
    x: p.x + nx * 1.2,
    y: p.y + ny * 1.2,
    vx: p.tx * direction * drift + nx * speed,
    vy: p.ty * direction * drift + ny * speed - rand(0, 32),
    r: rand(0.45, 1.4),
    age: 0,
    life: rand(520, 940),
  });
}

function updateLines(w: World, dt: number) {
  'worklet';
  for (let i = w.lines.length - 1; i >= 0; i--) {
    const line = w.lines[i]!;
    if (line.origin >= 0 && !line.eroded) {
      line.speed = clamp(line.speed + ERASE_ACCELERATION * dt, 0, ERASE_MAX_SPEED);
      line.radius += line.speed * dt;
      const from = line.lastDust;
      const to = line.radius;
      const start = Math.floor(from / DUST_STEP) * DUST_STEP;
      const end = Math.ceil(to / DUST_STEP) * DUST_STEP;
      for (let r = start; r <= end && line.total > 0; r += DUST_STEP) {
        if (r > from && r <= to) {
          spawnDust(line, line.origin - r, -1);
          spawnDust(line, line.origin + r, 1);
        }
      }
      line.lastDust = to;
      if (to > Math.max(line.origin, line.total - line.origin) + 16) {
        line.eroded = true;
      }
      w.dirty = true;
    }
    const dust = line.dust;
    for (let j = dust.length - 1; j >= 0; j--) {
      const d = dust[j]!;
      d.age += dt * 1000;
      d.vy += DUST_GRAVITY * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.age >= d.life) {
        dust.splice(j, 1);
      }
    }
    if (line.eroded && dust.length === 0) {
      w.lines.splice(i, 1);
    }
  }
}

function spawnBall(w: World, width: number, now: number) {
  'worklet';
  if (
    w.balls.length >= MAX_BALLS ||
    (w.lastSpawn > 0 && now - w.lastSpawn < SPAWN_INTERVAL)
  ) {
    return;
  }
  const r = rand(13, 20);
  w.balls.push({
    x: rand(r, Math.max(width - r, r)),
    y: -r * 2,
    vx: rand(-42, 42),
    vy: 0,
    r,
    color: Math.floor(Math.random() * BALL_COLORS.length),
  });
  w.lastSpawn = now;
}

function collideSegment(
  b: Ball,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  maxSpeed: number,
) {
  'worklet';
  const threshold = b.r + LINE_WIDTH / 2;
  if (
    b.x < Math.min(ax, bx) - threshold ||
    b.x > Math.max(ax, bx) + threshold ||
    b.y < Math.min(ay, by) - threshold ||
    b.y > Math.max(ay, by) + threshold
  ) {
    return;
  }
  const sx = bx - ax;
  const sy = by - ay;
  const lenSq = sx * sx + sy * sy;
  if (lenSq <= 0.001) {
    return;
  }
  const len = Math.sqrt(lenSq);
  const t = clamp(((b.x - ax) * sx + (b.y - ay) * sy) / lenSq, 0, 1);
  const dx = b.x - ax - sx * t;
  const dy = b.y - ay - sy * t;
  const distSq = dx * dx + dy * dy;
  if (distSq > threshold * threshold) {
    return;
  }
  const dist = Math.sqrt(Math.max(distSq, 0.0001));
  let nx = dx / dist;
  let ny = dy / dist;
  if (dist < 0.01) {
    nx = -sy / len;
    ny = sx / len;
    if (b.vx * nx + b.vy * ny > 0) {
      nx = -nx;
      ny = -ny;
    }
  }
  const penetration = threshold - dist;
  b.x += nx * penetration;
  b.y += ny * penetration;
  const vn = b.vx * nx + b.vy * ny;
  if (vn < 0) {
    const vx = b.vx - (1 + LINE_BOUNCE) * vn * nx;
    const vy = b.vy - (1 + LINE_BOUNCE) * vn * ny;
    const tx = sx / len;
    const ty = sy / len;
    const vt = (vx * tx + vy * ty) * LINE_FRICTION;
    const vn2 = vx * nx + vy * ny;
    b.vx = clamp(tx * vt + nx * vn2, -maxSpeed, maxSpeed);
    b.vy = clamp(ty * vt + ny * vn2, -maxSpeed, maxSpeed);
  }
}

function collideLine(b: Ball, line: Line, maxSpeed: number) {
  'worklet';
  if (line.eroded) {
    return;
  }
  const { pts, lens } = line;
  const start = clamp(line.origin - line.radius, 0, line.total);
  const end = clamp(line.origin + line.radius, 0, line.total);
  for (let i = 1; i < lens.length; i++) {
    const ax = pts[i * 2 - 2]!;
    const ay = pts[i * 2 - 1]!;
    const bx = pts[i * 2]!;
    const by = pts[i * 2 + 1]!;
    const from = lens[i - 1]!;
    const to = lens[i]!;
    if (line.origin < 0 || to <= start || from >= end) {
      collideSegment(b, ax, ay, bx, by, maxSpeed);
      continue;
    }
    const seg = to - from;
    if (from < start) {
      const t = clamp((start - from) / seg, 0, 1);
      collideSegment(b, ax, ay, ax + (bx - ax) * t, ay + (by - ay) * t, maxSpeed);
    }
    if (to > end) {
      const t = clamp((end - from) / seg, 0, 1);
      collideSegment(b, ax + (bx - ax) * t, ay + (by - ay) * t, bx, by, maxSpeed);
    }
  }
}

function collideBalls(balls: Ball[], maxSpeed: number) {
  'worklet';
  for (let i = 0; i < balls.length; i++) {
    const a = balls[i]!;
    for (let j = i + 1; j < balls.length; j++) {
      const b = balls[j]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const threshold = a.r + b.r;
      const distSq = dx * dx + dy * dy;
      if (distSq > threshold * threshold) {
        continue;
      }
      const dist = Math.sqrt(Math.max(distSq, 0.0001));
      let nx = dx / dist;
      let ny = dy / dist;
      if (dist < 0.01) {
        const rvx = b.vx - a.vx;
        const rvy = b.vy - a.vy;
        const rel = Math.hypot(rvx, rvy);
        nx = rel > 0.001 ? rvx / rel : 1;
        ny = rel > 0.001 ? rvy / rel : 0;
      }
      const sep = (threshold - dist) / 2;
      a.x -= nx * sep;
      a.y -= ny * sep;
      b.x += nx * sep;
      b.y += ny * sep;
      const vrel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (vrel < 0) {
        const impulse = (-(1 + BALL_BOUNCE) * vrel) / 2;
        a.vx = clamp(a.vx - impulse * nx, -maxSpeed, maxSpeed);
        a.vy = clamp(a.vy - impulse * ny, -maxSpeed, maxSpeed);
        b.vx = clamp(b.vx + impulse * nx, -maxSpeed, maxSpeed);
        b.vy = clamp(b.vy + impulse * ny, -maxSpeed, maxSpeed);
      }
    }
  }
}

function updateBalls(w: World, dt: number, width: number, height: number) {
  'worklet';
  const maxSpeed = Math.min(width, height) * MAX_SPEED;
  const bucket = bucketRect(width, height);
  const balls = w.balls;
  for (let i = balls.length - 1; i >= 0; i--) {
    const b = balls[i]!;
    b.vx = clamp(b.vx, -maxSpeed, maxSpeed);
    b.vy = clamp(b.vy + GRAVITY * dt, -maxSpeed, maxSpeed);
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.x - b.r < 0) {
      b.x = b.r;
      b.vx = Math.abs(b.vx) * WALL_BOUNCE;
    } else if (b.x + b.r > width) {
      b.x = width - b.r;
      b.vx = -Math.abs(b.vx) * WALL_BOUNCE;
    }
    for (let j = 0; j < w.lines.length; j++) {
      collideLine(b, w.lines[j]!, maxSpeed);
    }
    collideSegment(b, bucket.left, bucket.top, bucket.left, bucket.bottom, maxSpeed);
    collideSegment(b, bucket.right, bucket.top, bucket.right, bucket.bottom, maxSpeed);
    const caught =
      b.y - b.r > bucket.top && b.x > bucket.left && b.x < bucket.right;
    if (caught) {
      w.caught++;
    }
    if (caught || b.y - b.r > height + b.r * 8) {
      balls.splice(i, 1);
    }
  }
  collideBalls(balls, maxSpeed);
}

function smoothPath(pts: number[]) {
  'worklet';
  const n = pts.length / 2;
  if (n < 2) {
    return '';
  }
  let d = ` M${pts[0]} ${pts[1]}`;
  for (let i = 1; i < n - 1; i++) {
    const cx = pts[i * 2]!;
    const cy = pts[i * 2 + 1]!;
    d += ` Q${cx} ${cy} ${(cx + pts[i * 2 + 2]!) / 2} ${(cy + pts[i * 2 + 3]!) / 2}`;
  }
  return d + ` L${pts[n * 2 - 2]} ${pts[n * 2 - 1]}`;
}

function visiblePoints(line: Line, startD: number, endD: number) {
  'worklet';
  const p0 = pointAt(line, startD);
  const group = [p0.x, p0.y];
  for (let i = 1; i < line.lens.length - 1; i++) {
    const d = line.lens[i]!;
    if (d > startD && d < endD) {
      group.push(line.pts[i * 2]!, line.pts[i * 2 + 1]!);
    }
  }
  const p1 = pointAt(line, endD);
  group.push(p1.x, p1.y);
  return group;
}

function linesPath(lines: Line[]) {
  'worklet';
  let d = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.eroded) {
      continue;
    }
    if (line.origin < 0) {
      d += smoothPath(line.pts);
      continue;
    }
    const start = clamp(line.origin - line.radius, 0, line.total);
    const end = clamp(line.origin + line.radius, 0, line.total);
    if (start > 0) {
      d += smoothPath(visiblePoints(line, 0, start));
    }
    if (end < line.total) {
      d += smoothPath(visiblePoints(line, end, line.total));
    }
  }
  return d;
}

function ToolToggle({ erasing }: { erasing: SharedValue<boolean> }) {
  const [on, setOn] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={on ? 'Switch to line mode' : 'Switch to eraser mode'}
      accessibilityState={{ selected: on }}
      style={styles.fab}
      onPress={() => {
        erasing.value = !on;
        setOn(!on);
      }}
    >
      <RNText style={styles.fabText}>{on ? 'eraser' : 'pen'}</RNText>
    </Pressable>
  );
}

export function PhysicsScreen() {
  const world = useSharedValue<World>({
    balls: [],
    lines: [],
    current: null,
    lastSpawn: 0,
    caught: 0,
    shown: 0,
    dirty: false,
  });
  // State as well as a shared value: the bucket's JSX needs the height, the physics needs it on the UI thread.
  const [layout, setLayout] = useState({ width: WIN.width, height: WIN.height });
  const size = useSharedValue(layout);
  const erasing = useSharedValue(false);
  const sprites = useSpriteBuffer(CAPACITY);
  const count = useSharedValue(0);
  const lines = useNode();
  const caught = useSharedValue('0');
  const eraserFill = useNode();
  const eraserRing = useNode();

  const sheet = useOffscreenImage(
    <Group>
      {BALL_COLORS.map((color, i) => (
        <Circle
          key={color}
          cx={i * CELL + CELL / 2}
          cy={CELL / 2}
          r={BALL_R}
          color={color}
        >
          <DropShadow
            dx={BALL_R * 0.14}
            dy={BALL_R * 0.18}
            blur={5}
            color="rgba(85, 98, 92, 0.18)"
          />
        </Circle>
      ))}
      {BALL_COLORS.map((color, i) => (
        <Circle
          key={color}
          cx={i * CELL + CELL / 2 - BALL_R * 0.32}
          cy={CELL / 2 - BALL_R * 0.36}
          r={BALL_R * 0.24}
          color="rgba(255, 255, 255, 0.38)"
        />
      ))}
      {Array.from({ length: DUST_STEPS }, (_, k) => (
        <Circle
          key={k}
          cx={k * DUST_CELL + DUST_CELL / 2}
          cy={CELL + DUST_CELL / 2}
          r={DUST_R}
          color={`rgba(104, 123, 116, ${0.48 * (1 - k / DUST_STEPS)})`}
        />
      ))}
    </Group>,
    { width: BALL_COLORS.length * CELL, height: CELL + DUST_CELL, pixelRatio: PR },
    [],
  );

  function showEraser(x: number, y: number, visible: boolean) {
    'worklet';
    eraserFill.set({ visible, cx: x, cy: y });
    eraserRing.set({ visible, cx: x, cy: y });
  }

  const pan = Gesture.Pan()
    .minDistance(1)
    .onBegin(e => {
      if (erasing.value) {
        showEraser(e.x, e.y, true);
        eraseAt(world.value, e.x, e.y);
      } else {
        addLine(world.value, e.x, e.y);
      }
    })
    .onUpdate(e => {
      if (erasing.value) {
        showEraser(e.x, e.y, true);
        eraseAt(world.value, e.x, e.y);
      } else {
        addPoint(world.value, e.x, e.y);
      }
    })
    .onFinalize(() => {
      if (erasing.value) {
        showEraser(0, 0, false);
      } else {
        finishLine(world.value);
      }
    });

  useFrameCallback(frame => {
    'worklet';
    const w = world.value;
    const { width, height } = size.value;
    const dt = clamp((frame.timeSincePreviousFrame ?? 1000 / 60) / 1000, 1 / 120, 1 / 30);
    spawnBall(w, width, frame.timestamp);
    updateLines(w, dt);
    updateBalls(w, dt, width, height);
    let n = 0;
    for (let i = 0; i < w.balls.length; i++) {
      const b = w.balls[i]!;
      sprites.set(n++, b.color * CELL * PR, 0, CELL * PR, CELL * PR, b.r / BALL_R / PR, b.x, b.y);
    }
    for (let i = 0; i < w.lines.length; i++) {
      const dust = w.lines[i]!.dust;
      for (let j = 0; j < dust.length && n < CAPACITY; j++) {
        const d = dust[j]!;
        const p = clamp(d.age / d.life, 0, 1);
        const step = Math.min(Math.floor(p * DUST_STEPS), DUST_STEPS - 1);
        sprites.set(
          n++,
          step * DUST_CELL * PR,
          CELL * PR,
          DUST_CELL * PR,
          DUST_CELL * PR,
          (d.r * (1 - p * 0.58)) / DUST_R / PR,
          d.x,
          d.y,
        );
      }
    }
    // ponytail: Reanimated drops same-value writes; the fraction keeps the count moving and truncates natively.
    count.value = n + (frame.timestamp % 1000) * 1e-6;
    if (w.dirty) {
      w.dirty = false;
      lines.set({ path: linesPath(w.lines) });
    }
    if (w.shown !== w.caught) {
      w.shown = w.caught;
      caught.value = String(w.caught);
    }
  });

  const bucket = bucketRect(layout.width, layout.height);

  return (
    <View
      style={styles.root}
      onLayout={e => {
        const { width, height } = e.nativeEvent.layout;
        size.value = { width, height };
        setLayout({ width, height });
      }}
    >
      <GestureDetector gesture={pan}>
        <View style={StyleSheet.absoluteFill} collapsable={false}>
          <Canvas style={StyleSheet.absoluteFill}>
            <Fill color={BG} />
            <Path
              ref={lines}
              path=""
              color={LINE_COLOR}
              style="stroke"
              strokeWidth={LINE_WIDTH}
              strokeCap="round"
              strokeJoin="round"
            />
            <Atlas image={sheet} buffer={sprites} count={count} sampling="mipmap" />
            <Path path={bucketPath(layout.width, layout.height)} color="#768983" />
            <RoundedRect
              x={bucket.left - 5}
              y={bucket.top - 5}
              width={BUCKET_W + 10}
              height={12}
              r={6}
              color="#5F736C"
            />
            <Text
              x={bucket.left}
              y={bucket.top + 68}
              width={BUCKET_W}
              textAlign="center"
              text={caught}
              fontSize={32}
              fontWeight="bold"
              color={BG}
            />
            <Circle
              ref={eraserFill}
              cx={0}
              cy={0}
              r={ERASER_RADIUS}
              visible={false}
              color="rgba(177, 164, 157, 0.18)"
            />
            <Circle
              ref={eraserRing}
              cx={0}
              cy={0}
              r={ERASER_RADIUS}
              visible={false}
              color="rgba(104, 123, 116, 0.58)"
              style="stroke"
              strokeWidth={2}
            />
          </Canvas>
        </View>
      </GestureDetector>
      <ToolToggle erasing={erasing} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 1,
    borderColor: 'rgba(104, 123, 116, 0.22)',
    backgroundColor: '#768983',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 5,
  },
  fabText: { color: BG, fontSize: 12, fontWeight: '700' },
});
