package com.example.livegg1.ui

import android.content.ContentValues
import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import androidx.compose.runtime.mutableStateListOf
import android.util.Log
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.TextButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Slider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
// CompositionLocalProvider / LocalMinimumTouchTargetEnforcement removed to avoid dependency on material
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.IntOffset
import androidx.compose.foundation.layout.offset
import androidx.compose.ui.zIndex
import androidx.compose.ui.draw.clip
// ...existing imports
import com.example.livegg1.Utils.cropBitmapToAspectRatio
import com.example.livegg1.Utils.takePhoto
import com.example.livegg1.ui.theme.LiveGG1Theme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.vosk.Model
import org.vosk.Recognizer
import org.vosk.android.RecognitionListener
import org.vosk.android.SpeechService
import org.vosk.android.StorageService
import java.io.IOException
import java.util.concurrent.ExecutorService
import androidx.camera.core.Preview as CameraPreview
import androidx.core.content.ContextCompat
import android.media.MediaPlayer
import java.lang.IllegalStateException
import android.os.Build
import android.provider.MediaStore
import android.view.View
import com.example.livegg1.R
import kotlin.math.roundToInt
import kotlin.random.Random
import kotlin.math.min
import kotlin.math.max
import android.graphics.Canvas as AndroidCanvas

