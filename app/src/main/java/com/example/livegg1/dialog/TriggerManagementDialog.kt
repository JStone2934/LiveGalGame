package com.example.livegg1.dialog

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.example.livegg1.model.DialogType
import com.example.livegg1.model.KeywordTrigger

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TriggerManagementDialog(
    triggers: List<KeywordTrigger>,
    onAddTrigger: (keyword: String, dialogType: DialogType) -> Unit,
    onUpdateTrigger: (original: KeywordTrigger, updated: KeywordTrigger) -> Unit,
    onDeleteTrigger: (trigger: KeywordTrigger) -> Unit,
    onDismiss: () -> Unit
) {
    var showAddOrEditDialog by remember { mutableStateOf<KeywordTrigger?>(null) }
    // A dummy trigger to represent the "add" state
    val addStateTrigger = KeywordTrigger(keyword = "", dialogType = DialogType.CHOICE_DIALOG)

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
                        onClick = { showAddOrEditDialog = addStateTrigger },
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
            onConfirm = { keyword, dialogType ->
                if (isEditing) {
                    val original = showAddOrEditDialog!!
                    onUpdateTrigger(original, original.copy(keyword = keyword, dialogType = dialogType))
                } else {
                    onAddTrigger(keyword, dialogType)
                }
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
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column {
                Text(text = "关键词: \"${trigger.keyword}\"", fontWeight = FontWeight.SemiBold)
                Text(text = "触发弹窗: ${trigger.dialogType.name}", style = MaterialTheme.typography.bodySmall)
            }
            Row {
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
    onConfirm: (keyword: String, dialogType: DialogType) -> Unit,
    onDismiss: () -> Unit
) {
    var keyword by remember { mutableStateOf(trigger?.keyword ?: "") }
    var dialogType by remember { mutableStateOf(trigger?.dialogType ?: DialogType.CHOICE_DIALOG) }
    var keywordError by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (isEditing) "编辑触发器" else "添加触发器") },
        text = {
            Column {
                OutlinedTextField(
                    value = keyword,
                    onValueChange = {
                        keyword = it
                        keywordError = it.isBlank()
                    },
                    label = { Text("关键词") },
                    isError = keywordError,
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                if (keywordError) {
                    Text("关键词不能为空", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }

                Spacer(Modifier.height(16.dp))
                Text("选择弹窗类型:", modifier = Modifier.padding(bottom = 8.dp))

                // Dropdown or Radio buttons for DialogType selection
                // For simplicity, we use a simple row of buttons here.
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    DialogType.values().forEach { type ->
                        val isSelected = dialogType == type
                        Button(
                            onClick = { dialogType = type },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = if (isSelected) MaterialTheme.colorScheme.primary else Color.Gray
                            )
                        ) {
                            Text(type.name)
                        }
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    if (keyword.isNotBlank()) {
                        onConfirm(keyword, dialogType)
                    } else {
                        keywordError = true
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

@Composable
fun ParentComposable() {
    var triggers by remember {
        mutableStateOf(listOf(KeywordTrigger(keyword = "吗", dialogType = DialogType.CHOICE_DIALOG)))
    }


    // 进度条相关：显示距离下一次更新的剩余时间
}
