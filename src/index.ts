import { NitroModules } from 'react-native-nitro-modules';
import type { Fs2 } from './nitro/Fs2.nitro';
import type {
  MkdirOptions,
  FSInfoResult,
  ReadDirItem,
  DownloadFileOptions,
  DownloadEventResult,
  NativeStatResult,
  HashAlgorithm,
} from './nitro/Fs2.nitro';
import type { EncodingOrOptions, StatResult } from './types';

/**
 * Re-export types
 */
export type {
  ReadDirItem,
  StatResultType,
  MkdirOptions,
  FSInfoResult,
  DownloadFileOptions,
  DownloadEventResult,
} from './nitro/Fs2.nitro';

export type {
  MediaCollectionType,
  FileDescription,
  MediaStoreFile,
  MediaStoreSearchOptions,
} from './nitro/MediaStore.nitro';

/**
 * Helpers
 */
import {
  encodeContents,
  decodeContents,
  normalizeFilePath,
  parseOptions,
} from './utils';

/**
 * Nitro Hybrid Objects
 */
const RNFS2Nitro = NitroModules.createHybridObject<Fs2>('Fs2');

/**
 * Download job/event management
 */
let globalJobId = 0;
const getJobId = () => ++globalJobId;

const downloadListeners = {
  begin: new Map<number, (event: DownloadEventResult) => void>(),
  progress: new Map<number, (event: DownloadEventResult) => void>(),
  complete: new Map<number, (event: DownloadEventResult) => void>(),
  error: new Map<number, (event: DownloadEventResult) => void>(),
  canBeResumed: new Map<number, (event: DownloadEventResult) => void>(),
};

/**
 * Legacy-compatible API
 */
