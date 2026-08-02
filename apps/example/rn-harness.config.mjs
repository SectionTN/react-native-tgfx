import {
  androidEmulator,
  androidPlatform,
  physicalAndroidDevice,
} from '@react-native-harness/platform-android';

export default {
  entryPoint: './index.js',
  appRegistryComponentName: 'TgfxExample',

  // The tgfx canvas is a full-screen GPU surface; keep the views it wraps.
  disableViewFlattening: true,

  runners: [
    // Authoritative baselines: an AVD anyone can recreate, so a diff here is a
    // rendering change rather than a different phone.
    androidPlatform({
      name: 'android-emulator',
      device: androidEmulator('Pixel_8_API_35'),
      bundleId: 'com.tgfxexample',
    }),
    // Advisory: real GPU, real driver. Its baselines only match this phone.
    androidPlatform({
      name: 'android',
      device: physicalAndroidDevice('motorola', 'moto g35 5G'),
      bundleId: 'com.tgfxexample',
    }),
  ],
  defaultRunner: 'android-emulator',
};
