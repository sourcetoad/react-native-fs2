package com.margelo.nitro.fs2.Utils

// Using a data class for simplicity and standard Kotlin features
data class FileDescription(
        var name: String,
        var mimeType: String, // Made non-nullable as original constructor requires it
        var parentFolder: String = "" // Default to empty string if null in original constructor
) {
  // Constructor to match original Java if needed, though direct data class instantiation is
  // preferred in Kotlin
  // constructor(n: String, mT: String, pF: String?) :
  // this(name = n, mimeType = mT, parentFolder = pF ?: "")

  fun getFullPath(): String {
    // Assuming MimeType.getFullFileName will be available as a static/object method
    val fileNameWithExt = MimeType.getFullFileName(name, mimeType)
    return if (parentFolder.isNotEmpty()) {
      "$parentFolder/$fileNameWithExt"
    } else {
      fileNameWithExt
    }
  }
}
