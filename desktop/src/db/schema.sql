-- LiveGalGame Database Schema

-- 攻略对象表
CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  nickname TEXT,
  relationship_label TEXT, -- 关系标签（青梅竹马、学生会长等）
  avatar_color TEXT, -- 头像颜色
  affinity INTEGER DEFAULT 50, -- 好感度（0-100）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  notes TEXT -- 备注
);

-- 关键词标签表（用于角色特点）
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT 'primary' -- 标签颜色
);

-- 角色-标签关联表
CREATE TABLE IF NOT EXISTS character_tags (
  character_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (character_id, tag_id),
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- 对话记录表
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  title TEXT, -- 对话标题
  date INTEGER NOT NULL, -- 对话日期（时间戳）
  affinity_change INTEGER DEFAULT 0, -- 好感度变化
  summary TEXT, -- 对话摘要
  tags TEXT, -- 标签（逗号分隔）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

-- 消息记录表
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender TEXT NOT NULL, -- 'user' or 'character'
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  is_ai_generated INTEGER DEFAULT 0, -- 是否AI生成
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- AI分析记录表
CREATE TABLE IF NOT EXISTS ai_analysis (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  message_id TEXT, -- 关联的具体消息（可选）
  insight_type TEXT, -- 洞察类型（情感分析、建议等）
  content TEXT NOT NULL, -- 分析内容
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

-- AI建议记录表
CREATE TABLE IF NOT EXISTS ai_suggestions (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  message_id TEXT, -- 关联的具体消息（可选）
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  affinity_prediction INTEGER, -- 好感度变化预测
  tags TEXT, -- 标签（逗号分隔）
  is_used INTEGER DEFAULT 0, -- 是否被采用
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

-- 角色详细信息表（从会话中总结）
CREATE TABLE IF NOT EXISTS character_details (
  character_id TEXT PRIMARY KEY,
  profile TEXT, -- JSON格式：角色档案（基本信息、背景等）
  personality_traits TEXT, -- JSON格式：性格特点（从对话中总结）
  likes_dislikes TEXT, -- JSON格式：喜好厌恶（从对话中提取）
  important_events TEXT, -- JSON格式：重要事件（从对话中提取）
  conversation_summary TEXT, -- 对话总结
  custom_fields TEXT, -- JSON格式：自定义字段（可扩展）
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

-- LLM配置表
CREATE TABLE IF NOT EXISTS llm_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL, -- 配置名称
  provider TEXT NOT NULL DEFAULT 'openai', -- 提供商（openai等）
  api_key TEXT NOT NULL, -- API密钥
  base_url TEXT, -- API基础URL（可选，默认使用提供商的标准URL）
  is_default INTEGER DEFAULT 0, -- 是否为默认配置
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 索引优化
CREATE INDEX IF NOT EXISTS idx_conversations_character_id ON conversations(character_id);
CREATE INDEX IF NOT EXISTS idx_conversations_date ON conversations(date);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_character_tags_character_id ON character_tags(character_id);
CREATE INDEX IF NOT EXISTS idx_ai_analysis_conversation_id ON ai_analysis(conversation_id);
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_conversation_id ON ai_suggestions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_character_details_character_id ON character_details(character_id);
CREATE INDEX IF NOT EXISTS idx_llm_configs_is_default ON llm_configs(is_default);
