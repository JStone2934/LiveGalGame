数据模型与存储（SQLite）

存储引擎
- 本地 SQLite（better-sqlite3）；加密字段（API Key）存 OS Keychain/DPAPI。
- 迁移机制：按版本号执行 DDL；备份与导入/导出 JSON。

表设计（简版）
- person
  - id (pk, uuid)
  - name (text)
  - relation_tag (text)  // 暧昧对象/同事/好友等
  - notes (text)         // 备注，供提示工程
  - favor_score (int)    // 当前好感度 0-100
  - created_at, updated_at
- conversation
  - id (pk)
  - person_id (fk)
  - started_at, ended_at
  - meta (json)          // 设备、模型、环境信息
- turn
  - id (pk)
  - conversation_id (fk)
  - role (text)          // user/peer
  - text (text)          // 转写结果
  - start_ms, end_ms
  - source (text)        // mic/system
- event
  - id (pk)
  - conversation_id (fk)
  - type (text)          // suggestion_shown/accepted/feedback
  - payload (json)       // 建议卡内容、被采纳与否、打分等
  - ts
- score
  - id (pk)
  - conversation_id (fk)
  - delta (int)          // +20/-5
  - reason (text)
  - ts
- model_profile
  - id (pk)
  - provider (text)      // openai/anthropic/local
  - model (text)
  - endpoint (text)
  - is_default (bool)
- settings
  - id (pk, 1)
  - audio_prefs (json)   // 设备、采样率、VAD
  - hud_prefs (json)
  - privacy_prefs (json)

查询与索引
- turn(conversation_id, start_ms) 索引以便时间序列读取。
- event(conversation_id, ts) 与 score(conversation_id, ts) 索引。

导出与备份
- 导出单次对话（JSON + 可选音频片段）；可批量导出人物档案与曲线。