@Composable
fun CameraScreen(
    cameraExecutor: ExecutorService,
    chapterTitle: String = "Chapter 1",
    onRecognizedText: (text: String, isFinal: Boolean) -> Unit = { _, _ -> },
    isDialogVisible: Boolean = false,
    idleBgmAsset: String = "bgm.mp3",
    onManageTriggers: () -> Unit = {},
    affectionEventId: Long = 0L,
    affectionEventDelta: Float = 0f,
    whiteFlashEventId: Long = 0L
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val configuration = LocalConfiguration.current
    val screenAspectRatio = configuration.screenWidthDp.toFloat() / configuration.screenHeightDp.toFloat()
    val coroutineScope = rememberCoroutineScope()
    val rootView = LocalView.current

    // --- 状态管理 ---
    var imageToShow by remember { mutableStateOf<Bitmap?>(null) }
    var model by remember { mutableStateOf<Model?>(null) }
    var speechService by remember { mutableStateOf<SpeechService?>(null) }
    var lastBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var isLoading by remember { mutableStateOf(true) }
    var errorText by remember { mutableStateOf<String?>(null) }
    var isInForeground by remember { mutableStateOf(true) }

    // 进度条相关：显示距离下一次更新的剩余时间
    var updateIntervalMs by remember { mutableStateOf(3500L) } // 每次更新间隔（毫秒）
    var progress by remember { mutableStateOf(0f) } // 0f 开始，逐渐增长到 1f
    var timeRemainingSec by remember { mutableStateOf(updateIntervalMs / 1000f) }
    var isIntervalDialogVisible by remember { mutableStateOf(false) }
    var pendingIntervalSec by remember { mutableStateOf(updateIntervalMs / 1000f) }
    var isRealtimePreview by remember { mutableStateOf(false) }
    val minIntervalSec = 1f
    val maxIntervalSec = 10f

    LaunchedEffect(updateIntervalMs) {
        val clamped = (updateIntervalMs / 1000f).coerceIn(minIntervalSec, maxIntervalSec)
        pendingIntervalSec = clamped
        if (!isRealtimePreview) {
            timeRemainingSec = clamped
        }
    }

    var affectionLevel by remember {
        val min = 1f / 3f
        val max = 2f / 3f
        mutableStateOf(min + Random.nextFloat() * (max - min))
    }
    var flashAlpha by remember { mutableStateOf(0f) }

    LaunchedEffect(isInForeground) {
        if (!isInForeground) return@LaunchedEffect
        val decayIntervalMs = 2000L
        val decayStep = 0.01f
        while (isActive) {
            delay(decayIntervalMs)
            affectionLevel = (affectionLevel - decayStep).coerceIn(0f, 1f)
        }
    }

    LaunchedEffect(affectionEventId) {
        if (affectionEventId > 0L) {
            affectionLevel = (affectionLevel + affectionEventDelta).coerceIn(0f, 1f)
        }
    }

    LaunchedEffect(whiteFlashEventId) {
        if (whiteFlashEventId > 0L) {
            // Quick double-flash: 0.3s on, 0.5s off, 0.3s on.
            flashAlpha = 1f
            delay(300)
            flashAlpha = 0f
            delay(500)
            flashAlpha = 1f
            delay(300)
            flashAlpha = 0f
            delay(600)
            flashAlpha = 1f
            delay(300)
            flashAlpha = 0f
        }
    }
// 好感度提高速度
    fun bumpAffection() {
        coroutineScope.launch {
            affectionLevel = (affectionLevel + 0.009f).coerceIn(0f, 1f)
        }
    }

    fun saveCurrentScreen(label: String) {
        coroutineScope.launch {
            if (rootView.width == 0 || rootView.height == 0) {
                Log.w("CameraScreen", "Skipping screenshot; view not laid out")
                return@launch
            }
            val bitmap = captureViewBitmap(rootView)
            try {
                withContext(Dispatchers.IO) {
                    saveBitmapToGallery(context, bitmap, label)
                }
                Log.i("CameraScreen", "Screenshot saved: $label")
            } catch (error: Exception) {
                Log.e("CameraScreen", "Screenshot save failed", error)
            } finally {
                bitmap.recycle()
            }
        }
    }

    fun togglePreviewMode() {
        if (isRealtimePreview) {
            Log.d("CameraScreen", "Switching to timed preview")
            isRealtimePreview = false
            progress = 0f
            timeRemainingSec = updateIntervalMs / 1000f
        } else {
            Log.d("CameraScreen", "Switching to realtime preview")
            isRealtimePreview = true
            progress = 1f
            timeRemainingSec = 0f
            val bitmapToRecycle = lastBitmap ?: imageToShow
            bitmapToRecycle?.let { candidate ->
                if (!candidate.isRecycled) {
                    candidate.recycle()
                }
            }
            lastBitmap = null
            imageToShow = null
        }
    }

    // 新的状态管理：用于连续识别
    val recognizedSentences = remember { mutableStateListOf<String>() }
    var currentPartialText by remember { mutableStateOf("") }

    // 组合最终显示的字幕
    val captionToShow by remember {
        derivedStateOf {
            val combinedText = (recognizedSentences + currentPartialText).joinToString(separator = "\n")
            errorText ?: combinedText
        }
    }


    // --- 相机设置 ---
    val imageCapture = remember { ImageCapture.Builder().build() }
    val previewView = remember { PreviewView(context).apply { scaleType = PreviewView.ScaleType.FILL_CENTER } }

    // --- BGM 控制 ---
    var mediaPlayer by remember { mutableStateOf<MediaPlayer?>(null) }
    var currentBgm by remember { mutableStateOf<String?>(null) }

    fun releasePlayer() {
        mediaPlayer?.let {
            try {
                it.stop()
            } catch (_: IllegalStateException) {
                // 忽略停止异常
            }
            it.release()
        }
        mediaPlayer = null
        currentBgm = null
    }

    fun switchBgm(assetName: String) {
        if (currentBgm == assetName) return
        releasePlayer()
        runCatching {
            context.assets.openFd(assetName).use { afd ->
                val player = MediaPlayer().apply {
                    setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
                    isLooping = true
                    prepare()
                    start()
                }
                mediaPlayer = player
                currentBgm = assetName
                Log.d("CameraScreen", "BGM switched to $assetName")
            }
        }.onFailure { error ->
            Log.w("CameraScreen", "Failed to play BGM $assetName: ${error.message}", error)
            releasePlayer()
        }
    }

    LaunchedEffect(isDialogVisible, idleBgmAsset, isInForeground) {
        if (!isInForeground) {
            releasePlayer()
        } else {
            val targetAsset = if (isDialogVisible) "TeaBreak.mp3" else idleBgmAsset
            switchBgm(targetAsset)
        }
    }

    // --- Vosk 监听器 (连续识别逻辑) ---
    val listener = object : RecognitionListener {
        override fun onFinalResult(hypothesis: String?) {
            hypothesis?.let {
                try {
                    val text = JSONObject(it).getString("text")
                    if (text.isNotBlank()) {
                        Log.d("Vosk", "onFinalResult: $text")
                        recognizedSentences.add(text) // 添加完整句子
                        currentPartialText = "" // 清空部分结果
                        onRecognizedText(text, true)
                        bumpAffection()
                    }
                } catch (e: Exception) {
                    Log.e("Vosk", "Error parsing final result: $it", e)
                }
            }
        }

        override fun onPartialResult(hypothesis: String?) {
            hypothesis?.let {
                try {
                    val partialText = JSONObject(it).getString("partial")
                    currentPartialText = partialText // 更新部分结果
                    if (partialText.isNotBlank()) {
                        onRecognizedText(partialText, false)
                        bumpAffection()
                    }
                } catch (e: Exception) {
                    // 忽略解析错误
                }
            }
        }

        override fun onError(e: Exception?) {
            Log.e("Vosk", "Recognition error", e)
            errorText = "语音识别错误: ${e?.message}"
        }

        override fun onResult(hypothesis: String?) { /* onFinalResult 已经处理，这里忽略 */ }
        override fun onTimeout() { /* 在连续识别中通常不处理超时 */ }
    }

    // --- 核心逻辑：初始化 ---
    LaunchedEffect(Unit) {
        withContext(Dispatchers.IO) {
            try {
                val sourcePath = "model"
                val targetPath = StorageService.sync(context, sourcePath, "model")
                Log.d("Vosk", "Model sync completed. Target path: $targetPath")
                model = Model(targetPath)
                speechService = SpeechService(Recognizer(model, 16000.0f), 16000.0f)
                Log.d("Vosk", "Model and SpeechService loaded successfully.")
            } catch (e: IOException) {
                Log.e("Vosk", "Failed to initialize Vosk.", e)
                errorText = "错误: 初始化语音模型失败。"
            } finally {
                isLoading = false
            }
        }
    }

    // --- 核心逻辑：绑定相机和资源管理 ---
    DisposableEffect(lifecycleOwner) {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(context)
        val lifecycle = lifecycleOwner.lifecycle
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START, Lifecycle.Event.ON_RESUME -> isInForeground = true
                Lifecycle.Event.ON_PAUSE, Lifecycle.Event.ON_STOP -> {
                    isInForeground = false
                    speechService?.stop()
                    releasePlayer()
                }
                Lifecycle.Event.ON_DESTROY -> isInForeground = false
                else -> {}
            }
        }
        lifecycle.addObserver(observer)
        cameraProviderFuture.addListener({
            val cameraProvider = cameraProviderFuture.get()
            val preview = CameraPreview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
            val cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA
            try {
                cameraProvider.unbindAll()
                cameraProvider.bindToLifecycle(lifecycleOwner, cameraSelector, preview, imageCapture)
            } catch (exc: Exception) {
                Log.e("CameraScreen", "Use case binding failed", exc)
            }
        }, ContextCompat.getMainExecutor(context))

        onDispose {
            lifecycle.removeObserver(observer)
            cameraProviderFuture.get().unbindAll()
            speechService?.stop()
            speechService?.shutdown()
            model?.close()
            releasePlayer()
            lastBitmap?.let {
                if (!it.isRecycled) {
                    it.recycle()
                }
            }
            lastBitmap = null
            imageToShow?.let {
                if (!it.isRecycled) {
                    it.recycle()
                }
            }
            imageToShow = null
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            releasePlayer()
        }
    }

    // --- 核心逻辑：启动连续语音识别 ---
    LaunchedEffect(speechService, isInForeground) {
        val service = speechService ?: return@LaunchedEffect
        if (!isInForeground) {
            service.stop()
            return@LaunchedEffect
        }
        Log.d("Vosk", "Continuous listening started.")
        try {
            service.startListening(listener)
            awaitCancellation()
        } finally {
            service.stop()
        }
    }

    // --- 核心逻辑：定时拍照更新背景 ---
    LaunchedEffect(imageCapture, isInForeground, isRealtimePreview, updateIntervalMs) {
        if (!isInForeground) {
            progress = 0f
            timeRemainingSec = updateIntervalMs / 1000f
            return@LaunchedEffect
        }

        val shouldCaptureStills = !isRealtimePreview

        if (shouldCaptureStills) {
            // 首次启动时，先拍一张照片作为背景
            takePhoto(
                imageCapture,
                cameraExecutor,
                { bitmap ->
                    if (isRealtimePreview) {
                        if (!bitmap.isRecycled) {
                            bitmap.recycle()
                        }
                    } else {
                        imageToShow = cropBitmapToAspectRatio(bitmap, screenAspectRatio)
                    }
                },
                {}
            )
            delay(1000)
        } else {
            progress = 0f
            timeRemainingSec = updateIntervalMs / 1000f
        }

        // 主循环：每 updateIntervalMs 更新一次。内部按 100ms 步进更新进度和剩余时间。
        val stepMs = 100L
        while (isActive) {
            var elapsed = 0L
            while (isActive && elapsed < updateIntervalMs) {
                delay(stepMs)
                elapsed += stepMs
                val remaining = (updateIntervalMs - elapsed).coerceAtLeast(0L)
                progress = (elapsed.toFloat() / updateIntervalMs.toFloat()).coerceIn(0f, 1f)
                timeRemainingSec = remaining / 1000f
            }

            if (!isActive) break

            if (shouldCaptureStills) {
                takePhoto(
                    imageCapture = imageCapture,
                    executor = cameraExecutor,
                    onImageCaptured = { newBitmap ->
                        if (isRealtimePreview) {
                            if (!newBitmap.isRecycled) {
                                newBitmap.recycle()
                            }
                        } else {
                            val croppedBitmap = cropBitmapToAspectRatio(newBitmap, screenAspectRatio)
                            lastBitmap?.let { oldBitmap ->
                                if (oldBitmap != croppedBitmap && !oldBitmap.isRecycled) {
                                    oldBitmap.recycle()
                                }
                            }
                            lastBitmap = croppedBitmap
                            imageToShow = croppedBitmap
                            Log.d("MainLoop", "Background photo updated.")
                        }
                    },
                    onError = { Log.e("MainLoop", "Photo capture failed", it) }
                )
            }

            // 重置进度（下一刻开始倒计时）
            progress = 0f
            timeRemainingSec = updateIntervalMs / 1000f
        }
    }

    // --- UI 界面 ---

    if (isIntervalDialogVisible) {
        AlertDialog(
            onDismissRequest = { isIntervalDialogVisible = false },
            title = { Text("调整更新间隔") },
            text = {
                Column {
                    Text("拖动滑块来设定画面更新的间隔时间")
                    Spacer(modifier = Modifier.height(16.dp))
                    Slider(
                        value = pendingIntervalSec,
                        onValueChange = { pendingIntervalSec = it.coerceIn(minIntervalSec, maxIntervalSec) },
                        valueRange = minIntervalSec..maxIntervalSec
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(String.format("%.1f 秒", pendingIntervalSec))
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    val clamped = pendingIntervalSec.coerceIn(minIntervalSec, maxIntervalSec)
                    val newIntervalMs = (clamped * 1000f).roundToInt().toLong()
                    updateIntervalMs = newIntervalMs
                    progress = 0f
                    timeRemainingSec = newIntervalMs / 1000f
                    isIntervalDialogVisible = false
                }) {
                    Text("确定")
                }
            },
            dismissButton = {
                TextButton(onClick = { isIntervalDialogVisible = false }) {
                    Text("取消")
                }
            }
        )
    }

    CameraScreenContent(
        isLoading = isLoading,
        imageToShow = imageToShow,
        captionToShow = captionToShow,
        progress = progress,
        timeRemainingSec = timeRemainingSec,
        isRealtimePreview = isRealtimePreview,
        chapterTitle = chapterTitle,
        previewView = { AndroidView({ previewView }, modifier = Modifier.fillMaxSize()) },
        affectionLevel = affectionLevel,
        onSaveSnapshot = ::saveCurrentScreen,
        onManageTriggers = onManageTriggers,
        onAdjustInterval = {
            pendingIntervalSec = (updateIntervalMs / 1000f).coerceIn(minIntervalSec, maxIntervalSec)
            isIntervalDialogVisible = true
        },
        onTogglePreviewMode = ::togglePreviewMode,
        flashAlpha = flashAlpha
    )
}

