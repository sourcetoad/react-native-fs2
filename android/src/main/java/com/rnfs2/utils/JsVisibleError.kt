package com.rnfs2.utils

/**
 * Base class for every error this module deliberately surfaces to JavaScript.
 *
 * ### Why this exists
 *
 * Nitro hands a thrown [Throwable] to fbjni, which builds the JS-visible message with
 * `ExceptionHelper.getErrorDescription()`. That method's entire body is:
 *
 * ```java
 * throwable.printStackTrace(new PrintWriter(stringWriter));
 * return stringWriter.toString();
 * ```
 *
 * `printStackTrace` emits `println(this)` — i.e. [toString] — followed by one `\tat ...`
 * line per stack frame. Nitro then passes that whole string to `jsi::JSError`, so a plain
 * `throw Error("ENOENT: ...")` reaches JavaScript as:
 *
 * ```
 * java.lang.Error: ENOENT: no such file or directory, open '/x'
 * 	at com.rnfs2.Fs2Impl...
 * ```
 *
 * which breaks `err.message.startsWith('ENOENT')` — the documented contract of this
 * library's public API, and the shape iOS produces.
 *
 * Overriding [toString] drops the `java.lang.Error: ` class-name prefix, and suppressing
 * the stack trace drops the frames. JS then receives exactly the message (with a single
 * trailing newline that `println` unavoidably adds).
 *
 * ### Trade-off
 *
 * Subclasses carry no stack trace, so they will not show a native call site in logcat.
 * That is intentional: these are message-carrying API errors describing a filesystem
 * condition, not crashes, and the message is the whole payload. Anything representing an
 * genuine internal fault should throw a normal exception instead, so its trace survives.
 */
abstract class JsVisibleError : Exception() {
    final override fun fillInStackTrace(): Throwable = this

    final override fun toString(): String = message ?: javaClass.simpleName
}

/**
 * A general-purpose [JsVisibleError] carrying a pre-formatted `CODE: message` string.
 *
 * Use this in place of `throw Error(...)` anywhere the error is destined for JavaScript.
 */
class FsError(override val message: String) : JsVisibleError()
