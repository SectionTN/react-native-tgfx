module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // react-native-worklets/plugin powers Reanimated 4 worklets and MUST be last.
  plugins: ['react-native-worklets/plugin'],
};
