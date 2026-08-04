# tgfx's Android NativeCodec resolves this class through JNI FindClass, so
# nothing in Java or Kotlin references it and R8 strips it from a minified
# release build. It is what applies EXIF orientation on the platform decode
# path, which is where anything the embedded codecs do not handle — HEIF, AVIF —
# still goes: without this a release build draws those photos sideways while
# debug draws them upright.
-keep class androidx.exifinterface.media.ExifInterface { *; }
