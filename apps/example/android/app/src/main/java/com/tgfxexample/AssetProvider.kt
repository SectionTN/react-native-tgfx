package com.tgfxexample

import android.content.ContentProvider
import android.content.ContentValues
import android.content.res.AssetFileDescriptor
import android.database.Cursor
import android.net.Uri

/** Serves this APK's assets as `content://com.tgfxexample.assets/<path>`, for the content: URI tests. */
class AssetProvider : ContentProvider() {

  override fun onCreate(): Boolean = true

  override fun openAssetFile(uri: Uri, mode: String): AssetFileDescriptor? =
    context?.assets?.openFd(uri.path.orEmpty().trimStart('/'))

  override fun getType(uri: Uri): String? = null

  override fun query(
    uri: Uri,
    projection: Array<String>?,
    selection: String?,
    selectionArgs: Array<String>?,
    sortOrder: String?
  ): Cursor? = null

  override fun insert(uri: Uri, values: ContentValues?): Uri? = null

  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<String>?): Int = 0

  override fun update(
    uri: Uri,
    values: ContentValues?,
    selection: String?,
    selectionArgs: Array<String>?
  ): Int = 0
}
