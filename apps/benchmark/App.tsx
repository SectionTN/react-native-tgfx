import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SkiaOnly } from './src/SkiaOnly';

export default function App(props: {
  mode?: string;
  plan?: string;
  libs?: string;
  step?: string;
  wl?: string;
  n?: string;
  window?: string;
}) {
  const { mode, step } = props;
  // Required lazily: `skiaonly` exists precisely to run without reanimated.
  if (mode === 'skiaonly') {
    const n = Number(step ?? 0);
    let screen = <SkiaOnly />;
    if (n > 0) {
      const { SkiaReaStep } = require('./src/SkiaReaStep');
      screen = <SkiaReaStep step={n} />;
    }
    return <SafeAreaProvider>{screen}</SafeAreaProvider>;
  }
  if (mode === 'parity') {
    const { Parity } = require('./src/Parity');
    return (
      <SafeAreaProvider>
        <Parity />
      </SafeAreaProvider>
    );
  }
  const { Bench } = require('./src/Bench');
  return (
    <SafeAreaProvider>
      <Bench {...props} />
    </SafeAreaProvider>
  );
}
