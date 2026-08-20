// useVideo: platform decoding into a native handle, drawn like any other image.
import { useState } from 'react';
import { Button, Text as RNText, StyleSheet, View } from 'react-native';
import { Canvas, Fill, TgfxImage, Text, useVideo } from 'react-native-tgfx';

const clip = require('./assets/sample-video.mp4');

export function VideoSection() {
  const [paused, setPaused] = useState(false);
  const { currentFrame, duration, framerate, rotation, size } = useVideo(clip, {
    paused,
    looping: true,
  });

  return (
    <View style={styles.section}>
      <RNText style={styles.label}>{'useVideo — looping, muted'}</RNText>
      <Canvas style={styles.canvas}>
        <Fill color="#101014" />
        {currentFrame != null && (
          <TgfxImage
            x={0}
            y={0}
            width={320}
            height={180}
            image={currentFrame}
            fit="contain"
          />
        )}
        {currentFrame == null && (
          <Text x={12} y={96} text="opening…" fontSize={16} color="#8e8e93" />
        )}
      </Canvas>
      <RNText style={styles.meta}>
        {`${size.width}x${size.height} · ${framerate.toFixed(0)} fps · ${(
          duration / 1000
        ).toFixed(1)}s · rotation ${rotation}`}
      </RNText>
      <Button
        title={paused ? 'Play' : 'Pause'}
        onPress={() => setPaused(p => !p)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 16, paddingVertical: 12 },
  label: { fontSize: 13, fontWeight: '600', color: '#3c3c43', marginBottom: 8 },
  canvas: { width: '100%', height: 180, borderRadius: 12, overflow: 'hidden' },
  meta: { fontSize: 11, color: '#8e8e93', marginTop: 6 },
});
