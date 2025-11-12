package com.jstone.livegalgame

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import java.nio.ByteBuffer
import java.util.concurrent.ExecutorService

object Utils {
    fun cropBitmapToAspectRatio(bitmap: Bitmap, aspectRatio: Float): Bitmap {
        val originalWidth = bitmap.width
        val originalHeight = bitmap.height
        val originalAspectRatio = originalWidth.toFloat() / originalHeight.toFloat()

        return if (originalAspectRatio > aspectRatio) {
            // 原始图片比目标更宽，需要裁剪宽度
            val targetWidth = (originalHeight * aspectRatio).toInt()
            val xOffset = (originalWidth - targetWidth) / 2
            Bitmap.createBitmap(bitmap, xOffset, 0, targetWidth, originalHeight)
        } else {
            // 原始图片比目标更高，需要裁剪高度
            val targetHeight = (originalWidth / aspectRatio).toInt()
            val yOffset = (originalHeight - targetHeight) / 2
            Bitmap.createBitmap(bitmap, 0, yOffset, originalWidth, targetHeight)
        }
    }

    fun takePhoto(
        imageCapture: ImageCapture,
        executor: ExecutorService,
        onImageCaptured: (Bitmap) -> Unit,
        onError: (ImageCaptureException) -> Unit
    ) {
        val mainHandler = Handler(Looper.getMainLooper())
        imageCapture.takePicture(
            executor,
            object : ImageCapture.OnImageCapturedCallback() {
                override fun onCaptureSuccess(imageProxy: ImageProxy) {
                    val rotationDegrees = imageProxy.imageInfo.rotationDegrees
                    val buffer: ByteBuffer = imageProxy.planes[0].buffer
                    val bytes = ByteArray(buffer.remaining())
                    buffer.get(bytes)
                    imageProxy.close()

                    val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                    if (bitmap != null) {
                        val matrix = Matrix().apply { postRotate(rotationDegrees.toFloat()) }
                        val rotatedBitmap = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
                        mainHandler.post { onImageCaptured(rotatedBitmap) }
                    } else {
                        val exception = ImageCaptureException(ImageCapture.ERROR_UNKNOWN, "Failed to decode bitmap", null)
                        mainHandler.post { onError(exception) }
                    }
                }

                override fun onError(exception: ImageCaptureException) {
                    Log.e("takePhoto", "Photo capture error: ${exception.message}", exception)
                    mainHandler.post { onError(exception) }
                }
            }
        )
    }
}

