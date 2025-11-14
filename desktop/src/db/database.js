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
      ORDER BY c.updated_at DESC
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
      ORDER BY c.updated_at DESC
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
    
    console.log(`Current database state: ${characterCount} characters, ${conversationCount} conversations`);
    
    // 如果对话数据已存在，跳过
    if (conversationCount > 0) {
      console.log('Conversation data already exists, skipping seed...');
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
}

module.exports = DatabaseManager;