const compat = {
  mkdir(filepath: string, options: MkdirOptions = {}): Promise<void> {
    return RNFS2Nitro.mkdir(normalizeFilePath(filepath), options);
  },

  moveFile(filepath: string, destPath: string): Promise<void> {
    return RNFS2Nitro.moveFile(
      normalizeFilePath(filepath),
      normalizeFilePath(destPath)
    );
  },

  copyFile(filepath: string, destPath: string): Promise<void> {
    return RNFS2Nitro.copyFile(
      normalizeFilePath(filepath),
      normalizeFilePath(destPath)
    );
  },

  getFSInfo(): Promise<FSInfoResult> {
    return RNFS2Nitro.getFSInfo();
  },

  getAllExternalFilesDirs(): Promise<string[]> {
    return RNFS2Nitro.getAllExternalFilesDirs();
  },

  unlink(filepath: string): Promise<void> {
    return RNFS2Nitro.unlink(normalizeFilePath(filepath));
  },

  exists(filepath: string): Promise<boolean> {
    return RNFS2Nitro.exists(normalizeFilePath(filepath));
  },

  stopDownload(jobId: number): Promise<void> {
    return RNFS2Nitro.stopDownload(jobId);
  },

  resumeDownload(jobId: number): Promise<void> {
    return RNFS2Nitro.resumeDownload(jobId);
  },

  isResumable(jobId: number): Promise<boolean> {
    return RNFS2Nitro.isResumable(jobId);
  },

  readDir(dirPath: string): Promise<ReadDirItem[]> {
    return RNFS2Nitro.readDir(normalizeFilePath(dirPath));
  },

  stat(filepath: string): Promise<StatResult> {
    return RNFS2Nitro.stat(normalizeFilePath(filepath)).then(
      (result: NativeStatResult) => ({
        path: filepath,
        ctime: result.ctime,
        mtime: result.mtime,
        size: result.size,
        mode: result.mode ?? 0,
        originalFilepath: result.originalFilepath,
        isFile: () => result.type === 'file',
        isDirectory: () => result.type === 'directory',
      })
    );
  },

  readFile(
    filepath: string,
    encodingOrOptions?: EncodingOrOptions
  ): Promise<string | ArrayBuffer> {
    const options = parseOptions(encodingOrOptions);
    return RNFS2Nitro.readFile(normalizeFilePath(filepath)).then((buffer) =>
      decodeContents(buffer, options.encoding)
    );
  },

  read(
    filepath: string,
    length: number = 0,
    position: number = 0,
    encodingOrOptions?: EncodingOrOptions
  ): Promise<string | ArrayBuffer> {
    const options = parseOptions(encodingOrOptions);
    return RNFS2Nitro.read(normalizeFilePath(filepath), length, position).then(
      (buffer) => decodeContents(buffer, options.encoding)
    );
  },

  writeFile(
    filepath: string,
    contents: string,
    encodingOrOptions?: EncodingOrOptions
  ): Promise<void> {
    const options = parseOptions(encodingOrOptions);
    const data = encodeContents(contents, options.encoding);

    return RNFS2Nitro.writeFile(
      normalizeFilePath(filepath),
      data as ArrayBuffer
    );
  },

  appendFile(
    filepath: string,
    contents: string,
    encodingOrOptions?: EncodingOrOptions
  ): Promise<void> {
    const options = parseOptions(encodingOrOptions);
    const data = encodeContents(contents, options.encoding);
    return RNFS2Nitro.appendFile(
      normalizeFilePath(filepath),
      data as ArrayBuffer
    );
  },

  write(
    filepath: string,
    contents: string,
    position?: number,
    encodingOrOptions?: EncodingOrOptions
  ): Promise<void> {
    const options = parseOptions(encodingOrOptions);
    const data = encodeContents(contents, options.encoding);
    return RNFS2Nitro.write(
      normalizeFilePath(filepath),
      data as ArrayBuffer,
      position
    );
  },

  hash(filepath: string, algorithm: HashAlgorithm): Promise<string> {
    return RNFS2Nitro.hash(normalizeFilePath(filepath), algorithm);
  },

  touch(filepath: string, mtime?: Date, ctime?: Date): Promise<void> {
    return RNFS2Nitro.touch(
      normalizeFilePath(filepath),
      mtime?.getTime(),
      ctime?.getTime()
    );
  },

  scanFile(path: string): Promise<string[]> {
    return RNFS2Nitro.scanFile(path);
  },

  downloadFile(
    options: DownloadFileOptions & {
      begin?: (event: DownloadEventResult) => void;
      progress?: (event: DownloadEventResult) => void;
      complete?: (event: DownloadEventResult) => void;
      error?: (event: DownloadEventResult) => void;
      canBeResumed?: (event: DownloadEventResult) => void;
    }
  ): { jobId: number; promise: Promise<any> } {
    const jobId = getJobId();
    const subscriptions: Array<() => void> = [];

    if (options.begin) {
      downloadListeners.begin.set(jobId, options.begin);
      subscriptions.push(
        RNFS2Nitro.listenToDownloadBegin(jobId, (event) => {
          const cb = downloadListeners.begin.get(event.jobId);
          if (cb) cb(event);
        })
      );
    }
    if (options.progress) {
      downloadListeners.progress.set(jobId, options.progress);
      subscriptions.push(
        RNFS2Nitro.listenToDownloadProgress(jobId, (event) => {
          const cb = downloadListeners.progress.get(event.jobId);
          if (cb) cb(event);
        })
      );
    }
    if (options.complete) {
      downloadListeners.complete.set(jobId, options.complete);
      subscriptions.push(
        RNFS2Nitro.listenToDownloadComplete(jobId, (event) => {
          const cb = downloadListeners.complete.get(event.jobId);
          if (cb) cb(event);
        })
      );
    }
    if (options.error) {
      downloadListeners.error.set(jobId, options.error);
      subscriptions.push(
        RNFS2Nitro.listenToDownloadError(jobId, (event) => {
          const cb = downloadListeners.error.get(event.jobId);
          if (cb) cb(event);
        })
      );
    }
    if (options.canBeResumed) {
      downloadListeners.canBeResumed.set(jobId, options.canBeResumed);
      subscriptions.push(
        RNFS2Nitro.listenToDownloadCanBeResumed(jobId, (event) => {
          const cb = downloadListeners.canBeResumed.get(event.jobId);
          if (cb) cb(event);
        })
      );
    }

    const nitroOptions = {
      jobId: jobId,
      fromUrl: options.fromUrl,
      toFile: normalizeFilePath(options.toFile),
      background: !!options.background,
      progressDivider: options.progressDivider || 0,
      progressInterval: options.progressInterval || 0,
      readTimeout: options.readTimeout || 15000,
      connectionTimeout: options.connectionTimeout || 5000,
      backgroundTimeout: options.backgroundTimeout || 3600000, // 1 hour
    };

    return {
      jobId,
      promise: RNFS2Nitro.downloadFile(nitroOptions)
        .then((res: any) => {
          // unsubscribe all subscriptions
          subscriptions.forEach((unsubscribe) => unsubscribe());

          return res;
        })
        .catch((e: any) => {
          return Promise.reject(e);
        }),
    };
  },

  // --- Constants ---
  CachesDirectoryPath: RNFS2Nitro.cachesDirectoryPath,
  ExternalCachesDirectoryPath: RNFS2Nitro.externalCachesDirectoryPath,
  DocumentDirectoryPath: RNFS2Nitro.documentDirectoryPath,
  DownloadDirectoryPath: RNFS2Nitro.downloadDirectoryPath,
  ExternalDirectoryPath: RNFS2Nitro.externalDirectoryPath,
  ExternalStorageDirectoryPath: RNFS2Nitro.externalStorageDirectoryPath,
  TemporaryDirectoryPath: RNFS2Nitro.temporaryDirectoryPath,
  LibraryDirectoryPath: RNFS2Nitro.libraryDirectoryPath,
  PicturesDirectoryPath: RNFS2Nitro.picturesDirectoryPath,
};

/**
 * MediaStore
 */
export { default as MediaStore } from './_mediastore';

/**
 * Default export
 */
export default compat;
