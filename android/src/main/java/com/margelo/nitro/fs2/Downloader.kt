package com.margelo.nitro.fs2

import android.os.Build
import android.util.Log
import com.margelo.nitro.core.AnyMap
import java.io.BufferedInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.roundToInt
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

// AsyncTask has been replaced with Kotlin Coroutines.
class Downloader {
    private val _job = SupervisorJob() // Parent job for this Downloader instance's scope
    private val scope = CoroutineScope(Dispatchers.IO + _job) // Scope for this Downloader

    private var mParam: DownloadParams? = null
    private var jobId: Int = 0
    private var activeDownloadJob: Job? = null // The job for the currently active download

    // Private data class to hold the outcome of the internal download operation
    private data class DownloadOperationOutcome(val statusCode: Double, val bytesWritten: Double)

    fun start(params: DownloadParams) {
        mParam = params
        jobId = params.jobId // Assuming jobId is part of DownloadParams

        activeDownloadJob = scope.launch {
            val currentParams = mParam ?: return@launch

            try {
                Log.d(
                    "Downloader",
                    "Starting download for job $jobId on thread ${Thread.currentThread().name}"
                )
                ensureActive() // Check if coroutine is active before starting download logic

                // The download function now returns an outcome with statusCode and bytesWritten
                val outcome = download(currentParams)

                ensureActive() // Check if active before invoking completion callback

                // Construct the final DownloadResult for the callback
                val completeResult = DownloadEventResult(
                    jobId = jobId.toDouble(),
                    headers = null,
                    contentLength = null,
                    statusCode = outcome.statusCode,
                    bytesWritten = outcome.bytesWritten,
                    error = null
                )
                currentParams.onDownloadComplete?.invoke(completeResult)
                Log.d(
                    "Downloader",
                    "Download $jobId completed successfully with status ${outcome.statusCode.toInt()}."
                )

            } catch (e: CancellationException) {
                Log.i("Downloader", "Download $jobId cancelled: ${e.message}")
                val errorEvent = DownloadEventResult(
                    jobId = jobId.toDouble(),
                    headers = null,
                    contentLength = null,
                    statusCode = null,
                    bytesWritten = null,
                    error = e.message ?: "Download cancelled"
                )
                currentParams.onDownloadError?.invoke(errorEvent)
            } catch (ex: Exception) {
                Log.e("Downloader", "Download $jobId error: ${ex.message}", ex)
                val errorEvent = DownloadEventResult(
                    jobId = jobId.toDouble(),
                    headers = null,
                    contentLength = null,
                    statusCode = null,
                    bytesWritten = null,
                    error = ex.message ?: "Unknown download error"
                )
                currentParams.onDownloadError?.invoke(errorEvent)
            } finally {
                Log.d("Downloader", "Cleaning up for job $jobId via onCleanup callback.")
                currentParams.onCleanup?.invoke(jobId)
            }
        }
    }