@Composable
private fun CameraScreenContent(
    isLoading: Boolean,
    imageToShow: Bitmap?,
    captionToShow: String,
    progress: Float,
    timeRemainingSec: Float,
    isRealtimePreview: Boolean = false,
    rectOffsetX: Dp = 4.dp,
    rectOffsetY: Dp = 10.dp,
    chapterTitle: String,
    previewView: @Composable () -> Unit,
    affectionLevel: Float,
    onSaveSnapshot: (String) -> Unit = {},
    onManageTriggers: () -> Unit = {},
    onAdjustInterval: () -> Unit = {},
    onTogglePreviewMode: () -> Unit = {},
    flashAlpha: Float = 0f
) {
    val context = LocalContext.current
    val hasChapterDrawable = remember(context) {
        context.resources.getIdentifier("chapter", "drawable", context.packageName) != 0
    }
    val configuration = LocalConfiguration.current
    val referenceWidth = 853f
    val referenceHeight = 480f
    val widthRatio = configuration.screenWidthDp.toFloat() / referenceWidth
    val heightRatio = configuration.screenHeightDp.toFloat() / referenceHeight
    val scaleBase = min(widthRatio, heightRatio)
    val scaleFactor = (scaleBase * 1.25f).coerceIn(0.85f, 1.75f)

    val density = LocalDensity.current
    val chapterBottomOffset = 24.dp + 68.dp
    val heartSize = (40f * scaleFactor).dp
    val spacerHeight = (4f * scaleFactor).dp
    val affectionBarWidth = (24f * scaleFactor).dp

    val fallbackGradientTop = (configuration.screenHeightDp.toFloat() * 0.6f).dp
    val fallbackBarHeight = (fallbackGradientTop - chapterBottomOffset - heartSize - spacerHeight).coerceAtLeast(0.dp)

    var captionTopPx by remember { mutableStateOf<Float?>(null) }

    val heartSizePx = with(density) { heartSize.toPx() }
    val spacerHeightPx = with(density) { spacerHeight.toPx() }
    val columnTopOffsetPx = with(density) { chapterBottomOffset.toPx() }
    val computedBarHeightPx = captionTopPx?.let { top ->
        max(0f, top - columnTopOffsetPx - heartSizePx - spacerHeightPx)
    }
    val affectionBarHeight = computedBarHeightPx?.let { px -> with(density) { px.toDp() } } ?: fallbackBarHeight

    val columnTopOffset = chapterBottomOffset

    Box(modifier = Modifier.fillMaxSize()) {
        // 1. 摄像头预览或占位图一直在最底层
        previewView()

        Column(
            modifier = Modifier
                .align(Alignment.TopStart)
                .padding(start = 32.dp)
                .offset(x = 30.dp, y = columnTopOffset)
                .zIndex(3f),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            HeartIcon(
                modifier = Modifier
                    .size(heartSize)
                    .zIndex(1f)
            )
            Spacer(modifier = Modifier.height(spacerHeight))
            AffectionBar(
                affectionLevel = affectionLevel,
                modifier = Modifier.zIndex(0f),
                barHeight = affectionBarHeight,
                barWidth = affectionBarWidth
            )
        }

        // 左上角章节标签背景
        Box(
            modifier = Modifier
                .align(Alignment.TopStart)
                .padding(top = 24.dp)
                .zIndex(2f)
        ) {
            val baseModifier = Modifier.width(180.dp).height(68.dp)
            if (hasChapterDrawable) {
                Image(
                    painter = painterResource(id = R.drawable.chapter),
                    contentDescription = "Chapter background",
                    contentScale = ContentScale.FillBounds,
                    modifier = baseModifier
                )
            } else {
                Box(
                    modifier = baseModifier
                        .background(
                            color = Color(0xAA0F3D35),
                            shape = RoundedCornerShape(topEnd = 20.dp, bottomEnd = 20.dp)
                        )
                )
            }

            Box(
                modifier = Modifier
                    .matchParentSize()
                    .padding(start = 24.dp, end = 16.dp),
                contentAlignment = Alignment.CenterStart
            ) {
                Text(
                    text = chapterTitle,
                    color = Color.White,
                    fontSize = 18.sp,
                    maxLines = 1
                )
            }
        }

        // 2. 图像或加载指示器
        when {
            isLoading -> {
                Box(
                    modifier = Modifier.fillMaxSize().background(Color.Black),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        CircularProgressIndicator(color = Color.White)
                        Text("正在加载语音模型...", modifier = Modifier.padding(top = 8.dp), color = Color.White)
                    }
                }
            }
            imageToShow != null -> {
                Image(
                    bitmap = imageToShow.asImageBitmap(),
                    contentDescription = "Captured Image",
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop
                )
            }
            else -> if (!isRealtimePreview) {
                Box(modifier = Modifier.fillMaxSize().background(Color.Black))
            }
        }

        // 将渐变背景和字幕包裹在一个父 Box 中
        Box(modifier = Modifier.align(Alignment.BottomCenter)) {
            // 渐变背景层
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .fillMaxHeight(0.4f)
                    .background(
                        brush = Brush.verticalGradient(
                            colorStops = arrayOf(
                                0.0f to Color.Transparent,
                                0.5f to Color(0xCCFFC0CB)
                            )
                        )
                    )
            ) {}

            // 进度条 + 倒计时（右下角，宽度为屏幕的 1/6）
            val screenWidthDp = configuration.screenWidthDp.dp
            val progressWidth = (screenWidthDp / 8)
            Row(
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(end = 24.dp, bottom = 40.dp)
                    .zIndex(3f),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Image(
                    painter = painterResource(id = R.drawable.strbcake),
                    contentDescription = "Progress icon",
                    modifier = Modifier
                        .offset(x = 16.dp, y = 6.dp)
                        .width(48.dp)
                        .height(48.dp)
                )

                Column(
                    horizontalAlignment = Alignment.End
                ) {
//                Text(
//                    text = String.format("下次更新: %.1f s", timeRemainingSec),
//                    color = Color.White,
//                    modifier = Modifier.padding(bottom = 6.dp)
//                )
                // 在进度条下方绘制一个不透明的墨绿色圆角条，作为描边背景
                val borderExtra = 8.dp
                val borderHeight = 14.dp
                val borderWidth = progressWidth + borderExtra

                // 使用 Canvas 绘制：先画外部实心圆角矩形，然后抠出中间的透明区域
                val outerRadius = 8.dp
                val innerRadius = 6.dp
                val innerPadding = 4.dp

                val density = LocalDensity.current
                Canvas(modifier = Modifier
                    .width(borderWidth)
                    .height(borderHeight)
                    .offset(x = rectOffsetX, y = rectOffsetY)
                ) {
                    val w = size.width
                    val h = size.height

                    // 外矩形（实心）
                    drawRoundRect(
                        color = Color(0xFF083E2C),
                        size = Size(w, h),
                        cornerRadius = androidx.compose.ui.geometry.CornerRadius(outerRadius.toPx(), outerRadius.toPx())
                    )

                    // 中间抠空矩形：使用 BlendMode.Clear 清除中间区域，产生透明孔
                    val innerLeft = innerPadding.toPx()
                    val innerTop = innerPadding.toPx()
                    val innerW = w - innerPadding.toPx() * 2
                    val innerH = h - innerPadding.toPx() * 2
                    drawRoundRect(
                        color = Color.Transparent,
                        topLeft = Offset(innerLeft, innerTop),
                        size = Size(innerW, innerH),
                        cornerRadius = androidx.compose.ui.geometry.CornerRadius(innerRadius.toPx(), innerRadius.toPx()),
                        //blendMode = BlendMode.Clear
                    )
                }

                    // 进度条位于上层，宽度小一些以露出背景作为描边
                    LinearProgressIndicator(
                        progress = progress,
                        modifier = Modifier
                            .width(progressWidth)
                            .height(6.dp)
                    )
                }
            }

            // 字幕层
            if (captionToShow.isNotEmpty()) {
                Column(
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .padding(start = 100.dp, bottom = 70.dp, end = 24.dp)
                        .onGloballyPositioned { coordinates ->
                            if (captionTopPx == null) {
                                captionTopPx = coordinates.positionInRoot().y
                            }
                        }
                ) {
                    val shadow = Shadow(color = Color.Black, offset = Offset(4f, 4f), blurRadius = 8f)
                    Text(
                        text = captionToShow,
                        color = Color.White,
                        fontSize = 20.sp,
                        textAlign = TextAlign.Start,
                        style = TextStyle(shadow = shadow)
                    )
                }
            }

            // 底部小按钮行（高度与进度条接近）
            Row(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .offset(x = -screenWidthDp / 12)
                    .padding(bottom = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(-10.dp)
            ) {
                    val btnHeight = 16.dp
                    TextButton(onClick = {
                        Log.d("CameraScreen", "Button 1 clicked")
                        onSaveSnapshot("save")
                    }, contentPadding = PaddingValues(horizontal = 4.dp, vertical = 0.dp), modifier = Modifier.height(btnHeight)) {
                        Text(text = "SAVE", fontSize = 12.sp, color = Color.White)
                    }
                    TextButton(onClick = { Log.d("CameraScreen", "Button 2 clicked") }, contentPadding = PaddingValues(horizontal = 4.dp, vertical = 0.dp), modifier = Modifier.height(btnHeight)) {
                        Text(text = "LOAD", fontSize = 12.sp, color = Color.White)
                    }
                    TextButton(onClick = {
                        Log.d("CameraScreen", "Button 3 clicked")
                        onSaveSnapshot("quick_save")
                    }, contentPadding = PaddingValues(horizontal = 4.dp, vertical = 0.dp), modifier = Modifier.height(btnHeight)) {
                        Text(text = "Q.SAVE", fontSize = 12.sp, color = Color.White)
                    }
                    TextButton(onClick = { Log.d("CameraScreen", "Button 4 clicked") }, contentPadding = PaddingValues(horizontal = 4.dp, vertical = 0.dp), modifier = Modifier.height(btnHeight)) {
                        Text(text = "Q.LOAD", fontSize = 12.sp, color = Color.White)
                    }

                    // SVG 图像按钮（image2.svg 对应的资源名假定为 R.drawable.image2）
                    TextButton(onClick = {
                        Log.d("CameraScreen", "Image button clicked")
                        onManageTriggers()
                    }, contentPadding = PaddingValues(horizontal = 4.dp, vertical = 0.dp), modifier = Modifier.height(btnHeight)) {
                        Image(
                            painter = painterResource(id = R.drawable.image2),
                            contentDescription = "image2",
                            modifier = Modifier.width(18.dp).height(18.dp),
                            colorFilter = ColorFilter.tint(Color.White)
                        )
                    }

                    // 新增的图像按钮集合：image4, image5, image7, image8
                    TextButton(onClick = {
                        Log.d("CameraScreen", "image4 clicked")
                        onAdjustInterval()
                    }, contentPadding = PaddingValues(horizontal = 4.dp, vertical = 0.dp), modifier = Modifier.height(btnHeight)) {
                        Image(painter = painterResource(id = R.drawable.image4), contentDescription = "image4", modifier = Modifier.width(18.dp).height(18.dp), colorFilter = ColorFilter.tint(Color.White))
                    }
                    TextButton(onClick = {
                        Log.d("CameraScreen", "image5 clicked")
                        onTogglePreviewMode()
                    }, contentPadding = PaddingValues(horizontal = 4.dp, vertical = 0.dp), modifier = Modifier.height(btnHeight)) {
                        val realtimeTint = if (isRealtimePreview) Color(0xFFFFC857) else Color.White
                        Image(
                            painter = painterResource(id = R.drawable.image5),
                            contentDescription = "image5",
                            modifier = Modifier.width(18.dp).height(18.dp),
                            colorFilter = ColorFilter.tint(realtimeTint)
                        )
                    }
                    TextButton(onClick = { Log.d("CameraScreen", "image7 clicked") }, contentPadding = PaddingValues(horizontal = 4.dp, vertical = 0.dp), modifier = Modifier.height(btnHeight)) {
                        Image(painter = painterResource(id = R.drawable.image7), contentDescription = "image7", modifier = Modifier.width(18.dp).height(18.dp), colorFilter = ColorFilter.tint(Color.White))
                    }
                    TextButton(onClick = { Log.d("CameraScreen", "image8 clicked") }, contentPadding = PaddingValues(horizontal = 4.dp, vertical = 0.dp), modifier = Modifier.height(btnHeight)) {
                        Image(painter = painterResource(id = R.drawable.image8), contentDescription = "image8", modifier = Modifier.width(18.dp).height(18.dp), colorFilter = ColorFilter.tint(Color.White))
                    }
                    // 新增的图像按钮：image3, imag
                    TextButton(onClick = { Log.d("CameraScreen", "image9 clicked") }, contentPadding = PaddingValues(horizontal = 4.dp, vertical = 0.dp), modifier = Modifier.height(btnHeight)) {
                        Image(painter = painterResource(id = R.drawable.image9), contentDescription = "image9", modifier = Modifier.width(18.dp).height(18.dp), colorFilter = ColorFilter.tint(Color.White))
                    }
            }
        }

        if (flashAlpha > 0f) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.White.copy(alpha = flashAlpha))
                    .zIndex(10f)
            )
        }
    }
}

