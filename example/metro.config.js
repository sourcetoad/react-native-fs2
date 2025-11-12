const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const path = require('path');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [
    // Watch the parent directory so Metro can resolve the local package
    path.resolve(__dirname, '..'),
  ],
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
