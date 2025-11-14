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

-- 插入AI分析报告数据
INSERT OR IGNORE INTO ai_analysis (id, conversation_id, message_id, insight_type, content, created_at) VALUES
-- Miyu 对话1的分析报告
('analysis_miyu_1', 'conv_miyu_1', NULL, 'analysis_report', '{"expressionAbility":{"score":88,"description":"清晰流畅"},"topicSelection":{"score":92,"description":"非常契合"}}', 1735689604000),
-- Miyu 对话2的分析报告
('analysis_miyu_2', 'conv_miyu_2', NULL, 'analysis_report', '{"expressionAbility":{"score":85,"description":"自然亲切"},"topicSelection":{"score":90,"description":"话题合适"}}', 1735689704000),
-- Miyu 对话3的分析报告
('analysis_miyu_3', 'conv_miyu_3', NULL, 'analysis_report', '{"expressionAbility":{"score":90,"description":"情感真挚"},"topicSelection":{"score":88,"description":"回忆共鸣"}}', 1735689804000),
-- Akira 对话1的分析报告
('analysis_akira_1', 'conv_akira_1', NULL, 'analysis_report', '{"expressionAbility":{"score":82,"description":"条理清晰"},"topicSelection":{"score":85,"description":"工作相关"}}', 1735689604000),
-- Akira 对话2的分析报告
('analysis_akira_2', 'conv_akira_2', NULL, 'analysis_report', '{"expressionAbility":{"score":86,"description":"表达准确"},"topicSelection":{"score":88,"description":"合作默契"}}', 1735689704000),
-- Akira 对话3的分析报告
('analysis_akira_3', 'conv_akira_3', NULL, 'analysis_report', '{"expressionAbility":{"score":84,"description":"沟通有效"},"topicSelection":{"score":87,"description":"学习互助"}}', 1735689804000),
-- Hana 对话1的分析报告
('analysis_hana_1', 'conv_hana_1', NULL, 'analysis_report', '{"expressionAbility":{"score":87,"description":"温和有礼"},"topicSelection":{"score":91,"description":"兴趣相投"}}', 1735689605000),
-- Hana 对话2的分析报告
('analysis_hana_2', 'conv_hana_2', NULL, 'analysis_report', '{"expressionAbility":{"score":89,"description":"表达自然"},"topicSelection":{"score":93,"description":"非常契合"}}', 1735689705000),
-- Hana 对话3的分析报告
('analysis_hana_3', 'conv_hana_3', NULL, 'analysis_report', '{"expressionAbility":{"score":88,"description":"情感细腻"},"topicSelection":{"score":90,"description":"氛围合适"}}', 1735689805000);

-- 插入关键时刻回放数据
INSERT OR IGNORE INTO ai_analysis (id, conversation_id, message_id, insight_type, content, created_at) VALUES
-- Miyu 对话1的关键时刻
('keymoment_miyu_1_1', 'conv_miyu_1', 'msg_miyu_1_2', 'key_moment', '{"content":"回应积极，主动提出一起散步，推进了关系发展"}', 1735689601500),
-- Miyu 对话2的关键时刻
('keymoment_miyu_2_1', 'conv_miyu_2', 'msg_miyu_2_2', 'key_moment', '{"content":"回应过于简单，可以展开更多话题"}', 1735689701500),
-- Akira 对话2的关键时刻
('keymoment_akira_2_1', 'conv_akira_2', 'msg_akira_2_2', 'key_moment', '{"content":"主动配合工作，展现了合作精神，对方很满意"}', 1735689702500),
-- Hana 对话2的关键时刻
('keymoment_hana_2_1', 'conv_hana_2', 'msg_hana_2_2', 'key_moment', '{"content":"表达了对书籍的兴趣，建立了共同话题，好感度提升"}', 1735689703500),
-- Hana 对话3的关键时刻
('keymoment_hana_3_1', 'conv_hana_3', 'msg_hana_3_2', 'key_moment', '{"content":"回应过于平淡，错失了展开话题的机会"}', 1735689803500);

