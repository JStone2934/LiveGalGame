package com.jstone.livegalgame.dialog

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.jstone.livegalgame.model.DialogType
import com.jstone.livegalgame.model.KeywordTrigger
import com.jstone.livegalgame.model.TriggerDefaults
import com.jstone.livegalgame.model.TriggerOption

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TriggerManagementDialog(
    triggers: List<KeywordTrigger>,
    onAddTrigger: (keyword: String, dialogType: DialogType, options: List<TriggerOption>) -> Unit,
    onUpdateTrigger: (original: KeywordTrigger, updated: KeywordTrigger) -> Unit,
    onDeleteTrigger: (trigger: KeywordTrigger) -> Unit,
    onDismiss: () -> Unit
) {
    var showAddOrEditDialog by remember { mutableStateOf<KeywordTrigger?>(null) }

    Dialog(onDismissRequest = onDismiss) {
        Card(
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = Color(0xFFF0F0F0)),
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "管理触发器",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(bottom = 16.dp)
                )

                LazyColumn(
                    modifier = Modifier.weight(1f, fill = false),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(triggers) { trigger ->
                        TriggerItem(
                            trigger = trigger,
                            onEdit = { showAddOrEditDialog = it },
                            onDelete = onDeleteTrigger
                        )
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Button(
                        onClick = {
                            showAddOrEditDialog = KeywordTrigger(keyword = "", dialogType = DialogType.CHOICE_DIALOG)
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary)
                    ) {
                        Icon(Icons.Default.Add, contentDescription = "添加")
                        Text("添加新的", modifier = Modifier.padding(start = 4.dp))
                    }
                    TextButton(onClick = onDismiss) {
                        Text("关闭")
                    }
                }
            }
        }
    }

    // This sub-dialog is for adding or editing a trigger
    if (showAddOrEditDialog != null) {
        val isEditing = showAddOrEditDialog!!.keyword.isNotEmpty()
        AddOrEditTriggerDialog(
            trigger = showAddOrEditDialog,
            isEditing = isEditing,
            onConfirm = { keyword, dialogType, options ->
                if (isEditing) {
                    val original = showAddOrEditDialog!!
                    onUpdateTrigger(
                        original,
                        original.copy(
                            keyword = keyword,
                            dialogType = dialogType,
                            options = options
                        )
                    )
                } else {
                    onAddTrigger(keyword, dialogType, options)
                }
                showAddOrEditDialog = null
            },
            onDelete = { toDelete ->
                onDeleteTrigger(toDelete)
                showAddOrEditDialog = null
            },
            onDismiss = { showAddOrEditDialog = null }
        )
    }
}

