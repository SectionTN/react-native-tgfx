import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BenchmarkRunner } from './src/BenchmarkRunner';

export default function App() {
  return (
    <SafeAreaProvider>
      <BenchmarkRunner />
    </SafeAreaProvider>
  );
}
