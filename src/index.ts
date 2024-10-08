import { EmitterSubscription, NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { decode as atob, encode as btoa } from 'base-64';
import { decode as decode_utf8, encode as encode_utf8 } from 'utf8';
import type {
  MkdirOptions,
  FileOptions,
  FSInfoResult,
  ReadDirItem,
  StatResult,
  DownloadFileOptions,
  DownloadFileResult,
  Encoding,
  EncodingOrOptions,
  ProcessedOptions,
  FileDescriptor,
  MediaCollections,
} from './types';

let blobJSIHelper: any;
try {
  blobJSIHelper = require('react-native-blob-jsi-helper');
} catch (e) {
  // ignore
  blobJSIHelper = null;
}

const RNFSManager = NativeModules.RNFSManager;
const RNFSMediaStoreManager = NativeModules.RNFSMediaStoreManager;
const RNFS_NativeEventEmitter = new NativeEventEmitter(RNFSManager);

// Since we are mapping enums from their native counterpart. We must allow these to fail if run
// in say jest or without the native component.
const RNFSFileTypeRegular = RNFSManager?.RNFSFileTypeRegular;
const RNFSFileTypeDirectory = RNFSManager?.RNFSFileTypeDirectory;

let globalJobId = 0;

const getJobId = () => {
  globalJobId += 1;
  return globalJobId;
};

const normalizeFilePath = (path: string) => (path.startsWith('file://') ? path.slice(7) : path);

function parseOptions(encodingOrOptions?: EncodingOrOptions): ProcessedOptions {
  let options = {
    encoding: 'utf8' as Encoding,
  };

  if (!encodingOrOptions) {
    return options;
  }

  if (typeof encodingOrOptions === 'string') {
    options.encoding = encodingOrOptions as Encoding;
  } else if (typeof encodingOrOptions === 'object') {
    options = {
      ...options,
      ...encodingOrOptions,
    };
  }

  return options;
}

function encodeContents(contents: string, encoding: Encoding): string {
  if (encoding === 'utf8') {
    return btoa(encode_utf8(contents));
  }

  if (encoding === 'ascii') {
    return btoa(contents);
  }

  if (encoding === 'base64') {
    return contents;
  }

  throw new Error('Invalid encoding type "' + String(encoding) + '"');
}

function decodeContents(b64: string, encoding: Encoding): string {
  if (encoding === 'utf8') {
    return atob(decode_utf8(b64));
  }

  if (encoding === 'ascii') {
    return atob(b64);
  }

  if (encoding === 'base64') {
    return b64;
  }

  throw new Error('Invalid encoding type "' + String(encoding) + '"');
}

function getArrayBuffer(filePath: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    if (!blobJSIHelper) {
      reject(new Error('react-native-blob-jsi-helper is not installed'));
      return;
    }

    fetch(filePath)
      .then((response) => response.blob())
      .then((blob) => {
        resolve(blobJSIHelper.getArrayBufferForBlob(blob));
      })
      .catch((error) => {
        reject(error);
      });
  });
}

const MediaStore = {
  createMediaFile(fileDescriptor: FileDescriptor, mediatype: MediaCollections): Promise<string> {
    if (!fileDescriptor.parentFolder) fileDescriptor.parentFolder = '';
    return RNFSMediaStoreManager.createMediaFile(fileDescriptor, mediatype);
  },

  writeToMediaFile(uri: string, path: string): Promise<void> {
    return RNFSMediaStoreManager.writeToMediaFile(uri, normalizeFilePath(path), false);
  },

  copyToMediaStore(fileDescriptor: FileDescriptor, mediatype: MediaCollections, path: string): Promise<string> {
    return RNFSMediaStoreManager.copyToMediaStore(fileDescriptor, mediatype, normalizeFilePath(path));
  },

  existsInMediaStore(uri: string): Promise<boolean> {
    return RNFSMediaStoreManager.exists(uri);
  },

  deleteFromMediaStore(uri: string): Promise<boolean> {
    return RNFSMediaStoreManager.delete(uri);
  },

  MEDIA_AUDIO: 'Audio' as MediaCollections,
  MEDIA_IMAGE: 'Image' as MediaCollections,
  MEDIA_VIDEO: 'Video' as MediaCollections,
  MEDIA_DOWNLOAD: 'Download' as MediaCollections,
};

