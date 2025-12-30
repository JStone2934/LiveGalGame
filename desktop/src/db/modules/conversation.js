export default function ConversationManager(BaseClass) {
  return class extends BaseClass {
    // 创建对话
  createConversation(conversationData) {
    // 统一使用写入时的主键值，避免 TEXT 主键返回 rowid 导致二次查询为空
    const id = conversationData.id || this.generateId();
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO conversations (id, character_id, title, date, affinity_change, summary, tags, created_at, updated_at)
      VALUES (@id, @character_id, @title, @date, @affinity_change, @summary, @tags, @created_at, @updated_at)
    `);

    const info = stmt.run({
      id,
      character_id: conversationData.character_id,
      title: conversationData.title || null,
      date: conversationData.date || now,
      affinity_change: conversationData.affinity_change || 0,
      summary: conversationData.summary || null,
      tags: conversationData.tags || null,
      created_at: now,
      updated_at: now
    });

    if (info.changes === 0) {
      return this.getConversationById(id);
    }

    return this.getConversationById(id);
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

	  // 更新对话
	  updateConversation(id, updates) {
	    const allowedFields = new Set([
	      'character_id',
	      'title',
	      'date',
	      'affinity_change',
	      'summary',
	      'tags'
	    ]);
	    const fields = [];
	    const values = { id };

	    for (const [key, value] of Object.entries(updates)) {
	      if (allowedFields.has(key)) {
	        fields.push(`${key} = @${key}`);
	        values[key] = value;
	      }
	    }

	    if (fields.length === 0) {
	      return this.getConversationById(id);
	    }

	    fields.push('updated_at = @updated_at');
	    values.updated_at = Date.now();

	    const stmt = this.db.prepare(`
	      UPDATE conversations
      SET ${fields.join(', ')}
      WHERE id = @id
    `);

    stmt.run(values);
    return this.getConversationById(id);
  }

  // 删除对话（级联删除相关消息、AI分析、AI建议）
  deleteConversation(conversationId) {
    const stmt = this.db.prepare('DELETE FROM conversations WHERE id = ?');
    const info = stmt.run(conversationId);
    return info.changes > 0;
  }

  // 获取对话总数
  getConversationCount() {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM conversations');
    return stmt.get().count;
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
  };
}
