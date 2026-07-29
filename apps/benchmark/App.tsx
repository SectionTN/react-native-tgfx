import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SkiaOnly } from './src/SkiaOnly';

export default function App({
  mode,
  plan,
  step,
}: {
  mode?: string;
  plan?: string;
  step?: string;
}) {
  // Required lazily: the benchmark and parity screens pull in reanimated, and
  // `skiaonly` exists precisely to run without it.
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
      <Bench plan={plan} />
    </SafeAreaProvider>
  );
}
