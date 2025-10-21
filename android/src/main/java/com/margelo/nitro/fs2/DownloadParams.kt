package com.margelo.nitro.fs2

import com.facebook.react.bridge.ReadableMap
import java.io.File
import java.net.URL

class DownloadParams {
    var src: URL? = null
    var dest: File? = null
    var headers: ReadableMap? = null
    var progressInterval = 0
    var progressDivider = 0f
    var readTimeout = 0
    var connectionTimeout = 0

    // These will be populated by the callbacks received in the Fs2.downloadFile spec method
    var onDownloadBegin: ((event: DownloadEventResult) -> Unit)? = null
    var onDownloadProgress: ((event: DownloadEventResult) -> Unit)? = null
    var onDownloadComplete: ((result: DownloadEventResult) -> Unit)? = null
    var onDownloadError: ((event: DownloadEventResult) -> Unit)? = null

    var jobId: Int = 0
    var onCleanup: ((jobId: Int) -> Unit)? =
        null // Callback for Fs2 to clean up the downloader instance
}
