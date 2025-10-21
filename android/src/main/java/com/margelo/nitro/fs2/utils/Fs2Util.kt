package com.margelo.nitro.fs2.utils

import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import androidx.core.net.toUri
import java.io.File
import com.margelo.nitro.fs2.IORejectionException

object Fs2Util {
    fun getFileUri(filepath: String, isDirectoryAllowed: Boolean = false): Uri {
        val uri = filepath.toUri()
        if (uri.scheme == null) {
            val file = File(filepath)
            if (!isDirectoryAllowed && file.isDirectory) {
                throw IORejectionException(
                    "EISDIR",
                    "EISDIR: illegal operation on a directory, read '$filepath'"
                )
            }
            return "file://$filepath".toUri()
        }
        return uri
    }

    fun getOriginalFilepath(context: Context, filepath: String, isDirectoryAllowed: Boolean = false): String {
        val uri = getFileUri(filepath, isDirectoryAllowed)
        var originalFilepath = filepath
        if ("content" == uri.scheme) {
            try {
                context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        val columnIndex = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATA)
                        originalFilepath = cursor.getString(columnIndex)
                    }
                }
            } catch (e: IllegalArgumentException) {
                // Ignored in original code
            }
        }
        return originalFilepath
    }
} 