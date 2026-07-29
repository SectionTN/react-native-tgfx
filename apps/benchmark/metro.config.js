const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

/**
 * Metro configuration for the monorepo: watch the workspace root so the local
 * `react-native-tgfx` package and hoisted node_modules resolve.
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
// react-native-nitro-thor is a file: dependency in a sibling repo, so Metro has
// to watch that path too or it refuses to resolve through the symlink.
const thorRoot = path.resolve(
  workspaceRoot,
  '../skia-replacement/packages/react-native-thor'
);

const config = {
  watchFolders: [workspaceRoot, thorRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ],
    // Avoid duplicate React/React Native copies from the package's own dev deps.
    disableHierarchicalLookup: false,
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