export default {
  mkdir(filepath: string, options: MkdirOptions = {}): Promise<undefined> {
    return RNFSManager.mkdir(normalizeFilePath(filepath), options).then(() => void 0);
  },

  moveFile(filepath: string, destPath: string, options: FileOptions = {}): Promise<undefined> {
    return RNFSManager.moveFile(normalizeFilePath(filepath), normalizeFilePath(destPath), options).then(() => void 0);
  },

  copyFile(filepath: string, destPath: string, options: FileOptions = {}): Promise<undefined> {
    return RNFSManager.copyFile(normalizeFilePath(filepath), normalizeFilePath(destPath), options).then(() => void 0);
  },

  getFSInfo(): Promise<FSInfoResult> {
    return RNFSManager.getFSInfo();
  },

  getAllExternalFilesDirs(): Promise<string[]> {
    return RNFSManager.getAllExternalFilesDirs();
  },

  unlink(filepath: string): Promise<void> {
    return RNFSManager.unlink(normalizeFilePath(filepath)).then(() => void 0);
  },

  exists(filepath: string): Promise<boolean> {
    return RNFSManager.exists(normalizeFilePath(filepath));
  },

  stopDownload(jobId: number): void {
    RNFSManager.stopDownload(jobId);
  },

  resumeDownload(jobId: number): void {
    RNFSManager.resumeDownload(jobId);
  },

  isResumable(jobId: number): Promise<boolean> {
    return RNFSManager.isResumable(jobId);
  },

  completeHandlerIOS(jobId: number): void {
    return RNFSManager.completeHandlerIOS(jobId);
  },

  readDir(dirPath: string): Promise<ReadDirItem[]> {
    return RNFSManager.readDir(normalizeFilePath(dirPath)).then((files: any[]) => {
      return files.map((file) => ({
        ctime: (file.ctime && new Date(file.ctime * 1000)) || null,
        mtime: (file.mtime && new Date(file.mtime * 1000)) || null,
        name: file.name,
        path: file.path,
        size: file.size,
        isFile: () => file.type === RNFSFileTypeRegular,
        isDirectory: () => file.type === RNFSFileTypeDirectory,
      }));
    });
  },

  stat(filepath: string): Promise<StatResult> {
    return RNFSManager.stat(normalizeFilePath(filepath)).then((result: StatResult) => {
      return {
        path: filepath,
        ctime: new Date(result.ctime * 1000),
        mtime: new Date(result.mtime * 1000),
        size: result.size,
        mode: result.mode,
        originalFilepath: result.originalFilepath,
        isFile: () => result.type === RNFSFileTypeRegular,
        isDirectory: () => result.type === RNFSFileTypeDirectory,
      };
    });
  },

  readFile(filepath: string, encodingOrOptions?: EncodingOrOptions): Promise<string | ArrayBuffer> {
    const options = parseOptions(encodingOrOptions);

    if (options.encoding === 'arraybuffer') {
      return getArrayBuffer(filepath);
    }

    return RNFSManager.readFile(normalizeFilePath(filepath)).then((b64: string) => {
      return decodeContents(b64, options.encoding);
    });
  },

  read(
    filepath: string,
    length: number = 0,
    position: number = 0,
    encodingOrOptions?: EncodingOrOptions
  ): Promise<string> {
    const options = parseOptions(encodingOrOptions);

    return RNFSManager.read(normalizeFilePath(filepath), length, position).then((b64: string) => {
      return decodeContents(b64, options.encoding);
    });
  },

  hash(filepath: string, algorithm: string): Promise<string> {
    return RNFSManager.hash(normalizeFilePath(filepath), algorithm);
  },

  writeFile(filepath: string, contents: string, encodingOrOptions?: EncodingOrOptions): Promise<void> {
    const options = parseOptions(encodingOrOptions);
    const b64 = encodeContents(contents, options.encoding);

    return RNFSManager.writeFile(normalizeFilePath(filepath), b64, options);
  },

  appendFile(filepath: string, contents: string, encodingOrOptions?: EncodingOrOptions): Promise<void> {
    const options = parseOptions(encodingOrOptions);
    const b64 = encodeContents(contents, options.encoding);

    return RNFSManager.appendFile(normalizeFilePath(filepath), b64);
  },

  write(filepath: string, contents: string, position?: number, encodingOrOptions?: EncodingOrOptions): Promise<null> {
    const options = parseOptions(encodingOrOptions);
    const b64 = encodeContents(contents, options.encoding);

    if (position === undefined) {
      position = -1;
    }

    return RNFSManager.write(normalizeFilePath(filepath), b64, position).then(() => void 0);
  },

  downloadFile(options: DownloadFileOptions): DownloadFileResult {
    const jobId = getJobId();
    let subscriptions: EmitterSubscription[] = [];

    if (options.begin) {
      subscriptions.push(
        RNFS_NativeEventEmitter.addListener('DownloadBegin', (res) => {
          if (res.jobId === jobId) {
            // @ts-ignore
            options.begin(res);
          }
        })
      );
    }

    if (options.progress) {
      subscriptions.push(
        RNFS_NativeEventEmitter.addListener('DownloadProgress', (res) => {
          if (res.jobId === jobId) {
            // @ts-ignore
            options.progress(res);
          }
        })
      );
    }

    if (options.resumable) {
      subscriptions.push(
        RNFS_NativeEventEmitter.addListener('DownloadResumable', (res) => {
          if (res.jobId === jobId) {
            // @ts-ignore
            options.resumable(res);
          }
        })
      );
    }

    const bridgeOptions = {
      jobId: jobId,
      fromUrl: options.fromUrl,
      toFile: normalizeFilePath(options.toFile),
      headers: options.headers || {},
      background: !!options.background,
      progressDivider: options.progressDivider || 0,
      progressInterval: options.progressInterval || 0,
      readTimeout: options.readTimeout || 15000,
      connectionTimeout: options.connectionTimeout || 5000,
      backgroundTimeout: options.backgroundTimeout || 3600000, // 1 hour
      hasBeginCallback: options.begin instanceof Function,
      hasProgressCallback: options.progress instanceof Function,
      hasResumableCallback: options.resumable instanceof Function,
    };

    return {
      jobId,
      promise: RNFSManager.downloadFile(bridgeOptions)
        .then((res: any) => {
          subscriptions.forEach((sub) => sub.remove());
          return res;
        })
        .catch((e: any) => {
          return Promise.reject(e);
        }),
    };
  },

  touch(filepath: string, mtime?: Date, ctime?: Date): Promise<void> {
    let ctimeTime: undefined | number = 0;
    if (Platform.OS === 'ios') {
      ctimeTime = ctime && ctime.getTime();
    }
    return RNFSManager.touch(normalizeFilePath(filepath), mtime && mtime.getTime(), ctimeTime);
  },

  scanFile(path: string): Promise<string[]> {
    return RNFSManager.scanFile(path);
  },

  MediaStore,

  MainBundlePath: RNFSManager.RNFSMainBundlePath as String,
  CachesDirectoryPath: RNFSManager.RNFSCachesDirectoryPath as String,
  ExternalCachesDirectoryPath: RNFSManager.RNFSExternalCachesDirectoryPath as String,
  DocumentDirectoryPath: RNFSManager.RNFSDocumentDirectoryPath as String,
  DownloadDirectoryPath: RNFSManager.RNFSDownloadDirectoryPath as String,
  ExternalDirectoryPath: RNFSManager.RNFSExternalDirectoryPath as String,
  ExternalStorageDirectoryPath: RNFSManager.RNFSExternalStorageDirectoryPath as String,
  TemporaryDirectoryPath: RNFSManager.RNFSTemporaryDirectoryPath as String,
  LibraryDirectoryPath: RNFSManager.RNFSLibraryDirectoryPath as String,
  PicturesDirectoryPath: RNFSManager.RNFSPicturesDirectoryPath as String,
};
