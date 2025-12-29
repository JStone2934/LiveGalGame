export default function SuggestionConfigManager(BaseClass) {
  return class extends BaseClass {
    ensureSuggestionSchema() {
      if (this._suggestionSchemaEnsured) return;

      const columns = this.db.prepare('PRAGMA table_info(suggestion_configs)').all();
      const names = columns.map((c) => c.name);

      const ensureColumn = (name, sql) => {
        if (!names.includes(name)) {
          this.db.prepare(sql).run();
        }
      };

      ensureColumn('topic_detection_enabled', 'ALTER TABLE suggestion_configs ADD COLUMN topic_detection_enabled INTEGER DEFAULT 0');
      ensureColumn('model_name', "ALTER TABLE suggestion_configs ADD COLUMN model_name TEXT DEFAULT 'gpt-4o-mini'");
      ensureColumn('situation_llm_enabled', 'ALTER TABLE suggestion_configs ADD COLUMN situation_llm_enabled INTEGER DEFAULT 0');
      ensureColumn('situation_model_name', "ALTER TABLE suggestion_configs ADD COLUMN situation_model_name TEXT DEFAULT 'gpt-4o-mini'");
      ensureColumn('thinking_enabled', 'ALTER TABLE suggestion_configs ADD COLUMN thinking_enabled INTEGER DEFAULT 0');
      ensureColumn('user_profile', 'ALTER TABLE suggestion_configs ADD COLUMN user_profile TEXT DEFAULT NULL');

      // 补齐已有行的默认值
      this.db
        .prepare(
          "UPDATE suggestion_configs SET topic_detection_enabled = COALESCE(topic_detection_enabled, 0), model_name = COALESCE(NULLIF(TRIM(model_name), ''), 'gpt-4o-mini'), situation_llm_enabled = COALESCE(situation_llm_enabled, 0), situation_model_name = COALESCE(NULLIF(TRIM(situation_model_name), ''), 'gpt-4o-mini'), thinking_enabled = COALESCE(thinking_enabled, 0)"
        )
        .run();

      this._suggestionSchemaEnsured = true;
    }

    // 初始化默认建议配置
    seedDefaultSuggestionConfig() {
      this.ensureSuggestionSchema();
      const existing = this.db.prepare('SELECT COUNT(*) as count FROM suggestion_configs').get().count;
      if (existing > 0) {
        return;
      }

      const now = Date.now();
      const stmt = this.db.prepare(`
        INSERT INTO suggestion_configs (
          id,
          enable_passive_suggestion,
          suggestion_count,
          silence_threshold_seconds,
          message_threshold_count,
          cooldown_seconds,
          context_message_limit,
          topic_detection_enabled,
          situation_llm_enabled,
          model_name,
          situation_model_name,
          thinking_enabled,
          created_at,
          updated_at
        ) VALUES (
          @id,
          @enable_passive_suggestion,
          @suggestion_count,
          @silence_threshold_seconds,
          @message_threshold_count,
        @cooldown_seconds,
          @context_message_limit,
          @topic_detection_enabled,
          @situation_llm_enabled,
          @model_name,
          @situation_model_name,
          @thinking_enabled,
          @created_at,
          @updated_at
        )
      `);

      stmt.run({
        id: 'default',
        enable_passive_suggestion: 1,
        suggestion_count: 3,
        silence_threshold_seconds: 3,
        message_threshold_count: 3,
        cooldown_seconds: 15,
        context_message_limit: 20,
        topic_detection_enabled: 0,
        situation_llm_enabled: 0,
        model_name: 'gpt-4o-mini',
        situation_model_name: 'gpt-4o-mini',
        thinking_enabled: 0,
        created_at: now,
        updated_at: now
      });
    }

    // 获取建议配置
    getSuggestionConfig() {
      this.ensureSuggestionSchema();
      let config = this.db.prepare('SELECT * FROM suggestion_configs ORDER BY updated_at DESC LIMIT 1').get();
      if (!config) {
        this.seedDefaultSuggestionConfig();
        config = this.db.prepare('SELECT * FROM suggestion_configs ORDER BY updated_at DESC LIMIT 1').get();
      }
      return config;
    }

    // 更新建议配置
    updateSuggestionConfig(updates) {
      this.ensureSuggestionSchema();
      const current = this.getSuggestionConfig();
      if (!current) {
        throw new Error('Suggestion config not found');
      }

      const fields = [];
      const params = { id: current.id, updated_at: Date.now() };

      const updatableFields = [
        'enable_passive_suggestion',
        'suggestion_count',
        'silence_threshold_seconds',
        'message_threshold_count',
        'cooldown_seconds',
        'context_message_limit',
        'topic_detection_enabled',
        'model_name',
        'thinking_enabled',
        'user_profile'
      ];

      updatableFields.forEach((field) => {
        if (updates[field] !== undefined && updates[field] !== null) {
          fields.push(`${field} = @${field}`);
          params[field] = updates[field];
        }
      });

      if (fields.length === 0) {
        return current;
      }

      const stmt = this.db.prepare(`
        UPDATE suggestion_configs
        SET ${fields.join(', ')}, updated_at = @updated_at
        WHERE id = @id
      `);

      stmt.run(params);
      return this.getSuggestionConfig();
    }
  };
}
