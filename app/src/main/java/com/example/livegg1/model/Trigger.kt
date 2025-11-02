package com.example.livegg1.model

import java.util.UUID

// 定义了可以被触发的弹窗类型
enum class DialogType {
    CHOICE_DIALOG // 代表 KeywordDialog
    // 未来可以扩展更多类型, 例如 INFO_DIALOG, INPUT_DIALOG 等
}

// 数据类，用于存储一个完整的触发器规则
data class KeywordTrigger(
    val id: String = UUID.randomUUID().toString(), // 使用UUID确保唯一性
    val keyword: String,
    val dialogType: DialogType
)
