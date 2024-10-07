package com.rnfs2;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;

import androidx.annotation.RequiresApi;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.module.annotations.ReactModule;

import com.rnfs2.Utils.FileDescription;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;

@ReactModule(name = RNFSMediaStoreManager.MODULE_NAME)
public class RNFSMediaStoreManager extends ReactContextBaseJavaModule {

  static final String MODULE_NAME = "RNFSMediaStoreManager";
  private static ReactApplicationContext reactContext;

  public enum MediaType {
    Audio,
    Image,
    Video,
    Download,
  }

  private static final String RNFSMediaStoreTypeAudio = MediaType.Audio.toString();
  private static final String RNFSMediaStoreTypeImage = MediaType.Image.toString();;
  private static final String RNFSMediaStoreTypeVideo = MediaType.Video.toString();;
  private static final String RNFSMediaStoreTypeDownload = MediaType.Download.toString();;

  public RNFSMediaStoreManager(ReactApplicationContext reactContext) {
    super(reactContext);
    RNFSMediaStoreManager.reactContext = reactContext;
  }

  @Override
  public String getName() {
    return MODULE_NAME;
  }

  private static Uri getMediaUri(MediaType mt) {
    Uri res = null;
    if (mt == MediaType.Audio) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        res = MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
      } else {
        res = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
      }
    } else if (mt == MediaType.Video) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        res = MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
      } else {
        res = MediaStore.Video.Media.EXTERNAL_CONTENT_URI;
      }
    } else if (mt == MediaType.Image) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        res = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
      } else {
        res = MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
      }
    } else if (mt == MediaType.Download) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        res = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
      }
    }

    return res;
  }

  private static String getRelativePath(MediaType mt, ReactApplicationContext ctx) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      if (mt == MediaType.Audio) return Environment.DIRECTORY_MUSIC;
      if (mt == MediaType.Video) return Environment.DIRECTORY_MOVIES;
      if (mt == MediaType.Image) return Environment.DIRECTORY_PICTURES;
      if (mt == MediaType.Download) return Environment.DIRECTORY_DOWNLOADS;
      return Environment.DIRECTORY_DOWNLOADS;
    } else {
      // throw error not supported
      return null;
    }
  }

  @ReactMethod
  public void createMediaFile(ReadableMap filedata, String mediaType, Promise promise) {
    if (!(filedata.hasKey("name") && filedata.hasKey("parentFolder") && filedata.hasKey("mimeType"))) {
      promise.reject("RNFS2.createMediaFile", "invalid filedata: " + filedata.toString());
      return;
    }
    if (mediaType == null) promise.reject("RNFS2.createMediaFile", "invalid mediatype");

    FileDescription file = new FileDescription(filedata.getString("name"), filedata.getString("mimeType"), filedata.getString("parentFolder"));
    Uri res = createNewMediaFile(file, MediaType.valueOf(mediaType), reactContext);
    if (res != null) promise.resolve(res.toString());
    else promise.reject("RNFS2.createMediaFile", "File could not be created");
  }

  @ReactMethod
  public void writeToMediaFile(String fileUri, String path, boolean transformFile, Promise promise) {
    boolean res = writeToMediaFile(Uri.parse(fileUri), path, transformFile, promise, reactContext);
    if (res) promise.resolve("Success");
  }

  @ReactMethod
  public void copyToMediaStore(ReadableMap filedata, String mediaType, String path, Promise promise) {
    if (!(filedata.hasKey("name") && filedata.hasKey("parentFolder") && filedata.hasKey("mimeType"))) {
      promise.reject("RNFS2.createMediaFile", "invalid filedata: " + filedata.toString());
      return;
    }
    if (mediaType == null) {
      promise.reject("RNFS2.createMediaFile", "invalid mediatype");
      return;
    }
    if (path == null) {
      promise.reject("RNFS2.createMediaFile", "invalid path");
      return;
    }

    FileDescription file = new FileDescription(filedata.getString("name"), filedata.getString("mimeType"), filedata.getString("parentFolder"));
    Uri fileuri = createNewMediaFile(file, MediaType.valueOf(mediaType), reactContext);

    if (fileuri == null) {
      promise.reject("RNFS2.createMediaFile", "File could not be created");
      return;
    }

    boolean res = writeToMediaFile(fileuri, path, false, promise, reactContext);
    if (res) promise.resolve(fileuri.toString());
  }

  public static Uri createNewMediaFile(FileDescription file, MediaType mediaType, ReactApplicationContext ctx) {
    // Add a specific media item.
    Context appCtx = reactContext.getApplicationContext();
    ContentResolver resolver = appCtx.getContentResolver();

    ContentValues fileDetails = new ContentValues();
    String relativePath = getRelativePath(mediaType, ctx);
    String mimeType = file.mimeType;

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      fileDetails.put(MediaStore.MediaColumns.DATE_ADDED, System.currentTimeMillis() / 1000);
      fileDetails.put(MediaStore.MediaColumns.DATE_MODIFIED, System.currentTimeMillis() / 1000);
      fileDetails.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
      fileDetails.put(MediaStore.MediaColumns.DISPLAY_NAME, file.name);
      fileDetails.put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath + '/' + file.partentFolder);

      Uri mediauri = getMediaUri(mediaType);

      try {
        // Keeps a handle to the new file's URI in case we need to modify it later.
        return resolver.insert(mediauri, fileDetails);
      } catch (Exception e) {
        return null;
      }
    } else {
      File f = new File(relativePath + file.getFullPath());
      if (true) {
        if (!f.exists()) {
          File parent = f.getParentFile();
          if (parent != null && !parent.exists() && !parent.mkdirs()) {
            return null;
          }
          try {
            if (f.createNewFile()) ;
            {
              return Uri.fromFile(f);
            }
          } catch (IOException ioException) {
            return null;
          }

        } else {
          return Uri.fromFile(f);
        }
      }
    }

    return null;
  }

  public static boolean writeToMediaFile(Uri fileUri, String data, boolean transformFile, Promise promise, ReactApplicationContext ctx) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      try {
        Context appCtx = ctx.getApplicationContext();
        ContentResolver resolver = appCtx.getContentResolver();

        // set pending doesn't work right now. We would have to requery for the item
        //ContentValues contentValues = new ContentValues();
        //contentValues.put(MediaStore.MediaColumns.IS_PENDING, 1);
        //resolver.update(fileUri, contentValues, null, null);

        // write data
        OutputStream stream = null;
        Uri uri = null;

        try {
          ParcelFileDescriptor descr;
          try {
            assert fileUri != null;
            descr = appCtx.getContentResolver().openFileDescriptor(fileUri, "w");
            assert descr != null;
            File src = new File(data);
            if (!src.exists()) {
              promise.reject("ENOENT", "No such file ('" + data + "')");
              return false;
            }


            FileInputStream fin = new FileInputStream(src);
            FileOutputStream out = new FileOutputStream(descr.getFileDescriptor());

            if (transformFile) {
              // in order to transform file, we must load the entire file onto memory
              int length = (int) src.length();
              byte[] bytes = new byte[length];
              fin.read(bytes);
              if (RNFSFileTransformer.sharedFileTransformer == null) {
                throw new IllegalStateException("Write to media file with transform was specified but the shared file transformer is not set");
              }
              byte[] transformedBytes = RNFSFileTransformer.sharedFileTransformer.onWriteFile(bytes);
              out.write(transformedBytes);
            } else  {
              byte[] buf = new byte[10240];
              int read;

              while ((read = fin.read(buf)) > 0) {
                out.write(buf, 0, read);
              }
            }

            fin.close();
            out.close();
            descr.close();
          } catch (Exception e) {
            e.printStackTrace();
            promise.reject(new IOException("Failed to get output stream."));
            return false;
          }

          //contentValues.clear();
          //contentValues.put(MediaStore.Video.Media.IS_PENDING, 0);
          //appCtx.getContentResolver().update(fileUri, contentValues, null, null);
          stream = resolver.openOutputStream(fileUri);
          if (stream == null) {
            promise.reject(new IOException("Failed to get output stream."));
            return false;
          }
        } catch (IOException e) {
          // Don't leave an orphan entry in the MediaStore
          resolver.delete(uri, null, null);
          promise.reject(e);
          return false;
        } finally {
          if (stream != null) {
            stream.close();
          }
        }

        // remove pending
        //contentValues = new ContentValues();
        //contentValues.put(MediaStore.MediaColumns.IS_PENDING, 0);
        //resolver.update(fileUri, contentValues, null, null);

      } catch (IOException e) {
        promise.reject("RNFS2.createMediaFile", "Cannot write to file, file might not exist");
        return false;
      }

      return true;
    } else {
      // throw error not supported
      return false;
    }
  }

  @ReactMethod
  public void exists(String fileUri, Promise promise) {
    try {
      Uri uri = Uri.parse(fileUri);
      ContentResolver resolver = reactContext.getContentResolver();
      Cursor cursor = resolver.query(uri, null, null, null, null);
      if (cursor != null && cursor.getCount() > 0) {
        promise.resolve(true);
      } else {
        promise.resolve(false);
      }
      if (cursor != null) {
        cursor.close();
      }
    } catch (Exception e) {
      promise.reject("RNFS2.exists", "Error checking file existence: " + e.getMessage());
    }
  }

  @Override
  public Map<String, Object> getConstants() {
    final Map<String, Object> constants = new HashMap<>();

    constants.put(RNFSMediaStoreTypeAudio, RNFSMediaStoreTypeAudio);
    constants.put(RNFSMediaStoreTypeImage, RNFSMediaStoreTypeImage);
    constants.put(RNFSMediaStoreTypeVideo, RNFSMediaStoreTypeVideo);
    constants.put(RNFSMediaStoreTypeDownload, RNFSMediaStoreTypeDownload);

    return constants;
  }
}
