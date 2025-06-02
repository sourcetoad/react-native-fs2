package com.margelo.nitro.fs2.Utils

// Using a data class for simplicity and standard Kotlin features
data class MediaStoreQuery(
        val uri: String = "",
        val fileName: String = "",
        val relativePath: String = "",
        val mediaType: String?
) {
  // The primary constructor now handles the defaulting logic from the original Java constructor.
  // No secondary constructor is needed if direct data class instantiation is used.
}
