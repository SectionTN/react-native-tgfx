import {
  androidPlatform,
  physicalAndroidDevice,
} from '@react-native-harness/platform-android';

export default {
  entryPoint: './index.js',
  appRegistryComponentName: 'TgfxExample',

  // The tgfx canvas is a full-screen GPU surface; keep the views it wraps.
  disableViewFlattening: true,

  runners: [
    // One runner, so one baseline directory: __image_snapshots__/android.
    // A runner is a specific device, and the directory is named after the
    // runner — a second runner would fork the baselines again.
    androidPlatform({
      name: 'android',
      device: physicalAndroidDevice('samsung', 'SM-E146B'),
      bundleId: 'com.tgfxexample',
    }),
  ],
  defaultRunner: 'android',
};
