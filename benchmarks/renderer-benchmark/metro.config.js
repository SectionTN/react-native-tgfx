const path = require('path')
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config')

const config = {
  watchFolders: [path.resolve(__dirname, '../../packages/react-native-tgfx')],
  resolver: {
    disableHierarchicalLookup: true,
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
    unstable_enableSymlinks: true,
  },
}

module.exports = mergeConfig(getDefaultConfig(__dirname), config)