-- 插入表现态度分析数据（针对本轮对话的）
INSERT OR IGNORE INTO ai_analysis (id, conversation_id, message_id, insight_type, content, created_at) VALUES
-- Miyu 对话1的表现态度分析
('attitude_miyu_1', 'conv_miyu_1', NULL, 'attitude_analysis', '{"description":"对方在本轮对话中表现非常积极，主动提出一起散步的想法，对共同活动表现出浓厚的兴趣。整体态度友好热情，互动氛围轻松愉快。","affinityChange":10,"trend":"上升"}', 1735689604000),
-- Miyu 对话2的表现态度分析
('attitude_miyu_2', 'conv_miyu_2', NULL, 'attitude_analysis', '{"description":"对方在偶遇时主动打招呼，表现出想要一起聊天的意愿。对话中态度友好，愿意分享时间和空间。","affinityChange":8,"trend":"上升"}', 1735689704000),
-- Miyu 对话3的表现态度分析
('attitude_miyu_3', 'conv_miyu_3', NULL, 'attitude_analysis', '{"description":"对方主动提起童年回忆，表现出对过去美好时光的怀念。对话中情感真挚，愿意分享个人回忆，关系进一步加深。","affinityChange":12,"trend":"上升"}', 1735689804000),
-- Akira 对话1的表现态度分析
('attitude_akira_1', 'conv_akira_1', NULL, 'attitude_analysis', '{"description":"对方在工作相关话题上表现专业认真，主动征求你的意见，展现出合作的态度。虽然话题较为正式，但互动积极。","affinityChange":5,"trend":"上升"}', 1735689604000),
-- Akira 对话2的表现态度分析
('attitude_akira_2', 'conv_akira_2', NULL, 'attitude_analysis', '{"description":"对方对你的配合表示感谢，表现出对合作的认可。对话中态度友好，愿意共同解决问题，关系进一步改善。","affinityChange":7,"trend":"上升"}', 1735689704000),
-- Akira 对话3的表现态度分析
('attitude_akira_3', 'conv_akira_3', NULL, 'attitude_analysis', '{"description":"对方主动关心你的学习情况，提出一起学习的建议，表现出互助的意愿。态度友好，愿意提供帮助。","affinityChange":6,"trend":"上升"}', 1735689804000),
-- Hana 对话1的表现态度分析
('attitude_hana_1', 'conv_hana_1', NULL, 'attitude_analysis', '{"description":"对方在发现共同兴趣时表现出明显的兴奋，主动分享自己的阅读体验。虽然性格内向，但在感兴趣的话题上愿意主动交流。","affinityChange":8,"trend":"上升"}', 1735689604000),
-- Hana 对话2的表现态度分析
('attitude_hana_2', 'conv_hana_2', NULL, 'attitude_analysis', '{"description":"对方主动推荐书籍，表现出想要分享和建立联系的意愿。对话中态度友好，愿意进一步交流，关系明显改善。","affinityChange":9,"trend":"上升"}', 1735689704000),
-- Hana 对话3的表现态度分析
('attitude_hana_3', 'conv_hana_3', NULL, 'attitude_analysis', '{"description":"对方在安静的环境中表现出放松和舒适，愿意一起度过安静的时光。虽然对话简短，但态度友好，愿意继续接触。","affinityChange":7,"trend":"上升"}', 1735689804000);

-- 插入行动建议数据（可以尝试的话题和避开的话题）
INSERT OR IGNORE INTO ai_suggestions (id, conversation_id, message_id, title, content, affinity_prediction, tags, is_used, created_at) VALUES
-- Miyu 的行动建议
('action_miyu_1', 'conv_miyu_1', NULL, '可以尝试的话题', '最近读过的书、喜欢的音乐风格、户外活动、美食推荐', NULL, '可以尝试,话题', 0, 1735689604000),
('action_miyu_2', 'conv_miyu_1', NULL, '避开的话题', '过于功利的现实问题、工作压力、负面情绪', NULL, '避开,话题', 0, 1735689604000),
-- Akira 的行动建议
('action_akira_1', 'conv_akira_1', NULL, '可以尝试的话题', '学习计划、未来规划、兴趣爱好、共同目标', NULL, '可以尝试,话题', 0, 1735689604000),
('action_akira_2', 'conv_akira_1', NULL, '避开的话题', '过于私人的问题、负面评价、抱怨', NULL, '避开,话题', 0, 1735689604000),
-- Hana 的行动建议
('action_hana_1', 'conv_hana_1', NULL, '可以尝试的话题', '最近读过的书、喜欢的音乐风格、文学作品、安静的活动', NULL, '可以尝试,话题', 0, 1735689604000),
('action_hana_2', 'conv_hana_1', NULL, '避开的话题', '过于功利的现实问题、嘈杂的环境、过于活跃的话题', NULL, '避开,话题', 0, 1735689604000);

