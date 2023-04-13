# Changelog

# v3.0.4 (April 13, 2023)
 * Add automatic updates via Dependabot for GitHub Actions
 * [#26](https://github.com/sourcetoad/react-native-fs2/pull/26) - Fix corrupt images if OS buffer is non-empty after flush.

# v3.0.3 (February 20, 2023)
 * [#22](https://github.com/sourcetoad/react-native-fs2/issues/22) - Fix double encoding on `readFile`
 * Add documentation and examples
 * Upgrade `json5` and `http-cache-semantics` for vulnerabilities.

# v3.0.2 (December 5, 2022)
 * [#8](https://github.com/sourcetoad/react-native-fs2/issues/8) - Allow jest testing to work with native enums.
 * Further purge of Upload functionality from iOS side.
 * Inline type for downloadFile return

# v3.0.1 (December 5, 2022)
 * Rename internals to `RNFS2` to prevent collisions with older package.
 * Enforce peering to RN69+
 * Drop Node 16 from CI.

# v3.0.0 (December 5, 2022)

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
