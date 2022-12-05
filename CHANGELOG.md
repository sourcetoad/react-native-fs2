# Changelog

# v3.0.0

 * Removed Windows support.
 * Convert to TypeScript.
 * Migrated to [Bob](https://github.com/callstack/react-native-builder-bob)
 * Migrated iOS files into `ios` folder.
 * Migrated source files into `src folder`.
 * Migrated `IntegrationTests` into `/example` folder.
 * Removed the following functions:
   * `pathForBundle`
   * `pathForGroup`
   * `readDirAssets`
   * `existsAssets`
   * `existsRes`
   * `readdir`
   * `setReadable`
   * `readFileAssets`
   * `readFileRes`
   * `copyFileAssets`
   * `copyFileRes`
   * `copyAssetsFileIOS`
   * `copyAssetsVideoIOS`
   * `uploadFiles`
   * `stopUpload`
 * (Android) Revert Async nature of copy/move. Ported from [itinance/react-native-fs/pull/1150](https://github.com/itinance/react-native-fs/pull/1150)
 * Clean up type handling of options/encoding. Ported from [itinance/react-native-fs/pull/1011](https://github.com/itinance/react-native-fs/pull/1011)

---
_Changes prior to v3.0.0 can be found in [original fork](https://github.com/itinance/react-native-fs)_
