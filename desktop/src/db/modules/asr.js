import fs from 'fs';

export default function ASRManager(BaseClass) {
  return class extends BaseClass {
    // 获取所有音频源配置
    getAudioSources() {
      const stmt = this.db.prepare('SELECT * FROM audio_sources ORDER BY created_at ASC');
      return stmt.all();
    }

    // 获取单个音频源配置
    getAudioSourceById(id) {
      const stmt = this.db.prepare('SELECT * FROM audio_sources WHERE id = ?');
      return stmt.get(id);
    }

    // 创建音频源配置
    createAudioSource(sourceData) {
      const stmt = this.db.prepare(`
      INSERT INTO audio_sources (id, name, is_active, device_id, device_name, created_at, updated_at)
      VALUES (@id, @name, @is_active, @device_id, @device_name, @created_at, @updated_at)
    `);

      const id = sourceData.id || this.generateId();

      stmt.run({
        id,
        name: sourceData.name,
        is_active: sourceData.is_active !== undefined ? sourceData.is_active : 0,
        device_id: sourceData.device_id || null,
        device_name: sourceData.device_name || null,
        created_at: Date.now(),
        updated_at: Date.now()
      });

      return this.getAudioSourceById(id);
    }

    // 更新音频源配置
    updateAudioSource(id, updates) {
      const fields = [];
      const values = { id };

      if (updates.name !== undefined) {
        fields.push('name = @name');
        values.name = updates.name;
      }
      if (updates.is_active !== undefined) {
        fields.push('is_active = @is_active');
        values.is_active = updates.is_active;
      }
      if (updates.device_id !== undefined) {
        fields.push('device_id = @device_id');
        values.device_id = updates.device_id;
      }
      if (updates.device_name !== undefined) {
        fields.push('device_name = @device_name');
        values.device_name = updates.device_name;
      }

      fields.push('updated_at = @updated_at');
      values.updated_at = Date.now();

      const stmt = this.db.prepare(`
      UPDATE audio_sources
      SET ${fields.join(', ')}
      WHERE id = @id
    `);

      const info = stmt.run(values);
      return info.changes > 0 ? this.getAudioSourceById(id) : null;
    }

    // 获取所有 ASR 配置
    getASRConfigs() {
      const stmt = this.db.prepare('SELECT * FROM asr_configs ORDER BY created_at ASC');
      return stmt.all();
    }

    // 获取默认 ASR 配置
    getDefaultASRConfig() {
      const stmt = this.db.prepare('SELECT * FROM asr_configs WHERE is_default = 1 LIMIT 1');
      return stmt.get();
    }

    // 获取指定 ASR 配置
    getASRConfigById(id) {
      const stmt = this.db.prepare('SELECT * FROM asr_configs WHERE id = ?');
      return stmt.get(id);
    }

    // 创建 ASR 配置
    createASRConfig(configData) {
      const stmt = this.db.prepare(`
      INSERT INTO asr_configs (
        id, model_name, language, enable_vad, sentence_pause_threshold,
        retain_audio_files, audio_retention_days, audio_storage_path,
        is_default, created_at, updated_at
      )
      VALUES (
        @id, @model_name, @language, @enable_vad, @sentence_pause_threshold,
        @retain_audio_files, @audio_retention_days, @audio_storage_path,
        @is_default, @created_at, @updated_at
      )
    `);

      const id = configData.id || this.generateId();

      stmt.run({
        id,
        model_name: configData.model_name || 'whisper-base',
        language: configData.language || 'zh',
        enable_vad: configData.enable_vad !== undefined ? configData.enable_vad : 1,
        sentence_pause_threshold: configData.sentence_pause_threshold || 1.0,
        retain_audio_files: configData.retain_audio_files !== undefined ? configData.retain_audio_files : 0,
        audio_retention_days: configData.audio_retention_days || 30,
        audio_storage_path: configData.audio_storage_path || null,
        is_default: configData.is_default !== undefined ? configData.is_default : 0,
        created_at: Date.now(),
        updated_at: Date.now()
      });

      return this.getASRConfigById(id);
    }

    // 更新 ASR 配置
    updateASRConfig(id, updates) {
      const fields = [];
      const values = { id };

      if (updates.model_name !== undefined) {
        fields.push('model_name = @model_name');
        values.model_name = updates.model_name;
      }
      if (updates.language !== undefined) {
        fields.push('language = @language');
        values.language = updates.language;
      }
      if (updates.enable_vad !== undefined) {
        fields.push('enable_vad = @enable_vad');
        values.enable_vad = updates.enable_vad;
      }
      if (updates.sentence_pause_threshold !== undefined) {
        fields.push('sentence_pause_threshold = @sentence_pause_threshold');
        values.sentence_pause_threshold = updates.sentence_pause_threshold;
      }
      if (updates.retain_audio_files !== undefined) {
        fields.push('retain_audio_files = @retain_audio_files');
        values.retain_audio_files = updates.retain_audio_files;
      }
      if (updates.audio_retention_days !== undefined) {
        fields.push('audio_retention_days = @audio_retention_days');
        values.audio_retention_days = updates.audio_retention_days;
      }
      if (updates.audio_storage_path !== undefined) {
        fields.push('audio_storage_path = @audio_storage_path');
        values.audio_storage_path = updates.audio_storage_path;
      }

      fields.push('updated_at = @updated_at');
      values.updated_at = Date.now();

      const stmt = this.db.prepare(`
      UPDATE asr_configs
      SET ${fields.join(', ')}
      WHERE id = @id
    `);

      const info = stmt.run(values);
      return info.changes > 0 ? this.getASRConfigById(id) : null;
    }

    // 设置默认 ASR 配置
    setDefaultASRConfig(id) {
      const transaction = this.db.transaction(() => {
        // 先将所有配置设为非默认
        this.db.prepare('UPDATE asr_configs SET is_default = 0').run();
        // 然后设置指定配置为默认
        const stmt = this.db.prepare('UPDATE asr_configs SET is_default = 1 WHERE id = ?');
        return stmt.run(id);
      });

      const info = transaction();
      return info.changes > 0;
    }

    // 删除 ASR 配置（保证至少保留一个配置；若删除的是默认配置，会自动选一个新的默认）
    deleteASRConfig(id) {
      const transaction = this.db.transaction(() => {
        const existing = this.getASRConfigById(id);
        if (!existing) {
          return { ok: false, deleted: false, message: '配置不存在' };
        }

        const total = this.db.prepare('SELECT COUNT(*) as count FROM asr_configs').get().count;
        if (total <= 1) {
          return { ok: false, deleted: false, message: '至少需要保留一个 ASR 配置' };
        }

        const wasDefault = existing.is_default === 1;
        const deleteStmt = this.db.prepare('DELETE FROM asr_configs WHERE id = ?');
        const info = deleteStmt.run(id);

        let newDefaultId = null;
        if (wasDefault) {
          // 选一个最近更新的配置作为新的默认
          const candidate = this.db
            .prepare('SELECT id FROM asr_configs ORDER BY updated_at DESC, created_at DESC LIMIT 1')
            .get();
          if (candidate?.id) {
            this.db.prepare('UPDATE asr_configs SET is_default = 0').run();
            this.db
              .prepare('UPDATE asr_configs SET is_default = 1, updated_at = ? WHERE id = ?')
              .run(Date.now(), candidate.id);
            newDefaultId = candidate.id;
          }
        }

        return {
          ok: true,
          deleted: info.changes > 0,
          changes: info.changes,
          newDefaultId,
        };
      });

      return transaction();
    }

    // 保存语音识别记录
    saveSpeechRecord(recordData) {
      // 验证外键约束：检查对话是否存在
      if (recordData.conversation_id) {
        const conversation = this.getConversationById(recordData.conversation_id);
        if (!conversation) {
          throw new Error(`Conversation not found: ${recordData.conversation_id}. Cannot save speech record.`);
        }
      } else {
        throw new Error('conversation_id is required for speech record');
      }

      // 验证外键约束：检查音频源是否存在，如果不存在则自动创建
      let audioSource = this.getAudioSourceById(recordData.source_id);
      if (!audioSource) {
        console.warn(`Audio source not found: ${recordData.source_id}, creating it automatically...`);
        // 自动创建音频源
        audioSource = this.createAudioSource({
          id: recordData.source_id,
          name: recordData.source_id === 'speaker1' ? 'Speaker 1' : recordData.source_id === 'speaker2' ? 'Speaker 2' : `Audio Source ${recordData.source_id}`,
          is_active: 1,
          device_id: null,
          device_name: null
        });
        console.log(`Auto-created audio source: ${recordData.source_id}`);
      }

      // 生成或使用提供的ID
      const recordId = recordData.id || this.generateId();

      const stmt = this.db.prepare(`
      INSERT INTO speech_recognition_records (
        id, conversation_id, source_id, message_id,
        audio_data, audio_file_path, audio_duration,
        recognized_text, confidence, start_time, end_time,
        status, error_message, created_at, updated_at
      )
      VALUES (
        @id, @conversation_id, @source_id, @message_id,
        @audio_data, @audio_file_path, @audio_duration,
        @recognized_text, @confidence, @start_time, @end_time,
        @status, @error_message, @created_at, @updated_at
      )
    `);

      const info = stmt.run({
        id: recordId,
        conversation_id: recordData.conversation_id,
        source_id: recordData.source_id,
        message_id: recordData.message_id || null,
        audio_data: recordData.audio_data || null,
        audio_file_path: recordData.audio_file_path || null,
        audio_duration: recordData.audio_duration || null,
        recognized_text: recordData.recognized_text || null,
        confidence: recordData.confidence || null,
        start_time: recordData.start_time,
        end_time: recordData.end_time || null,
        status: recordData.status || 'recording',
        error_message: recordData.error_message || null,
        created_at: Date.now(),
        updated_at: Date.now()
      });

      return this.getSpeechRecordById(recordId);
    }

    // 删除语音识别记录关联的音频文件路径
    deleteSpeechRecordAudio(id) {
      const stmt = this.db.prepare(`
        UPDATE speech_recognition_records
        SET audio_file_path = NULL, updated_at = ?
        WHERE id = ?
      `);
      return stmt.run(Date.now(), id);
    }

    // 获取语音识别记录
    getSpeechRecordById(id) {
      const stmt = this.db.prepare(`
      SELECT sr.*, asrc.name as source_name
      FROM speech_recognition_records sr
      LEFT JOIN audio_sources asrc ON sr.source_id = asrc.id
      WHERE sr.id = ?
    `);
      return stmt.get(id);
    }

    // 通过音频文件路径获取语音识别记录（用于安全地回放/删除录音）
    getSpeechRecordByAudioPath(audioFilePath) {
      if (!audioFilePath) return null;
      const stmt = this.db.prepare(`
      SELECT sr.*, asrc.name as source_name
      FROM speech_recognition_records sr
      LEFT JOIN audio_sources asrc ON sr.source_id = asrc.id
      WHERE sr.audio_file_path = ?
      LIMIT 1
    `);
      return stmt.get(audioFilePath);
    }

    // 更新语音识别记录
    updateSpeechRecord(id, updates) {
      const fields = [];
      const values = { id };

      if (updates.message_id !== undefined) {
        fields.push('message_id = @message_id');
        values.message_id = updates.message_id;
      }
      if (updates.audio_data !== undefined) {
        fields.push('audio_data = @audio_data');
        values.audio_data = updates.audio_data;
      }
      if (updates.audio_file_path !== undefined) {
        fields.push('audio_file_path = @audio_file_path');
        values.audio_file_path = updates.audio_file_path;
      }
      if (updates.audio_duration !== undefined) {
        fields.push('audio_duration = @audio_duration');
        values.audio_duration = updates.audio_duration;
      }
      if (updates.recognized_text !== undefined) {
        fields.push('recognized_text = @recognized_text');
        values.recognized_text = updates.recognized_text;
      }
      if (updates.confidence !== undefined) {
        fields.push('confidence = @confidence');
        values.confidence = updates.confidence;
      }
      if (updates.end_time !== undefined) {
        fields.push('end_time = @end_time');
        values.end_time = updates.end_time;
      }
      if (updates.status !== undefined) {
        fields.push('status = @status');
        values.status = updates.status;
      }
      if (updates.error_message !== undefined) {
        fields.push('error_message = @error_message');
        values.error_message = updates.error_message;
      }

      fields.push('updated_at = @updated_at');
      values.updated_at = Date.now();

      const stmt = this.db.prepare(`
      UPDATE speech_recognition_records
      SET ${fields.join(', ')}
      WHERE id = @id
    `);

      const info = stmt.run(values);
      return info.changes > 0 ? this.getSpeechRecordById(id) : null;
    }

    // 获取对话的语音识别记录
    getSpeechRecordsByConversation(conversationId) {
      const stmt = this.db.prepare(`
      SELECT sr.*, asrc.name as source_name
      FROM speech_recognition_records sr
      LEFT JOIN audio_sources asrc ON sr.source_id = asrc.id
      WHERE sr.conversation_id = ?
      ORDER BY sr.start_time ASC
    `);
      return stmt.all(conversationId);
    }

    // 删除过期的语音识别记录（清理音频文件）
    cleanupExpiredAudioFiles(retentionDays) {
      const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);

      const stmt = this.db.prepare(`
      SELECT id, audio_file_path
      FROM speech_recognition_records
      WHERE audio_file_path IS NOT NULL
        AND created_at < ?
    `);

      const expiredRecords = stmt.all(cutoffTime);

      // 删除文件和数据库记录
      const deleteStmt = this.db.prepare(`
      UPDATE speech_recognition_records
      SET audio_file_path = NULL, audio_data = NULL
      WHERE id = ?
    `);

      let deletedCount = 0;
      for (const record of expiredRecords) {
        if (record.audio_file_path && fs.existsSync(record.audio_file_path)) {
          try {
            fs.unlinkSync(record.audio_file_path);
            deleteStmt.run(record.id);
            deletedCount++;
          } catch (err) {
            console.error(`Error deleting audio file ${record.audio_file_path}:`, err);
          }
        }
      }

      return deletedCount;
    }

    // 初始化默认 ASR 配置（如果没有配置的话）
    seedDefaultASRConfig() {
      try {
        const count = this.db.prepare('SELECT COUNT(*) as count FROM asr_configs').get().count;

        if (count === 0) {
          console.log('No ASR config found, creating default config...');

          // 默认使用 SiliconFlow Cloud（无需下载）
          const defaultModelName = 'siliconflow-cloud';
          const defaultConfig = {
            model_name: defaultModelName,
            language: 'zh',
            enable_vad: 1,
            // 云端模式更适合更灵敏的停顿分句（仅影响 cloud 分句策略）
            sentence_pause_threshold: 0.6,
            retain_audio_files: 1,
            audio_retention_days: 30,
            audio_storage_path: null,
            is_default: 1
          };

          const config = this.createASRConfig(defaultConfig);
          console.log('Default ASR config created:', config);
          return config;
        } else {
          console.log(`ASR configs already exist (${count} configs found), skipping default config creation`);
          return null;
        }
      } catch (error) {
        console.error('Error seeding default ASR config:', error);
        return null;
      }
    }

    // 修复 ASR 配置（迁移旧的/错误的模型名称）
    fixASRConfig() {
      try {
        // 仅迁移旧的 whisper.cpp ggml 名称，不再强制把 base 覆盖成 medium，避免用户选择丢失
        const stmt = this.db.prepare(`
        UPDATE asr_configs
        SET model_name = 'medium', updated_at = ?
        WHERE model_name LIKE 'ggml%'
      `);

        const info = stmt.run(Date.now());

        if (info.changes > 0) {
          console.log(`Migrated ${info.changes} ASR configs from ggml* to 'medium' model`);
        }
      } catch (error) {
        console.error('Error fixing ASR config:', error);
      }
    }

    // 初始化默认音频源
    seedDefaultAudioSources() {
      try {
        // 检查并创建 speaker1
        let speaker1 = this.getAudioSourceById('speaker1');
        if (!speaker1) {
          console.log('Creating default audio source: speaker1');
          speaker1 = this.createAudioSource({
            id: 'speaker1',
            name: 'Speaker 1',
            is_active: 1,
            device_id: null,
            device_name: null
          });
          console.log('Default audio source speaker1 created:', speaker1);
        }

        // 检查并创建 speaker2
        let speaker2 = this.getAudioSourceById('speaker2');
        if (!speaker2) {
          console.log('Creating default audio source: speaker2');
          speaker2 = this.createAudioSource({
            id: 'speaker2',
            name: 'Speaker 2',
            is_active: 0,
            device_id: null,
            device_name: null
          });
          console.log('Default audio source speaker2 created:', speaker2);
        }

        return { speaker1, speaker2 };
      } catch (error) {
        console.error('Error seeding default audio sources:', error);
        return null;
      }
    }
  };
}
