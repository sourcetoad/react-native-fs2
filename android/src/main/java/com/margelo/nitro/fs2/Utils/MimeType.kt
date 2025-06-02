package com.margelo.nitro.fs2.Utils

import android.webkit.MimeTypeMap

object MimeType {
  const val UNKNOWN = "*/*"
  const val BINARY_FILE = "application/octet-stream"
  const val IMAGE = "image/*"
  const val AUDIO = "audio/*"
  const val VIDEO = "video/*"
  const val TEXT = "text/*"
  const val FONT = "font/*"
  const val APPLICATION = "application/*"
  const val CHEMICAL = "chemical/*"
  const val MODEL = "model/*"

  /**
   * * Given `name` = `ABC` AND `mimeType` = `video/mp4`, then return `ABC.mp4`
   * * Given `name` = `ABC` AND `mimeType` = `null`, then return `ABC`
   * * Given `name` = `ABC.mp4` AND `mimeType` = `video/mp4`, then return `ABC.mp4`
   *
   * @param name can have file extension or not
   */
  @JvmStatic // To be callable from Java as MimeType.getFullFileName
  fun getFullFileName(name: String, mimeType: String?): String {
    // Prior to API 29, MimeType.BINARY_FILE has no file extension
    val ext = getExtensionFromMimeType(mimeType)
    return if (ext.isNullOrEmpty() || name.endsWith(".$ext")) {
      name
    } else {
      val fn = "$name.$ext"
      if (fn.endsWith(".")) stripEnd(fn, ".") else fn
    }
  }

  /**
   * Some mime types return no file extension on older API levels. This function adds compatibility
   * across API levels.
   *
   * @see getExtensionFromMimeTypeOrFileName
   */
  @JvmStatic
  fun getExtensionFromMimeType(mimeType: String?): String? {
    return if (mimeType != null) {
      if (mimeType == BINARY_FILE) "bin"
      else MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType)
    } else {
      null // Return null for consistency, empty string was ambiguous
    }
  }

  /** @see getExtensionFromMimeType */
  @JvmStatic
  fun getExtensionFromMimeTypeOrFileName(mimeType: String?, filename: String): String {
    return if (mimeType == null || mimeType == UNKNOWN) {
      filename.substringAfterLast('.', "") // Provide a default value if not found
    } else {
      getExtensionFromMimeType(mimeType) ?: "" // Handle null from getExtensionFromMimeType
    }
  }

  /**
   * Some file types return no mime type on older API levels. This function adds compatibility
   * across API levels.
   */
  @JvmStatic
  fun getMimeTypeFromExtension(fileExtension: String?): String {
    return if (fileExtension == "bin") {
      BINARY_FILE
    } else {
      val mt = MimeTypeMap.getSingleton().getMimeTypeFromExtension(fileExtension)
      mt ?: UNKNOWN
    }
  }

  @JvmStatic
  fun stripEnd(str: String?, stripChars: String?): String {
    if (str == null || stripChars == null) {
      return str ?: ""
    }
    var end = str.length
    while (end != 0 && stripChars.indexOf(str[end - 1]) != -1) {
      end--
    }
    return str.substring(0, end)
  }

  // No need for substringAfterLast, Kotlin has a built-in String.substringAfterLast
  // Kept the original logic commented out for reference if specific behavior was intended.
  /*
  @JvmStatic
  fun substringAfterLast(str: String?, separator: String): String? {
      if (str == null) {
          return null
      }
      if (str.isEmpty()) {
          return ""
      }
      val pos = str.lastIndexOf(separator)
      return if (pos == -1 || pos == str.length - 1) {
          ""
      } else {
          str.substring(pos + 1)
      }
  }
  */
}
