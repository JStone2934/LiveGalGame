package com.jstone.livegalgame

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.util.Log
import android.view.View
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.flow.collect
import com.jstone.livegalgame.dialog.KeywordDialog
import com.jstone.livegalgame.dialog.TriggerManagementDialog
import com.jstone.livegalgame.model.DialogType
import com.jstone.livegalgame.model.KeywordTrigger
import com.jstone.livegalgame.speech.KeywordSpeechListener
import com.jstone.livegalgame.ui.CameraScreen
import com.jstone.livegalgame.ui.theme.LiveGG1Theme
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class MainActivity : ComponentActivity() {

    private lateinit var cameraExecutor: ExecutorService
    private var permissionsGranted by mutableStateOf(mapOf<String, Boolean>())

    private val requestMultiplePermissionsLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { permissions ->
            permissionsGranted = permissions
            permissions.entries.forEach {
                Log.d("MainActivity", "${it.key} = ${it.value}")
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 设置全屏沉浸式模式
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            // 隐藏导航栏
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            // 隐藏状态栏
            or View.SYSTEM_UI_FLAG_FULLSCREEN
        )

        cameraExecutor = Executors.newSingleThreadExecutor()

        val permissionsToRequest = arrayOf(
            Manifest.permission.CAMERA,
            Manifest.permission.RECORD_AUDIO
        )

        val notGrantedPermissions = permissionsToRequest.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (notGrantedPermissions.isNotEmpty()) {
            requestMultiplePermissionsLauncher.launch(notGrantedPermissions.toTypedArray())
        } else {
            permissionsGranted = permissionsToRequest.associateWith { true }
        }

        setContent {
            LiveGG1Theme {
                val allPermissionsGranted = permissionsGranted.all { it.value }
                if (allPermissionsGranted) {
                    val lifecycleOwner = LocalLifecycleOwner.current
                    var triggers by remember {
                        mutableStateOf(
                            listOf(KeywordTrigger(keyword = "吗", dialogType = DialogType.CHOICE_DIALOG))
                        )
                    }
                    val speechListener = remember { KeywordSpeechListener(initialTriggers = triggers) }
                    var showKeywordDialog by remember { mutableStateOf(false) }
                    var showTriggerDialog by remember { mutableStateOf(false) }
                    var idleBgmAsset by remember { mutableStateOf("bgm.mp3") }
                    var activeTrigger by remember { mutableStateOf<KeywordTrigger?>(null) }
                    var affectionEventId by remember { mutableLongStateOf(0L) }
                    var affectionEventDelta by remember { mutableStateOf(0f) }
                    var whiteFlashEventId by remember { mutableLongStateOf(0L) }

                    fun queueAffectionChange(delta: Float) {
                        affectionEventDelta = delta
                        affectionEventId++
                    }

                    fun triggerWhiteFlash() {
                        whiteFlashEventId++
                    }

                    fun restartListeningIfPossible() {
                        if (lifecycleOwner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
                            speechListener.startListening()
                        }
                    }

                    LaunchedEffect(triggers) {
                        speechListener.updateTriggers(triggers)
                    }

                    LaunchedEffect(showTriggerDialog, speechListener) {
                        if (showTriggerDialog) {
                            speechListener.stopListening()
                        } else if (!showKeywordDialog) {
                            restartListeningIfPossible()
                        }
                    }

                    LaunchedEffect(speechListener) {
                        speechListener.keywordTriggers.collect { trigger ->
                            Log.d("MainActivity", "Keyword triggered: ${trigger.keyword}")
                            speechListener.stopListening()
                            activeTrigger = trigger
                            showKeywordDialog = true
                        }
                    }

                    DisposableEffect(lifecycleOwner, speechListener) {
                        val observer = LifecycleEventObserver { _, event ->
                            when (event) {
                                Lifecycle.Event.ON_START -> speechListener.startListening()
                                Lifecycle.Event.ON_STOP -> speechListener.stopListening()
                                else -> Unit
                            }
                        }
                        lifecycleOwner.lifecycle.addObserver(observer)
                        onDispose {
                            lifecycleOwner.lifecycle.removeObserver(observer)
                            speechListener.release()
                        }
                    }

                    CameraScreen(
                        cameraExecutor = cameraExecutor,
                        onRecognizedText = { text, isFinal ->
                            speechListener.onRecognizedText(text, isFinal)
                        },
                        isDialogVisible = showKeywordDialog || showTriggerDialog,
                        idleBgmAsset = idleBgmAsset,
                        onManageTriggers = {
                            speechListener.stopListening()
                            showTriggerDialog = true
                        },
                        affectionEventId = affectionEventId,
                        affectionEventDelta = affectionEventDelta,
                        whiteFlashEventId = whiteFlashEventId
                    )

                    if (showKeywordDialog) {
                        activeTrigger?.let { trigger ->
                            KeywordDialog(
                                options = trigger.options,
                                onOptionSelected = { option ->
                                    Log.d(
                                        "MainActivity",
                                        "Option selected: ${option.label} for keyword ${trigger.keyword}"
                                    )
                                    idleBgmAsset = option.bgmAsset
                                    queueAffectionChange(option.affectionDelta)
                                    if (option.triggerWhiteFlash) {
                                        triggerWhiteFlash()
                                    }
                                    showKeywordDialog = false
                                    activeTrigger = null
                                    if (!showTriggerDialog) {
                                        restartListeningIfPossible()
                                    }
                                },
                                onDismiss = {
                                    showKeywordDialog = false
                                    activeTrigger = null
                                    if (!showTriggerDialog) {
                                        restartListeningIfPossible()
                                    }
                                }
                            )
                        }
                    }

                    if (showTriggerDialog) {
                        TriggerManagementDialog(
                            triggers = triggers,
                            onAddTrigger = { keyword, dialogType, options ->
                                val cleaned = keyword.trim()
                                val duplicate = triggers.any { it.keyword.equals(cleaned, ignoreCase = true) }
                                if (cleaned.isEmpty()) {
                                    Log.w("MainActivity", "Attempted to add empty keyword")
                                } else if (duplicate) {
                                    Log.w("MainActivity", "Keyword already exists: $cleaned")
                                } else {
                                    val sanitizedOptions = options.map { option ->
                                        option.copy(
                                            label = option.label.trim().ifEmpty { option.label },
                                            bgmAsset = option.bgmAsset.trim().ifEmpty { option.bgmAsset }
                                        )
                                    }
                                    val newTrigger = KeywordTrigger(
                                        keyword = cleaned,
                                        dialogType = dialogType,
                                        options = sanitizedOptions
                                    )
                                    Log.d("MainActivity", "Keyword added: ${newTrigger.keyword}")
                                    triggers = triggers + newTrigger
                                }
                            },
                            onUpdateTrigger = { original, updated ->
                                val cleaned = updated.keyword.trim()
                                val duplicate = triggers.any {
                                    it.id != original.id && it.keyword.equals(cleaned, ignoreCase = true)
                                }
                                if (cleaned.isEmpty()) {
                                    Log.w("MainActivity", "Attempted to update keyword to empty value")
                                } else if (duplicate) {
                                    Log.w("MainActivity", "Keyword already exists: $cleaned")
                                } else {
                                    val sanitized = updated.copy(
                                        keyword = cleaned,
                                        options = updated.options.map { option ->
                                            option.copy(
                                                label = option.label.trim().ifEmpty { option.label },
                                                bgmAsset = option.bgmAsset.trim().ifEmpty { option.bgmAsset }
                                            )
                                        }
                                    )
                                    Log.d("MainActivity", "Keyword updated: ${sanitized.keyword}")
                                    triggers = triggers.map { existing ->
                                        if (existing.id == original.id) sanitized else existing
                                    }
                                }
                            },
                            onDeleteTrigger = { trigger ->
                                Log.d("MainActivity", "Keyword deleted: ${trigger.keyword}")
                                triggers = triggers.filterNot { it.id == trigger.id }
                            },
                            onDismiss = {
                                showTriggerDialog = false
                                if (!showKeywordDialog) {
                                    restartListeningIfPossible()
                                }
                            }
                        )
                    }
                } else {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Text("Camera and/or Audio permission denied. Please grant permissions to use the app.")
                    }
                }
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        cameraExecutor.shutdown()
    }
}
