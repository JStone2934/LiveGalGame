export default function CharacterManager(BaseClass) {
  return class extends BaseClass {
    // 创建角色
    createCharacter(characterData) {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO characters (id, name, nickname, relationship_label, avatar_color, affinity, created_at, updated_at, notes)
      VALUES (@id, @name, @nickname, @relationship_label, @avatar_color, @affinity, @created_at, @updated_at, @notes)
    `);

    // 在 TEXT 主键表上 lastInsertRowid 不可用于取回 ID，必须使用实际写入的 id
    const id = characterData.id || this.generateId();
    const info = stmt.run({
      id,
      name: characterData.name,
      nickname: characterData.nickname || null,
      relationship_label: characterData.relationship_label || null,
      avatar_color: characterData.avatar_color || '#ff6b6b',
      // 允许合法的 0 值，不要用 || 覆盖
      affinity: characterData.affinity ?? 50,
      created_at: Date.now(),
      updated_at: Date.now(),
      notes: characterData.notes || null
    });

    // 如果因主键重复未插入，直接返回已有记录避免抛错
    if (info.changes === 0) {
      return this.getCharacterById(id);
    }

    return this.getCharacterById(id);
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
	    const allowedFields = new Set([
	      'name',
	      'nickname',
	      'relationship_label',
	      'avatar_color',
	      'affinity',
	      'notes'
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
	      return this.getCharacterById(id);
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

  // 删除角色（级联删除相关对话、消息、标签关联、角色详情）
  deleteCharacter(characterId) {
    const stmt = this.db.prepare('DELETE FROM characters WHERE id = ?');
    const info = stmt.run(characterId);
    return info.changes > 0;
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
  };
}
