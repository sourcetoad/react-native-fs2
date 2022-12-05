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
  DownloadResult,
  Encoding,
  EncodingOrOptions,
  ProcessedOptions,
} from './types';

const RNFSManager = NativeModules.RNFSManager;
const RNFS_NativeEventEmitter = new NativeEventEmitter(RNFSManager);

const RNFSFileTypeRegular = RNFSManager.RNFSFileTypeRegular;
const RNFSFileTypeDirectory = RNFSManager.RNFSFileTypeDirectory;

let jobId = 0;

const getJobId = () => {
  jobId += 1;
  return jobId;
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

function encodeContents(contents: string, encoding: Encoding) {
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

function decodeContents(b64: string, encoding: Encoding) {
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

  readDir(dirPath: string): Promise<ReadDirItem[]> {
    return readDirGeneric(dirPath, RNFSManager.readDir);
  },

  // Node style version (lowercase d). Returns just the names
  readdir(dirpath: string): Promise<string[]> {
    return this.readDir(normalizeFilePath(dirpath)).then((files) => {
      return files.map((file) => file.name);
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

  readFile(filepath: string, encodingOrOptions?: EncodingOrOptions): Promise<string> {
    const options = parseOptions(encodingOrOptions);

    return RNFSManager.readFile(normalizeFilePath(filepath)).then((b64: string) => {
      return encodeContents(b64, options.encoding);
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

  writeFile(filepath: string, contents: string, encodingOrOptions?: EncodingOrOptions): Promise<null> {
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
    if (Platform.OS === 'ios') {
      ctimeTime = ctime && ctime.getTime();
    }
    return RNFSManager.touch(normalizeFilePath(filepath), mtime && mtime.getTime(), ctimeTime);
  },

  scanFile(path: string): Promise<ReadDirItem[]> {
    return RNFSManager.scanFile(path);
  },

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
  FileProtectionKeys: RNFSManager.RNFSFileProtectionKeys as String,
};