@Composable
private fun HeartIcon(modifier: Modifier = Modifier) {
    Image(
        painter = painterResource(id = R.drawable.heart),
        contentDescription = "Affection heart",
        modifier = modifier
    )
}

@Composable
private fun AffectionBar(
    affectionLevel: Float,
    modifier: Modifier = Modifier,
    barHeight: Dp = 180.dp,
    barWidth: Dp = 24.dp
) {
    val clamped = affectionLevel.coerceIn(0f, 1f)
    Box(
        modifier = modifier
            .width(barWidth)
            .height(barHeight)
            .clip(RoundedCornerShape(percent = 50))
            .background(Color.White.copy(alpha = 0.3f)),
        contentAlignment = Alignment.BottomCenter
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(4.dp),
            contentAlignment = Alignment.BottomCenter
        ) {
            val fillColor = when {
                clamped >= 0.85f -> Color(0xFF7030A0)
                clamped <= 0.2f -> Color(0xFFA21011)
                else -> Color(0xFFFF6FA5)
            }
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .fillMaxHeight(clamped)
                    .clip(RoundedCornerShape(percent = 50))
                    .background(fillColor)
            )
        }
    }
}

@Preview(
    showBackground = true,
    widthDp = 853,
    heightDp = 480,
    uiMode = Configuration.UI_MODE_NIGHT_YES,
    device = "spec:parent=pixel_5,orientation=landscape"
)
@Composable
fun CameraScreenPreview() {
    LiveGG1Theme {
        val placeholderBitmap = Bitmap.createBitmap(853, 480, Bitmap.Config.ARGB_8888).apply {
            eraseColor(android.graphics.Color.BLACK)
        }
        CameraScreenContent(
            isLoading = false,
            imageToShow = placeholderBitmap,
            captionToShow = "这是第一句已经识别完成的字幕。\n这是第二句，仍在识别中...",
            progress = 0.5f,
            timeRemainingSec = 2.5f,
            chapterTitle = "Chapter 1-2",
            previewView = {
                Box(modifier = Modifier.fillMaxSize().background(Color.DarkGray))
            },
            affectionLevel = 0.55f,
            onSaveSnapshot = {},
            onManageTriggers = {},
            flashAlpha = 0f
        )
    }
}

