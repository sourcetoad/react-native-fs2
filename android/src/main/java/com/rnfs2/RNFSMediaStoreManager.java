package com.rnfs2;

import android.app.RecoverableSecurityException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.util.Log;

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
import com.rnfs2.Utils.MediaStoreQuery;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;

@ReactModule(name = RNFSMediaStoreManager.MODULE_NAME)
public class RNFSMediaStoreManager extends ReactContextBaseJavaModule {

  static final String MODULE_NAME = "RNFSMediaStoreManager";
  private final ReactApplicationContext reactContext;

  public enum MediaType {
    Audio,
    Image,
    Video,
    Download,
  }

  private static final String RNFSMediaStoreTypeAudio = MediaType.Audio.toString();
  private static final String RNFSMediaStoreTypeImage = MediaType.Image.toString();
  private static final String RNFSMediaStoreTypeVideo = MediaType.Video.toString();
  private static final String RNFSMediaStoreTypeDownload = MediaType.Download.toString();

  public RNFSMediaStoreManager(ReactApplicationContext reactContext) {
    super(reactContext);
    this.reactContext = reactContext;
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
      if (mt == MediaType.Audio) {
        return Environment.DIRECTORY_MUSIC;
      }

      if (mt == MediaType.Video) {
        return Environment.DIRECTORY_MOVIES;
      }

      if (mt == MediaType.Image) {
        return Environment.DIRECTORY_PICTURES;
      }

      if (mt == MediaType.Download) {
        return Environment.DIRECTORY_DOWNLOADS;
      }

      return Environment.DIRECTORY_DOWNLOADS;
    } else {
      // throw error not supported
      return null;
    }
  }

  @ReactMethod
  public void createMediaFile(ReadableMap filedata, String mediaType, Promise promise) {
    if (!(filedata.hasKey("name") && filedata.hasKey("parentFolder") && filedata.hasKey("mimeType"))) {
      promise.reject("RNFS2.createMediaFile", "Invalid filedata: " + filedata.toString());
      return;
    }

    if (mediaType == null) {
      promise.reject("RNFS2.createMediaFile", "Invalid mediatype");
    }

    FileDescription file = new FileDescription(filedata.getString("name"), filedata.getString("mimeType"), filedata.getString("parentFolder"));
    Uri res = createNewMediaFile(file, MediaType.valueOf(mediaType), promise, reactContext);

    if (res != null) {
      promise.resolve(res.toString());
    } else {
      promise.reject("RNFS2.createMediaFile", "File could not be created");
    }
  }

  @ReactMethod void updateMediaFile(String fileUri, ReadableMap filedata, String mediaType, Promise promise) {
    if (!(filedata.hasKey("name") && filedata.hasKey("parentFolder") && filedata.hasKey("mimeType"))) {
      promise.reject("RNFS2.updateMediaFile", "Invalid filedata: " + filedata.toString());
      return;
    }

    if (mediaType == null) {
      promise.reject("RNFS2.updateMediaFile", "Invalid mediatype");
      return;
    }

    FileDescription file = new FileDescription(filedata.getString("name"), filedata.getString("mimeType"), filedata.getString("parentFolder"));
    Uri fileuri = Uri.parse(fileUri);
    boolean res = updateExistingMediaFile(fileuri, file, MediaType.valueOf(mediaType), promise, reactContext);
    if (res) {
      promise.resolve("Success");
    }
  }

  @ReactMethod
  public void writeToMediaFile(String fileUri, String path, boolean transformFile, Promise promise) {
    boolean res = writeToMediaFile(Uri.parse(fileUri), path, transformFile, false, promise, reactContext);
    if (res) {
      promise.resolve("Success");
    }
  }

  @ReactMethod
  public void copyToMediaStore(ReadableMap filedata, String mediaType, String path, Promise promise) {
    if (!(filedata.hasKey("name") && filedata.hasKey("parentFolder") && filedata.hasKey("mimeType"))) {
      promise.reject("RNFS2.copyToMediaStore", "Invalid filedata: " + filedata.toString());
      return;
    }

    if (mediaType == null) {
      promise.reject("RNFS2.copyToMediaStore", "Invalid mediatype");
      return;
    }

    if (path == null) {
      promise.reject("RNFS2.copyToMediaStore", "Invalid path");
      return;
    }

    try {
      File srcFile = new File(path);
      if (!srcFile.exists()) {
        promise.reject("RNFS2.copyToMediaStore", "No such file ('" + path + "')");
        return;
      }
    } catch (Exception e) {
      promise.reject("RNFS2.copyToMediaStore", "Error accessing source file: " + e.getMessage(), e);
      return;
    }

    ContentResolver resolver = reactContext.getContentResolver();
    Uri fileUri = null;

    try {
      FileDescription fileDesc = new FileDescription(filedata.getString("name"), filedata.getString("mimeType"), filedata.getString("parentFolder"));
      
      fileUri = createNewMediaFile(fileDesc, MediaType.valueOf(mediaType), promise, reactContext);

      if (fileUri == null) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) { 
             promise.reject("RNFS2.copyToMediaStore", "Failed to create initial media file entry (null URI from createNewMediaFile on Q+).");
        }
        return; 
      }

      ContentValues pendingValues = new ContentValues();
      pendingValues.put(MediaStore.MediaColumns.IS_PENDING, 1);
      if (resolver.update(fileUri, pendingValues, null, null) == 0) {
        cleanupMediaStoreEntry(fileUri, resolver);
        promise.reject("RNFS2.copyToMediaStore", "Failed to mark media file as pending (0 rows updated). Original entry cleaned up.");
        return; 
      }

      boolean writeSuccessful = writeToMediaFile(fileUri, path, false, true, promise, reactContext);

      if (writeSuccessful) {
        ContentValues commitValues = new ContentValues();
        commitValues.put(MediaStore.MediaColumns.IS_PENDING, 0);
        if (resolver.update(fileUri, commitValues, null, null) > 0) {
          promise.resolve(fileUri.toString()); 
        } else {
          cleanupMediaStoreEntry(fileUri, resolver);
          promise.reject("RNFS2.copyToMediaStore", "Failed to commit media file (unmark as pending - 0 rows updated). Entry with data cleaned up.");
        }
      }
      // If writeSuccessful is false, writeToMediaFile has already rejected and handled cleanup.

    } catch (Exception e) { 
      if (fileUri != null) {
        cleanupMediaStoreEntry(fileUri, resolver);
      }
      promise.reject("RNFS2.copyToMediaStore", "Unexpected error during copyToMediaStore: " + e.getMessage(), e);
    }
  }

  @ReactMethod
  public void query(ReadableMap query, Promise promise) {
    try {
      MediaStoreQuery mediaStoreQuery = new MediaStoreQuery(query.getString("uri"), query.getString("fileName"), query.getString("relativePath"), query.getString("mediaType"));
      WritableMap queryResult = query(mediaStoreQuery, promise, reactContext);
      promise.resolve(queryResult);
    } catch (Exception e) {
      promise.reject("RNFS2.query", "Error checking file existence: " + e.getMessage());
    }
  }

  @ReactMethod
  public void delete(String fileUri, Promise promise) {
    try {
      Uri uri = Uri.parse(fileUri);
      ContentResolver resolver = reactContext.getContentResolver();
      int res = resolver.delete(uri, null, null);
      if (res > 0) {
        promise.resolve(true);
      } else {
        promise.resolve(false);
      }
    } catch (Exception e) {
      promise.reject("RNFS2.delete", "Error deleting file: " + e.getMessage());
    }
  }

  private Uri createNewMediaFile(FileDescription file, MediaType mediaType, Promise promise, ReactApplicationContext ctx) {
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
      fileDetails.put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath + '/' + file.parentFolder);

      Uri mediauri = getMediaUri(mediaType);

      try {
        // Keeps a handle to the new file's URI in case we need to modify it later.
        return resolver.insert(mediauri, fileDetails);
      } catch (Exception e) {
        return null;
      }
    } else {
      // throw error not supported
      promise.reject("RNFS2.createNewMediaFile", "Android version not supported");
    }

    return null;
  }

  private boolean updateExistingMediaFile(Uri fileUri, FileDescription file, MediaType mediaType, Promise promise, ReactApplicationContext ctx) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      try {
        Context appCtx = ctx.getApplicationContext();
        ContentResolver resolver = appCtx.getContentResolver();

        ContentValues fileDetails = new ContentValues();
        String relativePath = getRelativePath(mediaType, ctx);
        String mimeType = file.mimeType;

        fileDetails.put(MediaStore.MediaColumns.DATE_MODIFIED, System.currentTimeMillis() / 1000);
        fileDetails.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
        fileDetails.put(MediaStore.MediaColumns.DISPLAY_NAME, file.name);
        fileDetails.put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath + '/' + file.parentFolder);

        int rowsUpdated = 0;
        try {
          rowsUpdated = resolver.update(fileUri, fileDetails, null, null);
        } catch (SecurityException securityException) {
          if (securityException instanceof RecoverableSecurityException) {
            promise.reject("ERR_RECOVERABLE_SECURITY", "App needs user permission to modify this file." + securityException.getMessage());
          } else {
            promise.reject("ERR_SECURITY_EXCEPTION", "SecurityException occurred during update: " + securityException.getMessage());
          }

          return false;
        }
        return rowsUpdated > 0;
      } catch (Exception e) {
        promise.reject("RNFS2.updateExistingMediaFile", "Error updating file: " + e.getMessage(), e);
        return false;
      }
    } else {
      promise.reject("RNFS2.updateExistingMediaFile", "Android version not supported");
      return false;
    }
  }

  private void cleanupMediaStoreEntry(Uri fileUri, ContentResolver resolver) {
    try {
      resolver.delete(fileUri, null, null);
    } catch (Exception deleteError) {
      Log.e("RNFS2", "Failed to cleanup MediaStore entry: " + deleteError.getMessage());
    }
  }

  private boolean writeToMediaFile(Uri fileUri, String filePath, boolean transformFile, boolean shouldCleanupOnFailure, Promise promise, ReactApplicationContext ctx) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      Context appCtx = ctx.getApplicationContext();
      ContentResolver resolver = appCtx.getContentResolver();
      OutputStream stream = null;

      try {
        if (fileUri == null) {
          promise.reject("RNFS2.createMediaFile", "Invalid file URI");
          return false;
        }

        File src = new File(filePath);
        if (!src.exists()) {
          promise.reject("ENOENT", "No such file ('" + filePath + "')");
          return false;
        }

        ParcelFileDescriptor descr = appCtx.getContentResolver().openFileDescriptor(fileUri, "w");
        if (descr == null) {
          promise.reject("RNFS2.createMediaFile", "Failed to open file descriptor");
          return false;
        }

        try (descr; FileInputStream fin = new FileInputStream(src); FileOutputStream out = new FileOutputStream(descr.getFileDescriptor())) {
          if (transformFile) {
            int length = (int) src.length();
            byte[] bytes = new byte[length];
            fin.read(bytes);
            if (RNFSFileTransformer.sharedFileTransformer == null) {
              throw new IllegalStateException("Write to media file with transform was specified but the shared file transformer is not set");
            }
            byte[] transformedBytes = RNFSFileTransformer.sharedFileTransformer.onWriteFile(bytes);
            out.write(transformedBytes);
          } else {
            byte[] buf = new byte[1024 * 10];
            int read;
            while ((read = fin.read(buf)) > 0) {
              out.write(buf, 0, read);
            }
          }
        }

        stream = resolver.openOutputStream(fileUri);

        if (stream == null) {
          promise.reject(new IOException("Failed to get output stream."));
          return false;
        }
      } catch (Exception e) {
        if (shouldCleanupOnFailure) {
          cleanupMediaStoreEntry(fileUri, resolver);
        }
        
        promise.reject("RNFS2.createMediaFile", "Failed to write file: " + e.getMessage());
        return false;
      } finally {
        if (stream != null) {
          try {
            stream.close();
          } catch (IOException e) {
            Log.e("RNFS2", "Failed to close output stream: " + e.getMessage());
          }
        }
      }

      return true;
    } else {
      promise.reject("RNFS2.createMediaFile", "Android version not supported");
      return false;
    }
  }

  private WritableMap query(MediaStoreQuery query, Promise promise, ReactApplicationContext ctx) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      Cursor cursor = null;
      try {
        Context appCtx = ctx.getApplicationContext();
        ContentResolver resolver = appCtx.getContentResolver();
        WritableMap queryResultsMap = Arguments.createMap();

        Uri mediaURI = !Objects.equals(query.uri, "") ? Uri.parse(query.uri) : getMediaUri(MediaType.valueOf(query.mediaType));
        String[] projection = {MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.RELATIVE_PATH};

        String selection = null;
        String[] selectionArgs = null;

        if (Objects.equals(query.uri, "")) {
          String relativePath = getRelativePath(MediaType.valueOf(query.mediaType), ctx);
          selection = MediaStore.MediaColumns.DISPLAY_NAME + " = ? AND " + MediaStore.MediaColumns.RELATIVE_PATH + " = ?";
          selectionArgs = new String[]{query.fileName, relativePath + '/' + query.relativePath + '/'};
        }

        // query the media store
        cursor = resolver.query(mediaURI, projection, selection, selectionArgs, null);

        if (cursor != null && cursor.moveToFirst()) {
          int idColumnIndex = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID);
          long id = cursor.getLong(idColumnIndex);

          Uri contentUri = Uri.withAppendedPath(mediaURI, String.valueOf(id));

          queryResultsMap.putString("contentUri", contentUri.toString());
          
          promise.resolve(queryResultsMap);
        } else {
          promise.resolve(null);
        }

        return queryResultsMap;
      } catch (Exception e) {
        return null;
      } finally {
        if (cursor != null) {
          cursor.close();
        }
      }
    } else {
      // throw error not supported
      promise.reject("RNFS2.exists", "Android version not supported");
      return null;
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
