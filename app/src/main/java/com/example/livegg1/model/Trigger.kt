package com.example.livegg1.model

import java.util.UUID

// 定义了可以被触发的弹窗类型
enum class DialogType {
    CHOICE_DIALOG // 代表 KeywordDialog
    // 未来可以扩展更多类型, 例如 INFO_DIALOG, INPUT_DIALOG 等
}

data class TriggerOption(
    val id: String = UUID.randomUUID().toString(),
    val label: String,
    val bgmAsset: String,
    val affectionDelta: Float,
    val triggerWhiteFlash: Boolean = false
)

// 数据类，用于存储一个完整的触发器规则
data class KeywordTrigger(
    val id: String = UUID.randomUUID().toString(), // 使用UUID确保唯一性
    val keyword: String,
    val dialogType: DialogType,
    val options: List<TriggerOption> = TriggerDefaults.defaultOptions(dialogType)
)

object TriggerDefaults {
    fun defaultOptions(dialogType: DialogType): List<TriggerOption> = when (dialogType) {
        DialogType.CHOICE_DIALOG -> listOf(
            TriggerOption(label = "好啊好啊", bgmAsset = "casual.mp3", affectionDelta = 0.4f, triggerWhiteFlash = false),
            TriggerOption(label = "不了", bgmAsset = "Ah.mp3", affectionDelta = -0.4f, triggerWhiteFlash = false)
        )
    }
}
