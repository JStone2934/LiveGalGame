-- LiveGalGame 示例数据初始化脚本

-- 插入角色数据
INSERT OR IGNORE INTO characters (id, name, nickname, relationship_label, avatar_color, affinity, created_at, updated_at, notes) VALUES
('miyu', 'Miyu', '小咪', '青梅竹马', '#ff6b6b', 75, 1735689600000, 1735689600000, '活泼可爱的青梅竹马，喜欢樱花'),
('akira', 'Akira', '会长', '学生会长', '#4ecdc4', 60, 1735689600000, 1735689600000, '认真负责的学生会长，做事有条理'),
('hana', 'Hana', '花酱', '图书馆管理员', '#ffe66d', 45, 1735689600000, 1735689600000, '文静内向的图书管理员，喜欢读书');

-- 插入标签数据
INSERT OR IGNORE INTO tags (id, name, color) VALUES
('tag_active', '主动', 'primary'),
('tag_caring', '体贴', 'success'),
('tag_emotional', '情感', 'primary'),
('tag_sincere', '真诚', 'warning'),
('tag_gentle', '温柔', 'primary'),
('tag_serious', '认真', 'primary');

-- 关联角色和标签
INSERT OR IGNORE INTO character_tags (character_id, tag_id) VALUES
('miyu', 'tag_active'),
('miyu', 'tag_caring'),
('akira', 'tag_serious'),
('akira', 'tag_sincere'),
('hana', 'tag_gentle'),
('hana', 'tag_emotional');

-- 插入对话数据
INSERT OR IGNORE INTO conversations (id, character_id, title, date, affinity_change, summary, tags, created_at, updated_at) VALUES
-- Miyu 的对话
('conv_miyu_1', 'miyu', '樱花下的约定', 1735689600000, 10, '一起讨论了去公园看樱花的计划', '愉快,日常', 1735689600000, 1735689600000),
('conv_miyu_2', 'miyu', '午后的咖啡时光', 1735689700000, 8, '在咖啡厅偶遇，一起聊天', '日常,轻松', 1735689700000, 1735689700000),
('conv_miyu_3', 'miyu', '回忆童年时光', 1735689800000, 12, '聊起了小时候一起玩耍的回忆', '回忆,温馨', 1735689800000, 1735689800000),
-- Akira 的对话
('conv_akira_1', 'akira', '学生会的会议', 1735689601000, 5, '讨论了学生会的工作安排', '工作,认真', 1735689601000, 1735689601000),
('conv_akira_2', 'akira', '文化节筹备', 1735689701000, 7, '一起策划文化节的活动', '工作,合作', 1735689701000, 1735689701000),
('conv_akira_3', 'akira', '学习小组', 1735689801000, 6, '讨论学习方法和考试准备', '学习,互助', 1735689801000, 1735689801000),
-- Hana 的对话
('conv_hana_1', 'hana', '图书馆的偶遇', 1735689602000, 8, '在图书馆偶遇并聊起了喜欢的书籍', '日常,读书', 1735689602000, 1735689602000),
('conv_hana_2', 'hana', '推荐好书', 1735689702000, 9, '互相推荐喜欢的书籍和作者', '读书,分享', 1735689702000, 1735689702000),
('conv_hana_3', 'hana', '安静的阅读时光', 1735689802000, 7, '一起在图书馆安静地阅读', '读书,安静', 1735689802000, 1735689802000);

