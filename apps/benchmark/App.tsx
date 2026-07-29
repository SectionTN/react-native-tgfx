import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Bench } from './src/Bench';
import { Parity } from './src/Parity';

export default function App({ mode, plan }: { mode?: string; plan?: string }) {
  return (
    <SafeAreaProvider>
      {mode === 'parity' ? <Parity /> : <Bench plan={plan} />}
    </SafeAreaProvider>
  );
}
