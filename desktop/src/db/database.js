const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class DatabaseManager {
  constructor() {
    // 数据库文件路径
    const dbPath = path.join(__dirname, '../../data/livegalgame.db');

    // 确保data目录存在
    const dataDir = path.dirname(dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // 创建数据库连接
    this.db = new Database(dbPath, {
      verbose: process.env.NODE_ENV === 'development' ? console.log : null
    });

    // 启用外键约束
    this.db.pragma('foreign_keys = ON');

    // 初始化数据库表
    this.initialize();

    console.log('Database initialized at:', dbPath);
  }

  // 初始化数据库表
  initialize() {
    console.log('Initializing database schema...');
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');

    // 执行SQL语句（分割并逐条执行）
    const statements = schema.split(';').filter(stmt => stmt.trim());

    // 开始事务
    const transaction = this.db.transaction(() => {
      for (const statement of statements) {
        if (statement.trim()) {
          this.db.exec(statement);
        }
      }
    });

    transaction();
    console.log('Database schema initialized');

    // 初始化示例数据（如果数据库为空）
    this.seedSampleData();
  }

  // 关闭数据库连接
  close() {
    if (this.db) {
      this.db.close();
    }
  }

  // ========== 角色相关方法 ==========

  // 创建角色
  createCharacter(characterData) {
    const stmt = this.db.prepare(`
      INSERT INTO characters (id, name, nickname, relationship_label, avatar_color, affinity, created_at, updated_at, notes)
      VALUES (@id, @name, @nickname, @relationship_label, @avatar_color, @affinity, @created_at, @updated_at, @notes)
    `);

    const info = stmt.run({
      id: characterData.id || this.generateId(),
      name: characterData.name,
      nickname: characterData.nickname || null,
      relationship_label: characterData.relationship_label || null,
      avatar_color: characterData.avatar_color || '#ff6b6b',
      affinity: characterData.affinity || 50,
      created_at: Date.now(),
      updated_at: Date.now(),
      notes: characterData.notes || null
    });

    return this.getCharacterById(characterData.id || info.lastInsertRowid);
  }

  // 获取所有角色
  getAllCharacters() {
    const stmt = this.db.prepare(`
      SELECT c.*,
             GROUP_CONCAT(t.name) as tags
      FROM characters c
      LEFT JOIN character_tags ct ON c.id = ct.character_id
      LEFT JOIN tags t ON ct.tag_id = t.id
      GROUP BY c.id
      ORDER BY c.updated_at DESC
    `);

    return stmt.all().map(row => ({
      ...row,
      tags: row.tags ? row.tags.split(',') : []
    }));
  }

  // 获取单个角色
  getCharacterById(id) {
    const stmt = this.db.prepare(`
      SELECT c.*,
             GROUP_CONCAT(t.name) as tags
      FROM characters c
      LEFT JOIN character_tags ct ON c.id = ct.character_id
      LEFT JOIN tags t ON ct.tag_id = t.id
      WHERE c.id = ?
      GROUP BY c.id
    `);

    const row = stmt.get(id);
    if (!row) return null;

    return {
      ...row,
      tags: row.tags ? row.tags.split(',') : []
    };
  }

  // 更新角色
  updateCharacter(id, updates) {
    const fields = [];
    const values = { id };

    for (const [key, value] of Object.entries(updates)) {
      if (key !== 'id' && key !== 'tags') {
        fields.push(`${key} = @${key}`);
        values[key] = value;
      }
    }

    fields.push('updated_at = @updated_at');
    values.updated_at = Date.now();

    const stmt = this.db.prepare(`
      UPDATE characters
      SET ${fields.join(', ')}
      WHERE id = @id
    `);

    stmt.run(values);
    return this.getCharacterById(id);
  }

  // ========== 对话相关方法 ==========

  // 创建对话
  createConversation(conversationData) {
    const stmt = this.db.prepare(`
      INSERT INTO conversations (id, character_id, title, date, affinity_change, summary, tags, created_at, updated_at)
      VALUES (@id, @character_id, @title, @date, @affinity_change, @summary, @tags, @created_at, @updated_at)
    `);

    const info = stmt.run({
      id: conversationData.id || this.generateId(),
      character_id: conversationData.character_id,
      title: conversationData.title || null,
      date: conversationData.date || Date.now(),
      affinity_change: conversationData.affinity_change || 0,
      summary: conversationData.summary || null,
      tags: conversationData.tags || null,
      created_at: Date.now(),
      updated_at: Date.now()
    });

    return this.getConversationById(conversationData.id || info.lastInsertRowid);
  }

  // 获取角色的所有对话（带角色信息和消息数）
  getConversationsByCharacter(characterId) {
    const stmt = this.db.prepare(`
      SELECT
        c.*,
        char.name as character_name,
        char.avatar_color as character_avatar_color,
        char.id as character_id,
        COUNT(m.id) as message_count
      FROM conversations c
      INNER JOIN characters char ON c.character_id = char.id
      LEFT JOIN messages m ON c.id = m.conversation_id
      WHERE c.character_id = ?
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `);

    return stmt.all(characterId);
  }

  // 获取单个对话
  getConversationById(id) {
    const stmt = this.db.prepare('SELECT * FROM conversations WHERE id = ?');
    return stmt.get(id);
  }

  // ========== 消息相关方法 ==========

  // 创建消息
  createMessage(messageData) {
    const stmt = this.db.prepare(`
      INSERT INTO messages (id, conversation_id, sender, content, timestamp, is_ai_generated)
      VALUES (@id, @conversation_id, @sender, @content, @timestamp, @is_ai_generated)
    `);

    const info = stmt.run({
      id: messageData.id || this.generateId(),
      conversation_id: messageData.conversation_id,
      sender: messageData.sender, // 'user' or 'character'
      content: messageData.content,
      timestamp: messageData.timestamp || Date.now(),
      is_ai_generated: messageData.is_ai_generated ? 1 : 0
    });

    return this.getMessageById(messageData.id || info.lastInsertRowid);
  }

  // 获取对话的所有消息
  getMessagesByConversation(conversationId) {
    const stmt = this.db.prepare(`
      SELECT * FROM messages
      WHERE conversation_id = ?
      ORDER BY timestamp ASC
    `);

    return stmt.all(conversationId);
  }

  // 获取单个消息
  getMessageById(id) {
    const stmt = this.db.prepare('SELECT * FROM messages WHERE id = ?');
    return stmt.get(id);
  }

  // 更新消息
  updateMessage(id, updates) {
    const allowedFields = ['content'];
    const updateFields = Object.keys(updates).filter(key => allowedFields.includes(key));
    
    if (updateFields.length === 0) {
      return this.getMessageById(id);
    }

    const setClause = updateFields.map(field => `${field} = @${field}`).join(', ');
    const stmt = this.db.prepare(`
      UPDATE messages
      SET ${setClause}
      WHERE id = @id
    `);

    const params = { id };
    updateFields.forEach(field => {
      params[field] = updates[field];
    });

    stmt.run(params);
    return this.getMessageById(id);
  }

  // ========== 标签相关方法 ==========

  // 创建标签
  createTag(tagData) {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO tags (id, name, color)
      VALUES (@id, @name, @color)
    `);

    const info = stmt.run({
      id: tagData.id || this.generateId(),
      name: tagData.name,
      color: tagData.color || 'primary'
    });

    return this.getTagById(tagData.id || info.lastInsertRowid);
  }

  // 获取所有标签
  getAllTags() {
    const stmt = this.db.prepare('SELECT * FROM tags ORDER BY name');
    return stmt.all();
  }

  // 获取单个标签
  getTagById(id) {
    const stmt = this.db.prepare('SELECT * FROM tags WHERE id = ?');
    return stmt.get(id);
  }

  // 为角色添加标签
  addTagToCharacter(characterId, tagId) {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO character_tags (character_id, tag_id)
      VALUES (?, ?)
    `);

    stmt.run(characterId, tagId);
  }

  // ========== 统计相关方法 ==========

  // 获取对话总数
  getConversationCount() {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM conversations');
    return stmt.get().count;
  }

  // 获取消息总数
  getMessageCount() {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM messages');
    return stmt.get().count;
  }

  // 获取角色的对话统计
  getCharacterStats(characterId) {
    const stmt = this.db.prepare(`
      SELECT
        COUNT(DISTINCT c.id) as conversation_count,
        COUNT(m.id) as message_count,
        MAX(c.date) as last_conversation_date
      FROM conversations c
      LEFT JOIN messages m ON c.id = m.conversation_id
      WHERE c.character_id = ?
    `);

    return stmt.get(characterId);
  }

  // 获取统计数据
  getStatistics() {
    const characterCount = this.db.prepare('SELECT COUNT(*) as count FROM characters').get().count;
    const conversationCount = this.db.prepare('SELECT COUNT(*) as count FROM conversations').get().count;
    const messageCount = this.db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
    
    // 计算平均好感度
    const avgAffinity = this.db.prepare('SELECT AVG(affinity) as avg FROM characters').get().avg || 0;
    
    return {
      characterCount,
      conversationCount,
      messageCount,
      avgAffinity: Math.round(avgAffinity)
    };
  }

  // 获取角色页面的统计数据
  getCharacterPageStatistics() {
    // 总计攻略对象
    const characterCount = this.db.prepare('SELECT COUNT(*) as count FROM characters').get().count;
    
    // 活跃对话：两天内创建的新对话
    const twoDaysAgo = Date.now() - (2 * 24 * 60 * 60 * 1000);
    const activeConversationCount = this.db.prepare(`
      SELECT COUNT(*) as count 
      FROM conversations 
      WHERE created_at >= ?
    `).get(twoDaysAgo).count;
    
    // 计算平均好感度
    const avgAffinity = this.db.prepare('SELECT AVG(affinity) as avg FROM characters').get().avg || 0;
    
    return {
      characterCount,
      activeConversationCount,
      avgAffinity: Math.round(avgAffinity)
    };
  }

  // 获取最近对话（带角色信息）
  getRecentConversations(limit = 10) {
    const stmt = this.db.prepare(`
      SELECT 
        c.*,
        char.name as character_name,
        char.avatar_color as character_avatar_color,
        char.id as character_id,
        COUNT(m.id) as message_count
      FROM conversations c
      INNER JOIN characters char ON c.character_id = char.id
      LEFT JOIN messages m ON c.id = m.conversation_id
      GROUP BY c.id
      ORDER BY c.updated_at DESC
      LIMIT ?
    `);

    return stmt.all(limit);
  }

  // 获取所有对话（带角色信息）
  getAllConversations() {
    const stmt = this.db.prepare(`
      SELECT
        c.*,
        char.name as character_name,
        char.avatar_color as character_avatar_color,
        char.id as character_id,
        COUNT(m.id) as message_count
      FROM conversations c
      INNER JOIN characters char ON c.character_id = char.id
      LEFT JOIN messages m ON c.id = m.conversation_id
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `);

    return stmt.all();
  }

  // 获取对话的消息
  getMessagesByConversation(conversationId) {
    const stmt = this.db.prepare(`
      SELECT * FROM messages
      WHERE conversation_id = ?
      ORDER BY timestamp ASC
    `);

    return stmt.all(conversationId);
  }

  // ========== AI分析相关方法 ==========

  // 获取对话的AI分析报告
  getConversationAnalysis(conversationId) {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM ai_analysis
        WHERE conversation_id = ? AND insight_type = 'analysis_report'
        ORDER BY created_at DESC
        LIMIT 1
      `);
      const result = stmt.get(conversationId);
      console.log(`[DB] getConversationAnalysis for ${conversationId}:`, result ? 'found' : 'not found');
      if (result) {
        console.log(`[DB] Analysis report content:`, result.content);
      }
      return result || null;
    } catch (error) {
      console.error('Error getting conversation analysis:', error);
      return null;
    }
  }

  // 获取对话的关键时刻回放
  getKeyMoments(conversationId) {
    try {
      const stmt = this.db.prepare(`
        SELECT 
          a.*,
          m.content as message_content,
          m.timestamp as message_timestamp,
          m.sender
        FROM ai_analysis a
        LEFT JOIN messages m ON a.message_id = m.id
        WHERE a.conversation_id = ? AND a.insight_type = 'key_moment'
        ORDER BY a.created_at ASC
      `);
      return stmt.all(conversationId) || [];
    } catch (error) {
      console.error('Error getting key moments:', error);
      return [];
    }
  }

  // 获取对话的行动建议
  getActionSuggestions(conversationId) {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM ai_suggestions
        WHERE conversation_id = ?
        ORDER BY created_at DESC
      `);
      return stmt.all(conversationId) || [];
    } catch (error) {
      console.error('Error getting action suggestions:', error);
      return [];
    }
  }

  // 获取对话的完整AI分析数据
  getConversationAIData(conversationId) {
    console.log(`[DB] Getting AI data for conversation: ${conversationId}`);
    
    // 获取分析报告
    const analysisReport = this.getConversationAnalysis(conversationId);
    console.log(`[DB] Analysis report found:`, analysisReport ? 'yes' : 'no');
    
    // 获取关键时刻
    const keyMoments = this.getKeyMoments(conversationId);
    console.log(`[DB] Key moments found: ${keyMoments.length}`);
    
    // 获取行动建议
    const actionSuggestions = this.getActionSuggestions(conversationId);
    console.log(`[DB] Action suggestions found: ${actionSuggestions.length}`);
    
    // 获取对话信息以获取角色ID
    const conversation = this.getConversationById(conversationId);
    
    // 获取本轮对话的表现态度分析（从ai_analysis表获取）
    let attitudeAnalysis = null;
    try {
      const attitudeStmt = this.db.prepare(`
        SELECT content FROM ai_analysis
        WHERE conversation_id = ? AND insight_type = 'attitude_analysis'
        ORDER BY created_at DESC
        LIMIT 1
      `);
      const attitudeData = attitudeStmt.get(conversationId);
      if (attitudeData && attitudeData.content) {
        // 如果content是JSON，解析它；否则直接使用
        try {
          const parsed = JSON.parse(attitudeData.content);
          const affinityChange = parsed.affinityChange || conversation?.affinity_change || 0;
          attitudeAnalysis = {
            description: parsed.description || parsed.content || attitudeData.content,
            affinityChange: affinityChange,
            trend: parsed.trend || (affinityChange > 0 ? '上升' : affinityChange < 0 ? '下降' : '持平')
          };
        } catch (e) {
          // 如果不是JSON，直接使用字符串，从conversation获取affinity_change
          const affinityChange = conversation?.affinity_change || 0;
          attitudeAnalysis = {
            description: attitudeData.content,
            affinityChange: affinityChange,
            trend: affinityChange > 0 ? '上升' : affinityChange < 0 ? '下降' : '持平'
          };
        }
      } else if (conversation) {
        // 如果没有专门的attitude_analysis，使用conversation的affinity_change作为基础
        const affinityChange = conversation.affinity_change || 0;
        attitudeAnalysis = {
          description: '本轮对话中，对方表现积极，互动良好。',
          affinityChange: affinityChange,
          trend: affinityChange > 0 ? '上升' : affinityChange < 0 ? '下降' : '持平'
        };
      }
    } catch (error) {
      console.error('Error getting attitude analysis:', error);
    }
    
    // 解析分析报告
    let parsedReport = null;
    if (analysisReport && analysisReport.content) {
      try {
        parsedReport = JSON.parse(analysisReport.content);
      } catch (e) {
        console.error('Failed to parse analysis report:', e);
      }
    }

    // 解析关键时刻评价
    const parsedKeyMoments = keyMoments.map(km => {
      let evaluation = null;
      if (km.content) {
        try {
          evaluation = JSON.parse(km.content);
        } catch (e) {
          evaluation = km.content; // 如果不是JSON，直接使用字符串
        }
      }
      return {
        id: km.id,
        timestamp: km.message_timestamp,
        messageContent: km.message_content,
        sender: km.sender,
        evaluation: evaluation
      };
    });

    const result = {
      analysisReport: parsedReport,
      keyMoments: parsedKeyMoments,
      attitudeAnalysis,
      actionSuggestions: actionSuggestions.map(as => ({
        id: as.id,
        title: as.title,
        content: as.content,
        tags: as.tags ? as.tags.split(',').map(t => t.trim()) : []
      }))
    };
    
    console.log(`[DB] Returning AI data:`, {
      hasAnalysisReport: !!result.analysisReport,
      keyMomentsCount: result.keyMoments.length,
      hasAttitudeAnalysis: !!result.attitudeAnalysis,
      actionSuggestionsCount: result.actionSuggestions.length
    });
    
    return result;
  }

  // ========== 角色详情相关方法 ==========

  // 获取角色详情
  getCharacterDetails(characterId) {
    try {
      const stmt = this.db.prepare('SELECT * FROM character_details WHERE character_id = ?');
      const row = stmt.get(characterId);
      
      if (!row) {
        // 如果没有详情记录，尝试从会话中生成
        return this.generateCharacterDetailsFromConversations(characterId);
      }

      // 解析JSON字段
      return {
        character_id: row.character_id,
        profile: row.profile ? JSON.parse(row.profile) : null,
        personality_traits: row.personality_traits ? JSON.parse(row.personality_traits) : null,
        likes_dislikes: row.likes_dislikes ? JSON.parse(row.likes_dislikes) : null,
        important_events: row.important_events ? JSON.parse(row.important_events) : null,
        conversation_summary: row.conversation_summary,
        custom_fields: row.custom_fields ? JSON.parse(row.custom_fields) : {},
        updated_at: row.updated_at
      };
    } catch (error) {
      console.error('Error getting character details:', error);
      return null;
    }
  }

  // 从会话中生成角色详情
  generateCharacterDetailsFromConversations(characterId) {
    try {
      // 获取角色的所有对话
      const conversations = this.getConversationsByCharacter(characterId);
      
      if (conversations.length === 0) {
        return {
          character_id: characterId,
          profile: null,
          personality_traits: null,
          likes_dislikes: null,
          important_events: null,
          conversation_summary: '暂无对话记录',
          custom_fields: {},
          updated_at: Date.now()
        };
      }

      // 收集所有消息
      const allMessages = [];
      const allSummaries = [];
      const allTags = [];
      const affinityChanges = [];

      for (const conv of conversations) {
        const messages = this.getMessagesByConversation(conv.id);
        allMessages.push(...messages);
        
        if (conv.summary) {
          allSummaries.push(conv.summary);
        }
        
        if (conv.tags) {
          allTags.push(...conv.tags.split(',').map(t => t.trim()));
        }
        
        if (conv.affinity_change) {
          affinityChanges.push(conv.affinity_change);
        }
      }

      // 提取角色消息（sender = 'character'）
      const characterMessages = allMessages
        .filter(msg => msg.sender === 'character')
        .map(msg => msg.content);

      // 生成性格特点（从消息中提取关键词和模式）
      const personalityTraits = this.extractPersonalityTraits(characterMessages, allTags);

      // 生成喜好厌恶（从消息中提取）
      const likesDislikes = this.extractLikesDislikes(characterMessages);

      // 生成重要事件（从对话标题和摘要中提取）
      const importantEvents = this.extractImportantEvents(conversations);

      // 生成对话总结
      const conversationSummary = this.generateConversationSummary(conversations, allSummaries, affinityChanges);

      // 生成角色档案（基本信息）
      const character = this.getCharacterById(characterId);
      const profile = character ? {
        name: character.name,
        nickname: character.nickname,
        relationship_label: character.relationship_label,
        affinity: character.affinity,
        tags: character.tags || [],
        created_at: character.created_at,
        notes: character.notes
      } : null;

      const details = {
        character_id: characterId,
        profile: profile,
        personality_traits: personalityTraits,
        likes_dislikes: likesDislikes,
        important_events: importantEvents,
        conversation_summary: conversationSummary,
        custom_fields: {},
        updated_at: Date.now()
      };

      // 保存到数据库
      this.saveCharacterDetails(characterId, details);

      return details;
    } catch (error) {
      console.error('Error generating character details:', error);
      return null;
    }
  }

  // 提取性格特点
  extractPersonalityTraits(messages, tags) {
    const traits = {
      keywords: [],
      descriptions: []
    };

    // 从标签中提取
    if (tags && tags.length > 0) {
      traits.keywords = [...new Set(tags)];
    }

    // 从消息中分析（简单关键词匹配）
    const traitKeywords = {
      '温柔': ['温柔', '体贴', '关心', '照顾'],
      '活泼': ['开心', '快乐', '兴奋', '活泼', '活跃'],
      '认真': ['认真', '负责', '仔细', '专注'],
      '内向': ['安静', '内向', '害羞', '沉默'],
      '外向': ['外向', '开朗', '健谈', '热情'],
      '幽默': ['有趣', '幽默', '搞笑', '玩笑'],
      '真诚': ['真诚', '诚实', '真实', '坦率']
    };

    const foundTraits = new Set();
    const messageText = messages.join(' ');

    for (const [trait, keywords] of Object.entries(traitKeywords)) {
      if (keywords.some(keyword => messageText.includes(keyword))) {
        foundTraits.add(trait);
      }
    }

    traits.keywords = [...new Set([...traits.keywords, ...foundTraits])];

    // 生成描述
    if (traits.keywords.length > 0) {
      traits.descriptions = [
        `从对话中可以看出，${traits.keywords.slice(0, 3).join('、')}是主要特点。`,
        `在互动中表现出${traits.keywords[0]}的一面。`
      ];
    }

    return traits;
  }

  // 提取喜好厌恶
  extractLikesDislikes(messages) {
    const likes = [];
    const dislikes = [];

    const messageText = messages.join(' ');

    // 简单的关键词匹配（实际应用中可以使用更复杂的NLP）
    const likeKeywords = ['喜欢', '爱好', '感兴趣', '爱', '享受', '享受', '享受'];
    const dislikeKeywords = ['不喜欢', '讨厌', '厌恶', '反感', '不感兴趣'];

    // 提取包含"喜欢"的句子片段
    const likePatterns = messageText.match(/喜欢[^，。！？]*/g) || [];
    likePatterns.forEach(pattern => {
      const cleaned = pattern.replace(/喜欢/g, '').trim();
      if (cleaned && cleaned.length < 20) {
        likes.push(cleaned);
      }
    });

    // 提取包含"不喜欢"的句子片段
    const dislikePatterns = messageText.match(/不(喜欢|感兴趣)[^，。！？]*/g) || [];
    dislikePatterns.forEach(pattern => {
      const cleaned = pattern.replace(/不(喜欢|感兴趣)/g, '').trim();
      if (cleaned && cleaned.length < 20) {
        dislikes.push(cleaned);
      }
    });

    return {
      likes: [...new Set(likes)].slice(0, 10), // 最多10个
      dislikes: [...new Set(dislikes)].slice(0, 10)
    };
  }

  // 提取重要事件
  extractImportantEvents(conversations) {
    const events = [];

    conversations.forEach(conv => {
      if (conv.title || conv.summary) {
        events.push({
          title: conv.title || '对话',
          summary: conv.summary || '',
          date: conv.date,
          affinity_change: conv.affinity_change || 0
        });
      }
    });

    // 按日期排序，最新的在前
    events.sort((a, b) => b.date - a.date);

    return events.slice(0, 10); // 最多10个重要事件
  }

  // 生成对话总结
  generateConversationSummary(conversations, summaries, affinityChanges) {
    const totalConversations = conversations.length;
    const totalAffinityChange = affinityChanges.reduce((sum, change) => sum + change, 0);
    const avgAffinityChange = affinityChanges.length > 0 
      ? Math.round(totalAffinityChange / affinityChanges.length) 
      : 0;

    let summary = `共进行了 ${totalConversations} 次对话。`;

    if (summaries.length > 0) {
      summary += `主要话题包括：${summaries.slice(0, 3).join('、')}。`;
    }

    if (totalAffinityChange !== 0) {
      const trend = totalAffinityChange > 0 ? '上升' : '下降';
      summary += `好感度总体${trend}了 ${Math.abs(totalAffinityChange)} 点。`;
    }

    return summary;
  }

  // 保存角色详情
  saveCharacterDetails(characterId, details) {
    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO character_details 
        (character_id, profile, personality_traits, likes_dislikes, important_events, conversation_summary, custom_fields, updated_at)
        VALUES (@character_id, @profile, @personality_traits, @likes_dislikes, @important_events, @conversation_summary, @custom_fields, @updated_at)
      `);

      stmt.run({
        character_id: characterId,
        profile: details.profile ? JSON.stringify(details.profile) : null,
        personality_traits: details.personality_traits ? JSON.stringify(details.personality_traits) : null,
        likes_dislikes: details.likes_dislikes ? JSON.stringify(details.likes_dislikes) : null,
        important_events: details.important_events ? JSON.stringify(details.important_events) : null,
        conversation_summary: details.conversation_summary || null,
        custom_fields: details.custom_fields ? JSON.stringify(details.custom_fields) : '{}',
        updated_at: details.updated_at || Date.now()
      });

      return true;
    } catch (error) {
      console.error('Error saving character details:', error);
      return false;
    }
  }

  // 更新角色详情的自定义字段
  updateCharacterDetailsCustomFields(characterId, customFields) {
    try {
      const currentDetails = this.getCharacterDetails(characterId);
      if (!currentDetails) {
        return false;
      }

      const updatedCustomFields = {
        ...(currentDetails.custom_fields || {}),
        ...customFields
      };

      const stmt = this.db.prepare(`
        UPDATE character_details 
        SET custom_fields = @custom_fields, updated_at = @updated_at
        WHERE character_id = @character_id
      `);

      stmt.run({
        character_id: characterId,
        custom_fields: JSON.stringify(updatedCustomFields),
        updated_at: Date.now()
      });

      return true;
    } catch (error) {
      console.error('Error updating custom fields:', error);
      return false;
    }
  }

  // ========== 工具方法 ==========

  // 生成ID
  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  // 批量插入示例数据（从SQL文件加载）
  seedSampleData() {
    console.log('Seeding sample data...');

    // 检查对话数据是否存在
    const conversationCount = this.db.prepare('SELECT COUNT(*) as count FROM conversations').get().count;
    const characterCount = this.db.prepare('SELECT COUNT(*) as count FROM characters').get().count;
    const aiAnalysisCount = this.db.prepare('SELECT COUNT(*) as count FROM ai_analysis').get().count;
    
    console.log(`Current database state: ${characterCount} characters, ${conversationCount} conversations, ${aiAnalysisCount} AI analyses`);
    
    // 如果对话数据已存在，检查是否需要插入AI分析数据
    if (conversationCount > 0) {
      // 如果AI分析数据不存在，只插入AI分析相关的数据
      if (aiAnalysisCount === 0) {
        console.log('Conversation data exists but AI analysis data missing, inserting AI analysis data only...');
        this.seedAIDataOnly();
      } else {
        console.log(`Conversation data already exists (${aiAnalysisCount} AI analyses found), skipping seed...`);
        // 即使有数据，也检查一下是否有分析报告数据
        const reportCount = this.db.prepare('SELECT COUNT(*) as count FROM ai_analysis WHERE insight_type = ?').get('analysis_report').count;
        console.log(`Found ${reportCount} analysis reports in database`);
      }
      return;
    }
    
    // 如果没有角色数据，需要先插入角色
    if (characterCount === 0) {
      console.log('No characters found, will insert all data including characters');
    } else {
      console.log('Characters exist, will only insert conversations and messages');
    }

    // 如果角色数据不存在，需要先插入角色数据
    const needCharacters = characterCount === 0;

    try {
      // 读取并执行SQL种子文件
      const seedPath = path.join(__dirname, 'seed.sql');
      if (fs.existsSync(seedPath)) {
        const seedSQL = fs.readFileSync(seedPath, 'utf-8');
        
        // 改进SQL语句分割：先移除注释行，然后按分号分割
        const lines = seedSQL.split('\n');
        let cleanedLines = [];
        let inMultiLineStatement = false;
        let currentStatement = '';
        
        for (let i = 0; i < lines.length; i++) {
          let line = lines[i].trim();
          
          // 跳过空行和纯注释行
          if (!line || line.startsWith('--')) {
            continue;
          }
          
          // 移除行内注释（-- 后面的内容）
          const commentIndex = line.indexOf('--');
          if (commentIndex >= 0) {
            line = line.substring(0, commentIndex).trim();
            if (!line) continue;
          }
          
          // 累积到当前语句
          currentStatement += (currentStatement ? ' ' : '') + line;
          
          // 如果行以分号结尾，说明语句完整
          if (line.endsWith(';')) {
            const statement = currentStatement.slice(0, -1).trim(); // 移除末尾的分号
            if (statement) {
              cleanedLines.push(statement);
            }
            currentStatement = '';
          }
        }
        
        // 处理最后可能没有分号的语句
        if (currentStatement.trim()) {
          cleanedLines.push(currentStatement.trim());
        }
        
        console.log(`Found ${cleanedLines.length} SQL statements to execute`);
        
        const transaction = this.db.transaction(() => {
          for (let i = 0; i < cleanedLines.length; i++) {
            const statement = cleanedLines[i];
            
            // 如果角色数据已存在，跳过角色相关的INSERT语句
            if (!needCharacters && statement.toUpperCase().includes('INSERT') && 
                (statement.includes('INSERT INTO characters') || 
                 statement.includes('INSERT INTO tags') || 
                 statement.includes('INSERT INTO character_tags'))) {
              console.log(`Skipping statement ${i + 1}: character data (already exists)`);
              continue;
            }
            
            try {
              // 执行SQL语句（添加分号）
              this.db.exec(statement + ';');
              if (statement.includes('INSERT INTO conversations')) {
                console.log(`✓ Executed conversation INSERT statement ${i + 1}`);
              }
            } catch (err) {
              // 忽略重复插入的错误（INSERT OR IGNORE 会处理）
              if (err.message.includes('UNIQUE constraint') || err.message.includes('already exists')) {
                console.log(`Statement ${i + 1}: skipped (duplicate)`);
              } else {
                console.error(`Error executing statement ${i + 1}:`, err.message);
                console.error('Statement preview:', statement.substring(0, 150) + '...');
                // 继续执行其他语句，不中断
              }
            }
          }
        });
        
        transaction();
        console.log('Sample data seeded successfully from SQL file');
        
        // 验证数据插入
        const finalConvCount = this.db.prepare('SELECT COUNT(*) as count FROM conversations').get().count;
        const finalMsgCount = this.db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
        const finalCharCount = this.db.prepare('SELECT COUNT(*) as count FROM characters').get().count;
        console.log(`Data verification: ${finalCharCount} characters, ${finalConvCount} conversations, ${finalMsgCount} messages`);
        
        if (finalConvCount === 0) {
          console.warn('⚠️  Warning: No conversations were inserted!');
          console.warn('This might indicate a SQL parsing or execution issue.');
        } else {
          console.log('✅ Data seeding completed successfully');
        }
      } else {
        console.warn('Seed SQL file not found, skipping data seeding');
      }
    } catch (error) {
      console.error('Error seeding sample data:', error);
      console.error(error.stack);
      // 不抛出错误，允许应用继续运行
    }
  }

  // ========== LLM配置相关方法 ==========

  // 创建或更新LLM配置
  saveLLMConfig(configData) {
    const now = Date.now();
    
    // 如果设置为默认配置，先取消其他默认配置
    if (configData.is_default) {
      const clearDefaultStmt = this.db.prepare('UPDATE llm_configs SET is_default = 0 WHERE is_default = 1');
      clearDefaultStmt.run();
    }

    // 检查是否已存在（通过id或name）
    const existingStmt = this.db.prepare('SELECT * FROM llm_configs WHERE id = ? OR name = ?');
    const existing = existingStmt.get(configData.id || '', configData.name || '');

    if (existing) {
      // 更新现有配置
      const updateStmt = this.db.prepare(`
        UPDATE llm_configs
        SET name = @name,
            provider = @provider,
            api_key = @api_key,
            base_url = @base_url,
            is_default = @is_default,
            updated_at = @updated_at
        WHERE id = @id
      `);

      updateStmt.run({
        id: existing.id,
        name: configData.name || existing.name,
        provider: configData.provider || existing.provider || 'openai',
        api_key: configData.api_key || existing.api_key,
        base_url: configData.base_url !== undefined ? configData.base_url : existing.base_url,
        is_default: configData.is_default !== undefined ? (configData.is_default ? 1 : 0) : existing.is_default,
        updated_at: now
      });

      return this.getLLMConfigById(existing.id);
    } else {
      // 创建新配置
      const insertStmt = this.db.prepare(`
        INSERT INTO llm_configs (id, name, provider, api_key, base_url, is_default, created_at, updated_at)
        VALUES (@id, @name, @provider, @api_key, @base_url, @is_default, @created_at, @updated_at)
      `);

      const id = configData.id || this.generateId();
      insertStmt.run({
        id,
        name: configData.name || '默认配置',
        provider: configData.provider || 'openai',
        api_key: configData.api_key,
        base_url: configData.base_url || null,
        is_default: configData.is_default ? 1 : 0,
        created_at: now,
        updated_at: now
      });

      return this.getLLMConfigById(id);
    }
  }

  // 获取所有LLM配置
  getAllLLMConfigs() {
    const stmt = this.db.prepare('SELECT * FROM llm_configs ORDER BY is_default DESC, updated_at DESC');
    return stmt.all();
  }

  // 获取默认LLM配置
  getDefaultLLMConfig() {
    const stmt = this.db.prepare('SELECT * FROM llm_configs WHERE is_default = 1 LIMIT 1');
    return stmt.get();
  }

  // 根据ID获取LLM配置
  getLLMConfigById(id) {
    const stmt = this.db.prepare('SELECT * FROM llm_configs WHERE id = ?');
    return stmt.get(id);
  }

  // 删除LLM配置
  deleteLLMConfig(id) {
    const stmt = this.db.prepare('DELETE FROM llm_configs WHERE id = ?');
    return stmt.run(id);
  }

  // 设置默认LLM配置
  setDefaultLLMConfig(id) {
    // 先取消所有默认配置
    const clearDefaultStmt = this.db.prepare('UPDATE llm_configs SET is_default = 0 WHERE is_default = 1');
    clearDefaultStmt.run();

    // 设置新的默认配置
    const setDefaultStmt = this.db.prepare('UPDATE llm_configs SET is_default = 1, updated_at = ? WHERE id = ?');
    setDefaultStmt.run(Date.now(), id);

    return this.getLLMConfigById(id);
  }

  // 测试LLM连接（ping）
  async testLLMConnection(configData) {
    try {
      // 动态导入openai（因为它是可选依赖）
      const OpenAI = require('openai');
      
      const config = {
        apiKey: configData.api_key,
      };

      // 如果提供了base_url，使用自定义URL
      if (configData.base_url) {
        config.baseURL = configData.base_url;
      }

      const client = new OpenAI(config);

      // 使用models.list()来测试连接（这是一个轻量级的API调用）
      await client.models.list();

      return { success: true, message: '连接成功' };
    } catch (error) {
      console.error('LLM connection test failed:', error);
      
      // 提供更友好的错误信息
      let errorMessage = '连接失败';
      if (error.status === 401) {
        errorMessage = 'API密钥无效';
      } else if (error.status === 404) {
        errorMessage = 'API端点不存在';
      } else if (error.message) {
        errorMessage = error.message;
      }

      return { success: false, message: errorMessage, error: error.message };
    }
  }

  // 只插入AI分析数据（当对话数据已存在但AI分析数据缺失时）
  seedAIDataOnly() {
    console.log('Seeding AI analysis data only...');
    
    try {
      const seedPath = path.join(__dirname, 'seed.sql');
      if (!fs.existsSync(seedPath)) {
        console.warn('Seed SQL file not found, skipping AI data seeding');
        return;
      }

      const seedSQL = fs.readFileSync(seedPath, 'utf-8');
      const lines = seedSQL.split('\n');
      let cleanedLines = [];
      let currentStatement = '';
      
      for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        const originalLine = line;
        
        // 跳过空行
        if (!line.trim()) {
          continue;
        }
        
        // 跳过纯注释行（整行都是注释）
        // 但如果currentStatement已经有内容，说明这是多行语句中的注释，应该跳过但不清空currentStatement
        if (line.trim().startsWith('--')) {
          continue; // 跳过注释行，但保留currentStatement
        }
        
        // 移除行内注释（但保留SQL代码）
        const commentIndex = line.indexOf('--');
        if (commentIndex >= 0) {
          // 检查--是否在字符串内（简单检查）
          const beforeComment = line.substring(0, commentIndex);
          const singleQuotes = (beforeComment.match(/'/g) || []).length;
          // 如果单引号数量是偶数，说明--不在字符串内，可以移除注释
          if (singleQuotes % 2 === 0) {
            line = line.substring(0, commentIndex).trim();
            if (!line) continue;
          }
        }
        
        line = line.trim();
        if (!line) continue;
        
        // 累积到当前语句
        if (currentStatement) {
          currentStatement += ' ' + line;
        } else {
          currentStatement = line;
        }
        
        // 如果行以分号结尾，说明语句完整
        if (line.endsWith(';')) {
          const statement = currentStatement.slice(0, -1).trim(); // 移除末尾的分号
          if (statement) {
            // 只处理AI分析相关的INSERT语句
            const upperStatement = statement.toUpperCase();
            const isAIAnalysis = upperStatement.includes('INSERT') && upperStatement.includes('AI_ANALYSIS');
            const isAISuggestions = upperStatement.includes('INSERT') && upperStatement.includes('AI_SUGGESTIONS');
            
            if (isAIAnalysis || isAISuggestions) {
              cleanedLines.push(statement);
              console.log(`[SQL Parser] Found AI statement (line ${i+1}): ${statement.substring(0, 150)}...`);
            }
          }
          currentStatement = '';
        }
      }
      
      if (currentStatement.trim()) {
        const statement = currentStatement.trim();
        const upperStatement = statement.toUpperCase();
        if (upperStatement.includes('INSERT') && 
            (upperStatement.includes('INSERT INTO AI_ANALYSIS') || 
             upperStatement.includes('INSERT INTO AI_SUGGESTIONS'))) {
          cleanedLines.push(statement);
          console.log(`[SQL Parser] Found AI statement (final): ${statement.substring(0, 100)}...`);
        }
      }
      
      console.log(`Found ${cleanedLines.length} AI-related SQL statements to execute`);
      
      // 如果没找到，打印一些调试信息
      if (cleanedLines.length === 0) {
        console.log('[SQL Parser] Debug: Checking seed.sql content...');
        const seedSQL = fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf-8');
        const hasAIAnalysis = seedSQL.includes('INSERT') && seedSQL.includes('ai_analysis');
        const hasAISuggestions = seedSQL.includes('INSERT') && seedSQL.includes('ai_suggestions');
        console.log(`[SQL Parser] seed.sql contains ai_analysis: ${hasAIAnalysis}, ai_suggestions: ${hasAISuggestions}`);
        
        // 尝试直接查找包含ai_analysis的行
        const lines = seedSQL.split('\n');
        let aiAnalysisLines = 0;
        let aiSuggestionLines = 0;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes('ai_analysis')) aiAnalysisLines++;
          if (lines[i].includes('ai_suggestions')) aiSuggestionLines++;
        }
        console.log(`[SQL Parser] Lines containing ai_analysis: ${aiAnalysisLines}, ai_suggestions: ${aiSuggestionLines}`);
      }
      
      if (cleanedLines.length === 0) {
        console.log('No AI analysis data found in seed file');
        return;
      }
      
      // 打印前几个语句用于调试
      if (cleanedLines.length > 0) {
        console.log('First statement preview:', cleanedLines[0].substring(0, 200) + '...');
      }
      
      const transaction = this.db.transaction(() => {
        let successCount = 0;
        let errorCount = 0;
        for (let i = 0; i < cleanedLines.length; i++) {
          const statement = cleanedLines[i];
          try {
            this.db.exec(statement + ';');
            successCount++;
            if (statement.includes('INSERT INTO ai_analysis')) {
              console.log(`✓ Executed AI analysis INSERT statement ${i + 1}/${cleanedLines.length}`);
            } else if (statement.includes('INSERT INTO ai_suggestions')) {
              console.log(`✓ Executed AI suggestion INSERT statement ${i + 1}/${cleanedLines.length}`);
            }
          } catch (err) {
            errorCount++;
            if (err.message.includes('UNIQUE constraint') || err.message.includes('already exists')) {
              console.log(`Statement ${i + 1}: skipped (duplicate)`);
            } else {
              console.error(`Error executing AI statement ${i + 1}:`, err.message);
              console.error('Statement preview:', statement.substring(0, 200) + '...');
            }
          }
        }
        console.log(`AI data insertion summary: ${successCount} succeeded, ${errorCount} errors`);
      });
      
      transaction();
      
      // 验证数据插入
      const finalAICount = this.db.prepare('SELECT COUNT(*) as count FROM ai_analysis').get().count;
      const finalSuggestionCount = this.db.prepare('SELECT COUNT(*) as count FROM ai_suggestions').get().count;
      console.log(`AI data verification: ${finalAICount} AI analyses, ${finalSuggestionCount} AI suggestions`);
      console.log('✅ AI analysis data seeding completed successfully');
      
    } catch (error) {
      console.error('Error seeding AI analysis data:', error);
      console.error(error.stack);
    }
  }
}

module.exports = DatabaseManager;