@Composable
private fun TriggerItem(
    trigger: KeywordTrigger,
    onEdit: (KeywordTrigger) -> Unit,
    onDelete: (KeywordTrigger) -> Unit
) {
    Card(
        border = BorderStroke(1.dp, Color.LightGray),
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 12.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                Text(text = "关键词: \"${trigger.keyword}\"", fontWeight = FontWeight.SemiBold)
                Text(text = "触发弹窗: ${trigger.dialogType.name}", style = MaterialTheme.typography.bodySmall)
                if (trigger.dialogType == DialogType.CHOICE_DIALOG) {
                    trigger.options.forEachIndexed { index, option ->
                        Text(
                            text = "选项${index + 1}: \"${option.label}\" | BGM: ${option.bgmAsset} | Δ好感: ${option.affectionDelta} | 白屏: ${if (option.triggerWhiteFlash) "是" else "否"}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
            Row(
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = { onEdit(trigger) }) {
                    Icon(Icons.Default.Edit, contentDescription = "编辑", tint = MaterialTheme.colorScheme.primary)
                }
                IconButton(onClick = { onDelete(trigger) }) {
                    Icon(Icons.Default.Delete, contentDescription = "删除", tint = MaterialTheme.colorScheme.error)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AddOrEditTriggerDialog(
    trigger: KeywordTrigger?,
    isEditing: Boolean,
    onConfirm: (keyword: String, dialogType: DialogType, options: List<TriggerOption>) -> Unit,
    onDelete: (KeywordTrigger) -> Unit,
    onDismiss: () -> Unit
) {
    var keyword by remember(trigger?.id) { mutableStateOf(trigger?.keyword ?: "") }
    var dialogType by remember(trigger?.id) { mutableStateOf(trigger?.dialogType ?: DialogType.CHOICE_DIALOG) }
    val optionStates = remember(trigger?.id) {
        mutableStateListOf<OptionFormState>().apply {
            val seed = trigger?.options ?: TriggerDefaults.defaultOptions(DialogType.CHOICE_DIALOG)
            seed.forEach { option ->
                add(
                    OptionFormState(
                        id = option.id,
                        label = option.label,
                        bgmAsset = option.bgmAsset,
                                affectionDelta = option.affectionDelta.toString(),
                                triggerWhiteFlash = option.triggerWhiteFlash
                    )
                )
            }
        }
    }
    var keywordError by remember(trigger?.id) { mutableStateOf(false) }
    var optionCountError by remember(trigger?.id) { mutableStateOf(false) }
    val scrollState = rememberScrollState()

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (isEditing) "编辑触发器" else "添加触发器") },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(scrollState)
            ) {
                OutlinedTextField(
                    value = keyword,
                    onValueChange = {
                        keyword = it
                        if (keywordError) {
                            keywordError = it.isBlank()
                        }
                    },
                    label = { Text("关键词") },
                    isError = keywordError,
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                if (keywordError) {
                    Text(
                        "关键词不能为空",
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall
                    )
                }

                Spacer(Modifier.height(16.dp))
                Text("选择弹窗类型:", modifier = Modifier.padding(bottom = 8.dp))

                // Dropdown or Radio buttons for DialogType selection
                // For simplicity, we use a simple row of buttons here.
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    DialogType.values().forEach { type ->
                        val isSelected = dialogType == type
                        Button(
                            onClick = {
                                dialogType = type
                                optionCountError = false
                            },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = if (isSelected) MaterialTheme.colorScheme.primary else Color.Gray
                            )
                        ) {
                            Text(type.name)
                        }
                    }
                }

                if (dialogType == DialogType.CHOICE_DIALOG) {
                    Spacer(Modifier.height(16.dp))
                    Text("自定义选项内容:", modifier = Modifier.padding(bottom = 8.dp))

                    optionStates.forEachIndexed { index, option ->
                        OptionEditor(
                            index = index,
                            totalCount = optionStates.size,
                            state = option,
                            onStateChange = { updated -> optionStates[index] = updated },
                            onRemove = {
                                if (optionStates.size > 2) {
                                    optionStates.removeAt(index)
                                    optionCountError = optionStates.size < 2
                                }
                            }
                        )
                        Spacer(Modifier.height(12.dp))
                    }

                    if (optionCountError) {
                        Text(
                            "至少需要两个选项",
                            color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodySmall
                        )
                    }

                    OutlinedButton(
                        onClick = {
                            optionStates.add(
                                OptionFormState(
                                    label = "选项${optionStates.size + 1}",
                                    bgmAsset = "",
                                    affectionDelta = "0.0",
                                    triggerWhiteFlash = false
                                )
                            )
                            optionCountError = false
                        }
                    ) {
                        Icon(Icons.Default.Add, contentDescription = "添加选项")
                        Text("添加选项", modifier = Modifier.padding(start = 4.dp))
                    }
                }

                if (isEditing && trigger != null) {
                    Spacer(Modifier.height(24.dp))
                    Divider()
                    Spacer(Modifier.height(16.dp))
                    OutlinedButton(
                        onClick = {
                            onDelete(trigger)
                            onDismiss()
                        },
                        colors = ButtonDefaults.outlinedButtonColors(
                            contentColor = MaterialTheme.colorScheme.error
                        ),
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.error.copy(alpha = 0.6f)),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("删除该触发器")
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    val sanitizedKeyword = keyword.trim()
                    keywordError = sanitizedKeyword.isEmpty()
                    val requiresOptions = dialogType == DialogType.CHOICE_DIALOG
                    var hasOptionError = false
                    val resolvedOptions = if (requiresOptions) {
                        if (optionStates.size < 2) {
                            optionCountError = true
                            hasOptionError = true
                        }
                        optionStates.mapIndexed { index, option ->
                            val trimmedLabel = option.label.trim()
                            val trimmedBgm = option.bgmAsset.trim()
                            val deltaText = option.affectionDelta.trim()
                            val deltaValue = deltaText.toFloatOrNull()

                            var updated = option
                            if (trimmedLabel.isEmpty()) {
                                updated = updated.copy(labelError = true)
                                hasOptionError = true
                            } else if (option.labelError) {
                                updated = updated.copy(labelError = false)
                            }
                            if (trimmedBgm.isEmpty()) {
                                updated = updated.copy(bgmError = true)
                                hasOptionError = true
                            } else if (option.bgmError) {
                                updated = updated.copy(bgmError = false)
                            }
                            if (deltaValue == null) {
                                updated = updated.copy(affectionError = true)
                                hasOptionError = true
                            } else if (option.affectionError) {
                                updated = updated.copy(affectionError = false)
                            }
                            if (updated != option) {
                                optionStates[index] = updated
                            }

                            TriggerOption(
                                id = option.id,
                                label = trimmedLabel.ifEmpty { option.label },
                                bgmAsset = trimmedBgm.ifEmpty { option.bgmAsset },
                                affectionDelta = deltaValue ?: 0f,
                                triggerWhiteFlash = option.triggerWhiteFlash
                            )
                        }
                    } else {
                        emptyList()
                    }

                    if (!keywordError && !hasOptionError) {
                        optionCountError = false
                        onConfirm(sanitizedKeyword, dialogType, resolvedOptions)
                    }
                }
            ) {
                Text("确认")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("取消")
            }
        }
    )
}

