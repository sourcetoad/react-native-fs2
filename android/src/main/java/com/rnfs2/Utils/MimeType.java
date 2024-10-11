package com.rnfs2.Utils;

import android.webkit.MimeTypeMap;

public class MimeType {
  static String UNKNOWN = "*/*";
  static String BINARY_FILE = "application/octet-stream";
  static String IMAGE = "image/*";
  static String AUDIO = "audio/*";
  static String VIDEO = "video/*";
  static String TEXT = "text/*";
  static String FONT = "font/*";
  static String APPLICATION = "application/*";
  static String CHEMICAL = "chemical/*";
  static String MODEL = "model/*";

  /**
   * * Given `name` = `ABC` AND `mimeType` = `video/mp4`, then return `ABC.mp4`
   * * Given `name` = `ABC` AND `mimeType` = `null`, then return `ABC`
   * * Given `name` = `ABC.mp4` AND `mimeType` = `video/mp4`, then return `ABC.mp4`
   *
   * @param name can have file extension or not
   */

  public static String getFullFileName(String name, String mimeType) {
    // Prior to API 29, MimeType.BINARY_FILE has no file extension
    String ext = MimeType.getExtensionFromMimeType(mimeType);
    if ((ext == null || ext.isEmpty()) || name.endsWith("." + ext)) return name;
    else {
      String fn = name + "." + ext;
      if (fn.endsWith(".")) return stripEnd(fn, ".");
      else return fn;
    }
  }

  /**
   * Some mime types return no file extension on older API levels. This function adds compatibility accross API levels.
   *
   * @see this.getExtensionFromMimeTypeOrFileName
   */

  public static String getExtensionFromMimeType(String mimeType) {
    if (mimeType != null) {
      if (mimeType.equals(BINARY_FILE)) return "bin";
      else return MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType);
    } else return "";
  }

  /**
   * @see this.getExtensionFromMimeType
   */
  public static String getExtensionFromMimeTypeOrFileName(String mimeType, String filename) {
    if (mimeType == null || mimeType.equals(UNKNOWN)) return substringAfterLast(filename, ".");
    else return getExtensionFromMimeType(mimeType);
  }

  /**
   * Some file types return no mime type on older API levels. This function adds compatibility across API levels.
   */
  public static String getMimeTypeFromExtension(String fileExtension) {
    if (fileExtension.equals("bin")) return BINARY_FILE;
    else {
      String mt = MimeTypeMap.getSingleton().getMimeTypeFromExtension(fileExtension);
      if (mt != null) return mt;
      else return UNKNOWN;
    }
  }

  public static String stripEnd(String str, String stripChars) {
    if (str == null || stripChars == null) {
      return str;
    }
    int end = str.length();
    while (end != 0 && stripChars.indexOf(str.charAt(end - 1)) != -1) {
      end--;
    }
    return str.substring(0, end);
  }

  public static String substringAfterLast(String str, String separator) {
    if (str == null) {
      return null;
    } else if (str.isEmpty()) {
      return "";
    } else {
      int pos = str.lastIndexOf(separator);
      if (pos == -1 || pos == str.length() - 1) {
        return "";
      }
      return str.substring(pos + 1);
    }
  }
}