    @Throws(Exception::class)
    private suspend fun download(param: DownloadParams): DownloadOperationOutcome {
        // The actual blocking operations will be wrapped in withContext(Dispatchers.IO)
        return withContext(Dispatchers.IO) {
            var input: InputStream? = null
            var output: FileOutputStream? = null
            var connection: HttpURLConnection? = null

            // These variables will determine the outcome returned by this withContext block
            var outcomeStatusCode: Double = 0.0
            var outcomeBytesWritten: Double = 0.0

            try {
                coroutineContext.ensureActive() // Still uses the outer coroutine's context for cancellation

                connection =
                    param.src?.openConnection() as? HttpURLConnection
                        ?: throw Exception("Could not open connection to ${param.src}")

                param.headers?.let { headers ->
                    val iterator = headers.keySetIterator()
                    while (iterator.hasNextKey()) {
                        val key = iterator.nextKey()
                        connection!!.setRequestProperty(key, headers.getString(key))
                    }
                }

                connection.connectTimeout = param.connectionTimeout
                connection.readTimeout = param.readTimeout
                Log.d("Downloader", "Job $jobId: Connecting to ${param.src}")
                connection.connect()
                coroutineContext.ensureActive()

                val httpStatusCode = connection.responseCode
                var lengthOfFile = getContentLength(connection)
                Log.d(
                    "Downloader",
                    "Job $jobId: Initial status code $httpStatusCode, length $lengthOfFile"
                )

                var currentHttpCode = httpStatusCode
                var currentConnection = connection // Use this for operations within the try block

                val isRedirect =
                    currentHttpCode != HttpURLConnection.HTTP_OK &&
                            (currentHttpCode == HttpURLConnection.HTTP_MOVED_PERM ||
                                    currentHttpCode == HttpURLConnection.HTTP_MOVED_TEMP ||
                                    currentHttpCode == 307 ||
                                    currentHttpCode == 308)

                if (isRedirect) {
                    val redirectURL = currentConnection.getHeaderField("Location")
                    Log.d("Downloader", "Job $jobId: Redirecting to $redirectURL")
                    currentConnection.disconnect() // Disconnect the connection that redirected

                    coroutineContext.ensureActive()
                    // Assign to the outer 'connection' variable for the finally block to correctly disconnect it
                    connection = URL(redirectURL).openConnection() as? HttpURLConnection
                        ?: throw Exception("Could not open redirected connection to $redirectURL")
                    connection.connectTimeout = param.connectionTimeout
                    connection.readTimeout = param.readTimeout
                    connection.connect()
                    coroutineContext.ensureActive()

                    currentConnection = connection // Update currentConnection to the new connection
                    currentHttpCode = currentConnection.responseCode
                    lengthOfFile = getContentLength(currentConnection)
                    Log.d(
                        "Downloader",
                        "Job $jobId: Redirected status code $currentHttpCode, length $lengthOfFile"
                    )
                }

                outcomeStatusCode = currentHttpCode.toDouble()

                if (currentHttpCode in 200..299) {
                    Log.d("Downloader", "Job $jobId: Download starting (status $currentHttpCode).")
                    val responseHeaders = mutableMapOf<String, String>()
                    currentConnection.headerFields.forEach { (key, values) ->
                        if (key != null && values.isNotEmpty()) {
                            responseHeaders[key] = values[0]
                        }
                    }

                    val tempHeaderMap = AnyMap()
                    responseHeaders.forEach { (key, value) ->
                        tempHeaderMap.setString(key, value)
                    }

                    val beginEvent = DownloadEventResult(
                        jobId = jobId.toDouble(),
                        headers = tempHeaderMap,
                        contentLength = lengthOfFile.toDouble(),
                        statusCode = null,
                        bytesWritten = null,
                        error = null
                    )
                    param.onDownloadBegin?.invoke(beginEvent)

                    input = BufferedInputStream(currentConnection.inputStream, 8 * 1024)
                    output = FileOutputStream(param.dest)

                    val data = ByteArray(8 * 1024)
                    var total: Long = 0
                    var count: Int
                    var lastProgressValue = 0.0
                    var lastProgressEmitTimestamp = 0L
                    val hasProgressCallback = param.onDownloadProgress != null

                    while (input.read(data).also { count = it } != -1) {
                        coroutineContext.ensureActive()
                        total += count

                        if (hasProgressCallback) {
                            val progressEvent = DownloadEventResult(
                                jobId = jobId.toDouble(),
                                headers = null,
                                contentLength = lengthOfFile.toDouble(),
                                statusCode = null,
                                bytesWritten = total.toDouble(),
                                error = null
                            )
                            var shouldInvokeProgress = false
                            if (param.progressInterval > 0) {
                                val timestamp = System.currentTimeMillis()
                                if (timestamp - lastProgressEmitTimestamp > param.progressInterval) {
                                    lastProgressEmitTimestamp = timestamp
                                    shouldInvokeProgress = true
                                }
                            } else if (param.progressDivider <= 0f) {
                                shouldInvokeProgress = true
                            } else {
                                if (lengthOfFile > 0) {
                                    val progressPercentage =
                                        ((total.toDouble() * 100) / lengthOfFile).roundToInt()
                                    if (param.progressDivider > 0 && progressPercentage % param.progressDivider.toInt() == 0) {
                                        if ((progressPercentage.toDouble() != lastProgressValue) || (total == lengthOfFile)) {
                                            lastProgressValue = progressPercentage.toDouble()
                                            shouldInvokeProgress = true
                                        }
                                    } else if (param.progressDivider == 0f && total == lengthOfFile) {
                                        lastProgressValue = progressPercentage.toDouble()
                                        shouldInvokeProgress = true
                                    }
                                }
                            }
                            if (shouldInvokeProgress) {
                                param.onDownloadProgress?.invoke(progressEvent)
                            }
                        }
                        output.write(data, 0, count)
                    }
                    output.flush()
                    output.fd.sync()
                    outcomeBytesWritten = total.toDouble()
                    Log.d("Downloader", "Job $jobId: Finished writing $total bytes.")
                } else {
                    Log.w(
                        "Downloader",
                        "Job $jobId: Server returned non-successful status: $currentHttpCode. Bytes written set to 0."
                    )
                    outcomeBytesWritten = 0.0
                }
            } finally {
                try {
                    output?.close()
                } catch (e: Exception) {
                    Log.e("Downloader", "Job $jobId: Error closing output stream", e)
                }
                try {
                    input?.close()
                } catch (e: Exception) {
                    Log.e("Downloader", "Job $jobId: Error closing input stream", e)
                }
                // 'connection' here refers to the latest HttpURLConnection object that was opened (original or redirected).
                connection?.disconnect()
                Log.d("Downloader", "Job $jobId: Connection resources released within withContext.")
            }
            // This is the return value of the withContext block
            DownloadOperationOutcome(outcomeStatusCode, outcomeBytesWritten)
        }
    }

    private fun getContentLength(connection: HttpURLConnection): Long {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            connection.contentLengthLong
        } else {
            connection.contentLength.toLong()
        }
    }

    fun stop() {
        Log.d("Downloader", "Attempting to stop download job $jobId")
        activeDownloadJob?.cancel(CancellationException("Download stopped by user request for job $jobId"))
    }

    // Call this method when the Downloader instance is no longer needed,
    // typically from RNFSManager when cleaning up a download job entirely.
    fun destroy() {
        Log.d("Downloader", "Destroying Downloader for job $jobId, cancelling its scope.")
        _job.cancel() // This cancels the SupervisorJob, and consequently the scope and any active coroutines.
    }
}

