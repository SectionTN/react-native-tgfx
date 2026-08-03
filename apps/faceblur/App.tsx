import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { TgfxCameraEffects } from './src/TgfxCameraEffects';
import { TgfxFaceBlur } from './src/TgfxFaceBlur';

type Screen = 'faceblur' | 'effects';

export default function App() {
  const [screen, setScreen] = useState<Screen>('faceblur');
  return (
    <View style={styles.fill}>
      {screen === 'faceblur' ? <TgfxFaceBlur /> : <TgfxCameraEffects />}
      <View style={styles.bar}>
        {(['faceblur', 'effects'] as Screen[]).map(s => (
          <Pressable
            key={s}
            style={[styles.button, screen === s && styles.buttonOn]}
            onPress={() => {
              setScreen(s);
            }}>
            <Text style={styles.buttonText}>{s}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  bar: {
    position: 'absolute',
    top: 56,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#0008',
    borderWidth: 1,
    borderColor: '#fff6',
  },
  buttonOn: { backgroundColor: '#fff3', borderColor: '#fff' },
  buttonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
