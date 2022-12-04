import {
  EmitterSubscription,
  NativeEventEmitter,
  NativeModules,
  Platform,
} from 'react-native';
import { decode as atob, encode as btoa } from 'base-64';
import { decode as decode_utf8, encode as encode_utf8 } from 'utf8';
import type {
  MkdirOptions,
  FileOptions,
  FSInfoResult,
  ReadDirItem,
  StatResult,
  DownloadFileOptions,
  DownloadResult,
} from 'types';

const RNFSManager = NativeModules.RNFSManager;
const RNFS_NativeEventEmitter = new NativeEventEmitter(RNFSManager);

const isIOS = Platform.OS === 'ios';

const RNFSFileTypeRegular = RNFSManager.RNFSFileTypeRegular;
const RNFSFileTypeDirectory = RNFSManager.RNFSFileTypeDirectory;

let jobId = 0;

const getJobId = () => {
  jobId += 1;
  return jobId;
};

const normalizeFilePath = (path: string) =>
  path.startsWith('file://') ? path.slice(7) : path;

function readFileGeneric(
  filepath: string,
  encodingOrOptions: string | null,
  command: Function
) {
  let options = {
    encoding: 'utf8',
  };

  if (encodingOrOptions) {
    options.encoding = encodingOrOptions;
  }

  return command(normalizeFilePath(filepath)).then((b64: string) => {
    let contents;

    if (options.encoding === 'utf8') {
      contents = decode_utf8(atob(b64));
    } else if (options.encoding === 'ascii') {
      contents = atob(b64);
    } else if (options.encoding === 'base64') {
      contents = b64;
    } else {
      throw new Error(
        'Invalid encoding type "' + String(options.encoding) + '"'
      );
    }

    return contents;
  });
}