private fun captureViewBitmap(view: View): Bitmap {
    val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
    val canvas = AndroidCanvas(bitmap)
    view.draw(canvas)
    return bitmap
}

private fun saveBitmapToGallery(context: Context, bitmap: Bitmap, label: String) {
    val resolver = context.contentResolver
    val timeStamp = System.currentTimeMillis()
    val fileName = "LiveGG_${label}_${timeStamp}.png"
    val imageCollection = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
    } else {
        MediaStore.Images.Media.EXTERNAL_CONTENT_URI
    }

    val contentValues = ContentValues().apply {
        put(MediaStore.Images.Media.DISPLAY_NAME, fileName)
        put(MediaStore.Images.Media.MIME_TYPE, "image/png")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            put(MediaStore.Images.Media.IS_PENDING, 1)
            put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/LiveGG")
        }
    }

    val imageUri = resolver.insert(imageCollection, contentValues)
    if (imageUri == null) {
        Log.e("CameraScreen", "Failed to insert MediaStore entry")
        return
    }

    resolver.openOutputStream(imageUri)?.use { stream ->
        if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)) {
            Log.e("CameraScreen", "Failed to compress bitmap")
            resolver.delete(imageUri, null, null)
            return
        }
    } ?: run {
        Log.e("CameraScreen", "Failed to open output stream for screenshot")
        resolver.delete(imageUri, null, null)
        return
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        contentValues.clear()
        contentValues.put(MediaStore.Images.Media.IS_PENDING, 0)
        resolver.update(imageUri, contentValues, null, null)
    }
}
