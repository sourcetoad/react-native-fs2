import { NitroModules } from 'react-native-nitro-modules';
import type { MediaStore as NitroMediaStore } from './nitro/MediaStore.nitro';

/**
 * Helpers
 */
import { normalizeFilePath } from './utils';

import type {
  MediaCollectionType,
  FileDescription,
  MediaStoreFile,
  MediaStoreSearchOptions,
} from './nitro/MediaStore.nitro';

/**
 * Nitro Hybrid Objects
 */
const RNFSMediaStoreManager =
  NitroModules.createHybridObject<NitroMediaStore>('MediaStore');

/**
 * MediaStore
 */
export default {
  createMediaFile(
    fileDescription: FileDescription,
    mediatype: MediaCollectionType
  ): Promise<string> {
    if (!fileDescription.parentFolder) fileDescription.parentFolder = '';
    return RNFSMediaStoreManager.mediaStoreCreateFile(
      fileDescription,
      mediatype
    );
  },

  updateMediaFile(
    uri: string,
    fileDescription: FileDescription,
    mediatype: MediaCollectionType
  ): Promise<string> {
    return RNFSMediaStoreManager.mediaStoreUpdateFile(
      uri,
      fileDescription,
      mediatype
    );
  },

  writeToMediaFile(uri: string, path: string): Promise<void> {
    return RNFSMediaStoreManager.mediaStoreWriteToFile(
      uri,
      normalizeFilePath(path)
    );
  },

  copyToMediaStore(
    fileDescription: FileDescription,
    mediatype: MediaCollectionType,
    path: string
  ): Promise<string> {
    return RNFSMediaStoreManager.mediaStoreCopyFromFile(
      normalizeFilePath(path),
      fileDescription,
      mediatype
    );
  },

  queryMediaStore(
    searchOptions: MediaStoreSearchOptions
  ): Promise<MediaStoreFile | undefined> {
    return RNFSMediaStoreManager.mediaStoreQueryFile(searchOptions);
  },

  deleteFromMediaStore(uri: string): Promise<boolean> {
    return RNFSMediaStoreManager.mediaStoreDeleteFile(uri);
  },

  MEDIA_AUDIO: 'Audio' as MediaCollectionType,
  MEDIA_IMAGE: 'Image' as MediaCollectionType,
  MEDIA_VIDEO: 'Video' as MediaCollectionType,
  MEDIA_DOWNLOAD: 'Download' as MediaCollectionType,
};
