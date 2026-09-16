module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // Powers Reanimated 4 worklets; must be last.
  plugins: ['react-native-worklets/plugin'],
};