private data class OptionFormState(
    val id: String = java.util.UUID.randomUUID().toString(),
    val label: String,
    val bgmAsset: String,
    val affectionDelta: String,
    val triggerWhiteFlash: Boolean = false,
    val labelError: Boolean = false,
    val bgmError: Boolean = false,
    val affectionError: Boolean = false
)

@Composable
private fun OptionEditor(
    index: Int,
    totalCount: Int,
    state: OptionFormState,
    onStateChange: (OptionFormState) -> Unit,
    onRemove: () -> Unit
) {
    Card(
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.4f)),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("选项 ${index + 1}", style = MaterialTheme.typography.titleSmall)
                IconButton(
                    onClick = onRemove,
                    enabled = totalCount > 2,
                    colors = IconButtonDefaults.iconButtonColors(
                        contentColor = MaterialTheme.colorScheme.error,
                        disabledContentColor = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                ) {
                    Icon(Icons.Default.Delete, contentDescription = "删除选项")
                }
            }

            OutlinedTextField(
                value = state.label,
                onValueChange = { onStateChange(state.copy(label = it, labelError = false)) },
                label = { Text("选项文本") },
                isError = state.labelError,
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            if (state.labelError) {
                Text(
                    "选项文本不能为空",
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall
                )
            }

            Spacer(Modifier.height(8.dp))

            OutlinedTextField(
                value = state.bgmAsset,
                onValueChange = { onStateChange(state.copy(bgmAsset = it, bgmError = false)) },
                label = { Text("BGM 文件名") },
                isError = state.bgmError,
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            if (state.bgmError) {
                Text(
                    "BGM 文件名不能为空",
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall
                )
            }

            Spacer(Modifier.height(8.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("触发白屏", style = MaterialTheme.typography.bodyMedium)
                Switch(
                    checked = state.triggerWhiteFlash,
                    onCheckedChange = { onStateChange(state.copy(triggerWhiteFlash = it)) }
                )
            }

            Spacer(Modifier.height(8.dp))

            OutlinedTextField(
                value = state.affectionDelta,
                onValueChange = { onStateChange(state.copy(affectionDelta = it, affectionError = false)) },
                label = { Text("好感度变动 (可为负数)") },
                isError = state.affectionError,
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.fillMaxWidth()
            )
            if (state.affectionError) {
                Text(
                    "请输入有效的数字",
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall
                )
            }
        }
    }
}

@Composable
fun ParentComposable() {
    var triggers by remember {
        mutableStateOf(listOf(KeywordTrigger(keyword = "吗", dialogType = DialogType.CHOICE_DIALOG)))
    }


    // 进度条相关：显示距离下一次更新的剩余时间
}