-- 插入消息数据
INSERT OR IGNORE INTO messages (id, conversation_id, sender, content, timestamp, is_ai_generated) VALUES
-- Miyu 对话1的消息
('msg_miyu_1_1', 'conv_miyu_1', 'character', '哦，真的吗？我刚才还在想，待会儿要不要去散散步。这个季节的樱花应该很美。', 1735689600000, 0),
('msg_miyu_1_2', 'conv_miyu_1', 'user', '听起来真不错！也许我们可以一起去？', 1735689601000, 0),
('msg_miyu_1_3', 'conv_miyu_1', 'character', '太好了！我一直想和你一起去散步呢。', 1735689602000, 0),
('msg_miyu_1_4', 'conv_miyu_1', 'user', '我知道附近有个很棒的公园，樱花特别美，要不要去那里？', 1735689603000, 0),
-- Miyu 对话2的消息
('msg_miyu_2_1', 'conv_miyu_2', 'character', '好巧啊，你也在这里！', 1735689700000, 0),
('msg_miyu_2_2', 'conv_miyu_2', 'user', '是啊，来喝杯咖啡放松一下。', 1735689701000, 0),
('msg_miyu_2_3', 'conv_miyu_2', 'character', '那我们一起坐吧，我正好也想找人聊聊天。', 1735689702000, 0),
('msg_miyu_2_4', 'conv_miyu_2', 'user', '当然可以！', 1735689703000, 0),
-- Miyu 对话3的消息
('msg_miyu_3_1', 'conv_miyu_3', 'character', '你还记得我们小时候一起爬树的事情吗？', 1735689800000, 0),
('msg_miyu_3_2', 'conv_miyu_3', 'user', '当然记得！那时候你总是爬得比我高。', 1735689801000, 0),
('msg_miyu_3_3', 'conv_miyu_3', 'character', '哈哈，现在想想真是美好的回忆呢。', 1735689802000, 0),
-- Akira 对话1的消息
('msg_akira_1_1', 'conv_akira_1', 'character', '关于下周的学生会会议，你有什么想法吗？', 1735689601000, 0),
('msg_akira_1_2', 'conv_akira_1', 'user', '我觉得可以讨论一下文化节的活动安排。', 1735689602000, 0),
('msg_akira_1_3', 'conv_akira_1', 'character', '好主意！那我们明天详细讨论一下。', 1735689603000, 0),
-- Akira 对话2的消息
('msg_akira_2_1', 'conv_akira_2', 'character', '文化节的活动方案我已经看过了，有几个地方需要调整。', 1735689701000, 0),
('msg_akira_2_2', 'conv_akira_2', 'user', '好的，我们一起看看哪些地方可以改进。', 1735689702000, 0),
('msg_akira_2_3', 'conv_akira_2', 'character', '谢谢你的配合，有你在真是太好了。', 1735689703000, 0),
-- Akira 对话3的消息
('msg_akira_3_1', 'conv_akira_3', 'character', '这次考试你准备得怎么样？', 1735689801000, 0),
('msg_akira_3_2', 'conv_akira_3', 'user', '还在复习中，有些地方不太明白。', 1735689802000, 0),
('msg_akira_3_3', 'conv_akira_3', 'character', '那我们可以一起学习，互相帮助。', 1735689803000, 0),
-- Hana 对话1的消息
('msg_hana_1_1', 'conv_hana_1', 'character', '你也喜欢这本书吗？', 1735689602000, 0),
('msg_hana_1_2', 'conv_hana_1', 'user', '是的，我很喜欢作者的写作风格。', 1735689603000, 0),
('msg_hana_1_3', 'conv_hana_1', 'character', '我也是！这本书我已经读了好几遍了。', 1735689604000, 0),
-- Hana 对话2的消息
('msg_hana_2_1', 'conv_hana_2', 'character', '我最近发现了一本很棒的小说，推荐给你。', 1735689702000, 0),
('msg_hana_2_2', 'conv_hana_2', 'user', '太好了！我也正好想找新书看。', 1735689703000, 0),
('msg_hana_2_3', 'conv_hana_2', 'character', '那下次我们可以一起讨论读后感。', 1735689704000, 0),
-- Hana 对话3的消息
('msg_hana_3_1', 'conv_hana_3', 'character', '图书馆真是个安静的好地方。', 1735689802000, 0),
('msg_hana_3_2', 'conv_hana_3', 'user', '是啊，在这里读书心情都会变得平静。', 1735689803000, 0),
('msg_hana_3_3', 'conv_hana_3', 'character', '那我们以后可以经常一起来。', 1735689804000, 0);

-- 插入AI建议数据
INSERT OR IGNORE INTO ai_suggestions (id, conversation_id, message_id, title, content, affinity_prediction, tags, is_used, created_at) VALUES
('sugg_miyu_1', 'conv_miyu_1', 'msg_miyu_1_2', '提议具体地点', '我知道附近有个很棒的公园，樱花特别美，要不要去那里？', 15, '主动,体贴', 1, 1735689603000),
('sugg_miyu_2', 'conv_miyu_1', 'msg_miyu_1_2', '表达期待', '太好了！我一直想和你一起去散步呢。', 10, '情感,真诚', 0, 1735689602000),
('sugg_akira_1', 'conv_akira_2', 'msg_akira_2_2', '主动配合', '好的，我们一起看看哪些地方可以改进。', 8, '合作,积极', 1, 1735689702000),
('sugg_hana_1', 'conv_hana_2', 'msg_hana_2_2', '表达兴趣', '太好了！我也正好想找新书看。', 12, '兴趣,共鸣', 1, 1735689703000);

