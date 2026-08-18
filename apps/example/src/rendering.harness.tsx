import React from 'react';
import { useSharedValue } from 'react-native-reanimated';
import { describe, render, test } from 'react-native-harness';
import {
  Circle,
  Group,
  Image,
  Paint,
  Path,
  Rect,
  useImage,
} from 'react-native-tgfx';
import { Stage, snapshot } from './testSupport';

const RED_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAEklEQVR4nGP4z8DwHx9mGBkKAMLXf4EvceABAAAAAElFTkSuQmCC';

function RedImage(props: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  const image = useImage(RED_PNG);
  return image == null ? null : <Image {...props} image={image} fit="fill" />;
}

describe('tgfx rendering', () => {
  test('draws basic shapes', async () => {
    await render(
      <Stage>
        <Rect x={20} y={20} width={80} height={60} color="#3366ff" />
        <Circle cx={140} cy={130} r={45} color="orange" />
      </Stage>,
    );
    await snapshot('shapes-rect-circle');
  });

  test('applies group opacity', async () => {
    await render(
      <Stage>
        <Rect x={0} y={0} width={200} height={200} color="white" />
        <Group opacity={0.25}>
          <Rect x={20} y={20} width={160} height={70} color="red" />
        </Group>
        <Group opacity={1}>
          <Rect x={20} y={110} width={160} height={70} color="red" />
        </Group>
      </Stage>,
    );
    await snapshot('opacity-group');
  });

  test('applies an animated group opacity', async () => {
    function AnimatedOpacity() {
      const opacity = useSharedValue(0.3);
      return (
        <Stage>
          <Rect x={0} y={0} width={200} height={200} color="white" />
          <Group opacity={opacity}>
            <Circle cx={100} cy={100} r={80} color="blue" />
          </Group>
        </Stage>
      );
    }

    await render(<AnimatedOpacity />);
    await snapshot('opacity-group-animated');
  });

  test('applies paint opacity and inherits it into an image', async () => {
    await render(
      <Stage>
        <Rect x={0} y={0} width={200} height={200} color="white" />
        <Group>
          <Paint color="green" opacity={0.4} />
          <Rect x={20} y={20} width={160} height={60} />
        </Group>
        <Group opacity={0.4}>
          <RedImage x={20} y={110} width={160} height={70} />
        </Group>
      </Stage>,
    );
    await snapshot('opacity-paint-and-image');
  });

  test('draws svg elliptical arcs', async () => {
    await render(
      <Stage>
        <Rect x={0} y={0} width={200} height={200} color="white" />
        <Group transform={[{ translate: [20, 20] }, { scale: 8 }]}>
          <Path path="M8 15a7 7 0 110-14 7 7 0 010 14z" color="purple" />
        </Group>
        <Path
          path="M20 160 A 60 30 0 0 1 180 160"
          color="red"
          style="stroke"
          strokeWidth={6}
        />
      </Stage>,
    );
    await snapshot('path-elliptical-arcs');
  });

  test('resolves named and malformed colours', async () => {
    await render(
      <Stage>
        <Rect x={0} y={0} width={200} height={200} color="white" />
        <Rect x={10} y={8} width={180} height={32} color="darkgray" />
        <Rect x={10} y={44} width={180} height={32} color="darkgrey" />
        <Rect x={10} y={80} width={180} height={32} color="green" />
        <Rect x={10} y={116} width={180} height={32} color="lime" />
        <Rect x={10} y={152} width={180} height={32} color="not-a-colour" />
      </Stage>,
    );
    await snapshot('colors-named-and-malformed');
  });
});