function readDirGeneric(dirPath: string, command: Function) {
  return command(normalizeFilePath(dirPath)).then((files: any[]) => {
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
}

const RNFS = {
  mkdir(filepath: string, options: MkdirOptions = {}): Promise<undefined> {
    return RNFSManager.mkdir(normalizeFilePath(filepath), options).then(
      () => void 0
    );
  },

  moveFile(
    filepath: string,
    destPath: string,
    options: FileOptions = {}
  ): Promise<void> {
    return RNFSManager.moveFile(
      normalizeFilePath(filepath),
      normalizeFilePath(destPath),
      options
    ).then(() => void 0);
  },

  copyFile(
    filepath: string,
    destPath: string,
    options: FileOptions = {}
  ): Promise<void> {
    return RNFSManager.copyFile(
      normalizeFilePath(filepath),
      normalizeFilePath(destPath),
      options
    ).then(() => void 0);
  },

  getFSInfo(): Promise<FSInfoResult> {
    return RNFSManager.getFSInfo();
  },

  getAllExternalFilesDirs(): Promise<string> {
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

  readDir(dirpath: string): Promise<ReadDirItem[]> {
    return readDirGeneric(dirpath, RNFSManager.readDir);
  },

  // Android-only
  readDirAssets(dirpath: string): Promise<ReadDirItem[]> {
    if (!RNFSManager.readDirAssets) {
      throw new Error('readDirAssets is not available on this platform');
    }
    return readDirGeneric(dirpath, RNFSManager.readDirAssets);
  },

  // Android-only
  existsAssets(filepath: string) {
    if (!RNFSManager.existsAssets) {
      throw new Error('existsAssets is not available on this platform');
    }
    return RNFSManager.existsAssets(filepath);
  },

  // Android-only
  existsRes(filename: string) {
    if (!RNFSManager.existsRes) {
      throw new Error('existsRes is not available on this platform');
    }
    return RNFSManager.existsRes(filename);
  },

  // Node style version (lowercase d). Returns just the names
  readdir(dirpath: string): Promise<string[]> {
    return RNFS.readDir(normalizeFilePath(dirpath)).then((files) => {
      return files.map((file) => file.name);
    });
  },

  // setReadable for Android
  setReadable(
    filepath: string,
    readable: boolean,
    ownerOnly: boolean
  ): Promise<boolean> {
    return RNFSManager.setReadable(filepath, readable, ownerOnly).then(
      (result: any) => {
        return result;
      }
    );
  },

  stat(filepath: string): Promise<StatResult> {
    return RNFSManager.stat(normalizeFilePath(filepath)).then(
      (result: StatResult) => {
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
      }
    );
  },

  readFile(filepath: string, encodingOrOptions?: any): Promise<string> {
    return readFileGeneric(filepath, encodingOrOptions, RNFSManager.readFile);
  },

  read(
    filepath: string,
    length: number = 0,
    position: number = 0,
    encodingOrOptions?: any
  ): Promise<string> {
    let options = {
      encoding: 'utf8',
    };

    if (encodingOrOptions) {
      if (typeof encodingOrOptions === 'string') {
        options.encoding = encodingOrOptions;
      } else if (typeof encodingOrOptions === 'object') {
        options = encodingOrOptions;
      }
    }

    return RNFSManager.read(normalizeFilePath(filepath), length, position).then(
      (b64: string) => {
        let contents;

        if (options.encoding === 'utf8') {
          contents = decode_utf8(atob(b64));
        } else if (options.encoding === 'ascii') {
          contents = atob(b64);
        } else if (options.encoding === 'base64') {
          contents = b64;
        } else {
          throw new Error(
            'Invalid encoding type "' + String(options.encoding) + '"'
          );
        }

        return contents;
      }
    );
  },

  // Android only
  readFileAssets(filepath: string, encodingOrOptions?: any): Promise<string> {
    if (!RNFSManager.readFileAssets) {
      throw new Error('readFileAssets is not available on this platform');
    }
    return readFileGeneric(
      filepath,
      encodingOrOptions,
      RNFSManager.readFileAssets
    );
  },

  // Android only
  readFileRes(filename: string, encodingOrOptions?: any): Promise<string> {
    if (!RNFSManager.readFileRes) {
      throw new Error('readFileRes is not available on this platform');
    }
    return readFileGeneric(
      filename,
      encodingOrOptions,
      RNFSManager.readFileRes
    );
  },

  hash(filepath: string, algorithm: string): Promise<string> {
    return RNFSManager.hash(normalizeFilePath(filepath), algorithm);
  },

  // Android only
  copyFileAssets(filepath: string, destPath: string) {
    if (!RNFSManager.copyFileAssets) {
      throw new Error('copyFileAssets is not available on this platform');
    }
    return RNFSManager.copyFileAssets(
      normalizeFilePath(filepath),
      normalizeFilePath(destPath)
    ).then(() => void 0);
  },

  // Android only
  copyFileRes(filename: string, destPath: string) {
    if (!RNFSManager.copyFileRes) {
      throw new Error('copyFileRes is not available on this platform');
    }
    return RNFSManager.copyFileRes(filename, normalizeFilePath(destPath)).then(
      () => void 0
    );
  },

  writeFile(
    filepath: string,
    contents: string,
    encodingOrOptions?: any
  ): Promise<void> {
    let b64;

    let options = {
      encoding: 'utf8',
    };

    if (encodingOrOptions) {
      if (typeof encodingOrOptions === 'string') {
        options.encoding = encodingOrOptions;
      } else if (typeof encodingOrOptions === 'object') {
        options = {
          ...options,
          ...encodingOrOptions,
        };
      }
    }

    if (options.encoding === 'utf8') {
      b64 = btoa(atob(contents));
    } else if (options.encoding === 'ascii') {
      b64 = btoa(contents);
    } else if (options.encoding === 'base64') {
      b64 = contents;
    } else {
      throw new Error('Invalid encoding type "' + options.encoding + '"');
    }

    return RNFSManager.writeFile(
      normalizeFilePath(filepath),
      b64,
      options
    ).then(() => void 0);
  },

  appendFile(
    filepath: string,
    contents: string,
    encodingOrOptions?: any
  ): Promise<void> {
    let b64;

    let options = {
      encoding: 'utf8',
    };

    if (encodingOrOptions) {
      if (typeof encodingOrOptions === 'string') {
        options.encoding = encodingOrOptions;
      } else if (typeof encodingOrOptions === 'object') {
        options = encodingOrOptions;
      }
    }

    if (options.encoding === 'utf8') {
      b64 = btoa(encode_utf8(contents));
    } else if (options.encoding === 'ascii') {
      b64 = btoa(contents);
    } else if (options.encoding === 'base64') {
      b64 = contents;
    } else {
      throw new Error('Invalid encoding type "' + options.encoding + '"');
    }

    return RNFSManager.appendFile(normalizeFilePath(filepath), b64);
  },

  write(
    filepath: string,
    contents: string,
    position?: number,
    encodingOrOptions?: any
  ): Promise<void> {
    let b64;

    let options = {
      encoding: 'utf8',
    };

    if (encodingOrOptions) {
      if (typeof encodingOrOptions === 'string') {
        options.encoding = encodingOrOptions;
      } else if (typeof encodingOrOptions === 'object') {
        options = encodingOrOptions;
      }
    }

    if (options.encoding === 'utf8') {
      b64 = btoa(encode_utf8(contents));
    } else if (options.encoding === 'ascii') {
      b64 = atob(contents);
    } else if (options.encoding === 'base64') {
      b64 = contents;
    } else {
      throw new Error('Invalid encoding type "' + options.encoding + '"');
    }

    if (position === undefined) {
      position = -1;
    }

    return RNFSManager.write(normalizeFilePath(filepath), b64, position).then(
      () => void 0
    );
  },

  downloadFile(options: DownloadFileOptions): {
    jobId: number;
    promise: Promise<DownloadResult>;
  } {
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
    if (isIOS) {
      ctimeTime = ctime && ctime.getTime();
    }
    return RNFSManager.touch(
      normalizeFilePath(filepath),
      mtime && mtime.getTime(),
      ctimeTime
    );
  },

  scanFile(path: string): Promise<ReadDirItem[]> {
    return RNFSManager.scanFile(path);
  },

  MainBundlePath: RNFSManager.RNFSMainBundlePath,
  CachesDirectoryPath: RNFSManager.RNFSCachesDirectoryPath,
  ExternalCachesDirectoryPath: RNFSManager.RNFSExternalCachesDirectoryPath,
  DocumentDirectoryPath: RNFSManager.RNFSDocumentDirectoryPath,
  DownloadDirectoryPath: RNFSManager.RNFSDownloadDirectoryPath,
  ExternalDirectoryPath: RNFSManager.RNFSExternalDirectoryPath,
  ExternalStorageDirectoryPath: RNFSManager.RNFSExternalStorageDirectoryPath,
  TemporaryDirectoryPath: RNFSManager.RNFSTemporaryDirectoryPath,
  LibraryDirectoryPath: RNFSManager.RNFSLibraryDirectoryPath,
  PicturesDirectoryPath: RNFSManager.RNFSPicturesDirectoryPath,
  FileProtectionKeys: RNFSManager.RNFSFileProtectionKeys,
};

export default RNFS;
