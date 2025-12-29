import { buildSuggestionContext } from './suggestion-context-builder.js';
import { createToonSuggestionStreamParser } from './toon-parser.js';
import { renderPromptTemplate } from './prompt-manager.js';

const MIN_SUGGESTION_COUNT = 2;
const MAX_SUGGESTION_COUNT = 5;
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_SITUATION_MODEL = 'gpt-4o-mini';
const DEFAULT_TIMEOUT_MS = 1000 * 15;
const STREAM_TIMEOUT_MS = 1000 * 30;
const DEFAULT_SITUATION_TIMEOUT_MS = 1000 * 5;

function safeText(value) {
  if (value === undefined || value === null) return '';
  return String(value);
}

export default class LLMSuggestionService {
  constructor(dbGetter) {
    this.dbGetter = dbGetter;
    this.clientPool = {};
    this.clientConfigSignature = null; // 保留字段兼容旧逻辑（不再使用）
    this.currentLLMConfig = null;
    this.currentLLMFeature = 'default';
  }

  get db() {
    const db = this.dbGetter?.();
    if (!db) {
      throw new Error('Database is not initialized');
    }
    return db;
  }

  async ensureClient(feature = 'default') {
    const featureKey = typeof feature === 'string' && feature.trim() ? feature.trim().toLowerCase() : 'default';
    const llmConfig =
      (this.db.getLLMConfigForFeature && this.db.getLLMConfigForFeature(featureKey)) ||
      this.db.getDefaultLLMConfig();
    if (!llmConfig) {
      throw new Error('未找到默认LLM配置，请先在设置中配置。');
    }

    const signature = `${featureKey}:${llmConfig.id || 'unknown'}-${llmConfig.updated_at || 0}`;
    const cached = this.clientPool[featureKey];
    if (!cached || cached.signature !== signature) {
      const { default: OpenAI } = await import('openai');
      const clientConfig = { apiKey: llmConfig.api_key };
      if (llmConfig.base_url) {
        // Remove trailing '/chat/completions' if present
        const baseURL = llmConfig.base_url.replace(/\/chat\/completions\/?$/, '');
        clientConfig.baseURL = baseURL;
      }
      this.clientPool[featureKey] = {
        client: new OpenAI(clientConfig),
        signature,
        config: llmConfig
      };
    }

    this.currentLLMConfig = llmConfig;
    this.currentLLMFeature = featureKey;
    return this.clientPool[featureKey].client;
  }

  sanitizeCount(value, fallback) {
    const num = Number(value ?? fallback ?? MIN_SUGGESTION_COUNT);
    if (Number.isNaN(num)) return MIN_SUGGESTION_COUNT;
    return Math.min(MAX_SUGGESTION_COUNT, Math.max(MIN_SUGGESTION_COUNT, Math.round(num)));
  }

  resolveTimeoutMs(config, fallback) {
    const raw = config?.timeout_ms;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.round(parsed);
    }
    return fallback;
  }

  async generateSuggestions(payload = {}) {
    const collected = [];
    let metadata = null;
    await this.generateSuggestionsStream(payload, {
      onSuggestion: (suggestion) => {
        collected.push(suggestion);
      },
      onComplete: (info) => {
        metadata = info;
      }
    });
    return { suggestions: collected, metadata };
  }

  normalizeDeltaContent(deltaContent) {
    if (!deltaContent) return '';
    if (typeof deltaContent === 'string') return deltaContent;
    if (Array.isArray(deltaContent)) {
      return deltaContent
        .map((part) => {
          if (!part) return '';
          if (typeof part === 'string') return part;
          if (typeof part.text === 'string') return part.text;
          if (part.text?.value) return part.text.value;
          if (part.text?.content) return part.text.content;
          if (part.content) return String(part.content);
          return '';
        })
        .join('');
    }
    return '';
  }

  async generateSuggestionsStream(payload = {}, handlers = {}) {
    const {
      conversationId,
      characterId,
      decisionPointId: incomingDecisionPointId,
      trigger = 'manual',
      reason = 'manual',
      optionCount,
      messageLimit,
      previousSuggestions = []
    } = payload;

    if (!conversationId && !characterId) {
      throw new Error('缺少会话或角色信息，无法生成建议。');
    }

    const suggestionConfig = this.db.getSuggestionConfig();
    const count = this.sanitizeCount(optionCount ?? suggestionConfig?.suggestion_count, 3);
    const contextLimit = messageLimit || suggestionConfig?.context_message_limit || 10;
    const client = await this.ensureClient('suggestion');
    const modelName = this.resolveModelName(this.currentLLMConfig, suggestionConfig);

    const context = buildSuggestionContext(this.db, {
      conversationId,
      characterId,
      messageLimit: contextLimit
    });

    // 获取用户个人档案
    const userProfile = suggestionConfig?.user_profile || '';

    const prompt = this.buildSuggestionPrompt({
      count,
      trigger,
      reason,
      context,
      previousSuggestions,
      userProfile
    });

    const requestParams = {
      model: modelName,
      temperature: trigger === 'manual' ? 1.0 : 0.9,
      max_tokens: 4096,
      reasoning_effort: "disabled", // 禁用 OpenAI 风格推理
      thinking: { type: "disabled" }, // 禁用智谱/GLM 风格深度思考
      stream: true,
      messages: [
        {
          role: 'system',
          content:
            '你是一个恋爱互动教练，负责根据当前对话状态，为玩家提供下一步回复的"话题方向 + 简要提示"。' +
            '请保持中文输出，语气自然友好。只输出 TOON 格式，遵循用户提供的表头，不要添加 JSON。'
        },
        {
          role: 'user',
          content: prompt
        }
      ]
    };

    console.log('[LLMSuggestionService] Starting stream with payload:', payload);

    const abortController = new AbortController();
    // 增加超时时间，避免在上下文较长或网络波动时误触发超时
    const streamTimeoutMs = this.resolveTimeoutMs(this.currentLLMConfig, STREAM_TIMEOUT_MS * 2);
    const timeoutId = setTimeout(() => {
      console.error('[LLMSuggestionService] Stream timed out after', streamTimeoutMs, 'ms');
      abortController.abort(new Error('LLM生成超时，请稍后重试'));
    }, streamTimeoutMs);

    let usageInfo = null;
    let emittedCount = 0;
    let chunkCount = 0;
    let totalContentLength = 0;
    let rawStreamContent = '';

    // 记录批次时间戳，同一批次的所有建议使用相同的时间戳
    const batchTimestamp = Date.now();

    // 获取最新的消息ID（用于关联suggestion）
    const latestMessageId = context.history && context.history.length > 0
      ? context.history[context.history.length - 1]?.id || null
      : null;

    // 决策点：refresh 必须复用；否则新建
    let decisionPointId = incomingDecisionPointId || null;
    if (!decisionPointId && conversationId && this.db.createDecisionPoint) {
      try {
        decisionPointId = this.db.createDecisionPoint({
          conversationId,
          anchorMessageId: latestMessageId,
          createdAt: batchTimestamp
        });
      } catch (error) {
        console.warn('[LLMSuggestionService] Failed to create decision point, falling back to null:', error);
        decisionPointId = null;
      }
    }

    // 每次生成 = 一个批次（包含 trigger/reason），用于区分“换一批”
    let batchId = null;
    if (decisionPointId && this.db.createSuggestionBatch) {
      try {
        batchId = this.db.createSuggestionBatch({
          decisionPointId,
          trigger,
          reason,
          createdAt: batchTimestamp
        });
      } catch (error) {
        console.warn('[LLMSuggestionService] Failed to create suggestion batch, falling back to null:', error);
        batchId = null;
      }
    }

    console.log('[LLMSuggestionService] Creating TOON parser');
    const parser = createToonSuggestionStreamParser({
      onHeader: (header) => {
        console.log('[LLMSuggestionService] Parser received header:', header);
        handlers.onHeader?.(header);
      },
      onPartialSuggestion: (partial) => {
        handlers.onPartialSuggestion?.({
          index: emittedCount,
          suggestion: partial
        });
      },
      onSuggestion: (item) => {
        console.log(`[LLMSuggestionService] Parser received suggestion #${emittedCount + 1}:`, item);
        const suggestionIndex = emittedCount;
        const suggestion = this.decorateSuggestion(item, emittedCount, { trigger, reason }, batchTimestamp);
        suggestion.index = suggestionIndex;
        suggestion.suggestion_index = suggestionIndex;
        suggestion.decision_point_id = decisionPointId;
        suggestion.batch_id = batchId;
        console.log(`[LLMSuggestionService] Decorated suggestion:`, suggestion);
        emittedCount += 1;

        // 保存suggestion到数据库
        if (conversationId && this.db.saveActionSuggestion) {
          try {
            this.db.saveActionSuggestion(suggestion, conversationId, latestMessageId);
            console.log(`[LLMSuggestionService] Saved suggestion to database: ${suggestion.id}`);
          } catch (error) {
            console.error('[LLMSuggestionService] Failed to save suggestion to database:', error);
            // 不阻断流程，继续执行
          }
        }

        handlers.onSuggestion?.(suggestion);
      },
      onSkip: (data) => {
        console.log('[LLMSuggestionService] Parser detected SKIP, no suggestions needed');
        // 调用完成回调，但标记为 skipped
        handlers.onComplete?.({
          trigger,
          reason,
          skipped: true,
          skipReason: data?.reason || 'no_suggestion_needed',
          model: modelName,
          tokenUsage: usageInfo,
          contextMessages: context.history?.length || 0
        });
      },
      onError: (error) => {
        console.error('[LLMSuggestionService] Parser error:', error);
        handlers.onParserError?.(error);
      }
    });

    try {
      console.log('[LLMSuggestionService] Calling onStart handler');
      handlers.onStart?.({
        trigger,
        reason,
        expectedCount: count
      });

      console.log('LLM Suggestion Stream Request Debug Info:', {
        payload,
        llmConfig: {
          id: this.currentLLMConfig.id,
          name: this.currentLLMConfig.name,
          base_url: this.currentLLMConfig.base_url,
          model_name: this.currentLLMConfig.model_name
        },
        requestParams
      });

      console.log('[LLMSuggestionService] Creating OpenAI stream...');
      const stream = await client.chat.completions.create(requestParams, { signal: abortController.signal });
      console.log('[LLMSuggestionService] OpenAI stream created successfully');

      console.log('[LLMSuggestionService] Starting to process chunks...');
      let hasReceivedContent = false; // 标记是否已收到真正的content

      for await (const chunk of stream) {
        chunkCount++;
        const choice = chunk?.choices?.[0];
        const deltaContent = choice?.delta?.content;
        const reasoningContent = choice?.delta?.reasoning_content;
        const delta = this.normalizeDeltaContent(deltaContent);

        // 如果收到 reasoning_content，记录日志但忽略它（即使设置了 disabled，某些模型可能仍会返回）
        if (reasoningContent && !delta) {
          // 只在第一次收到思考内容时记录，避免日志过多
          if (chunkCount <= 3) {
            console.log(`[LLMSuggestionService] Received reasoning_content (ignored), waiting for content...`);
          }
          // 跳过这个chunk，不处理
          continue;
        }

        // 只处理真正的 content 字段
        if (delta) {
          if (!hasReceivedContent) {
            hasReceivedContent = true;
            console.log(`[LLMSuggestionService] First content chunk received at chunk #${chunkCount}`);
          }

          totalContentLength += delta.length;
          rawStreamContent += String(delta);

          // 简化日志输出，避免过多细节
          if (chunkCount % 50 === 0 || delta.length > 10) {
            const preview = delta.length > 30 ? delta.slice(0, 30).replace(/\n/g, '\\n') + '...' : delta.replace(/\n/g, '\\n');
            console.log(`[LLMSuggestionService] Chunk #${chunkCount}: content (${delta.length} chars) "${preview}"`);
          }

          // 立即推送到parser，实现真正的流式展示
          parser.push(delta);
        }

        // 检查流是否结束
        if (choice?.finish_reason) {
          console.log(`[LLMSuggestionService] Stream finished with reason: ${choice.finish_reason}`);
          parser.end();
        }

        // 记录使用情况
        if (chunk?.usage) {
          console.log('[LLMSuggestionService] Received usage info:', chunk.usage);
          usageInfo = chunk.usage;
        }
      }

      console.log(`[LLMSuggestionService] Stream processing complete. Total chunks: ${chunkCount}, total content: ${totalContentLength} chars, emitted suggestions: ${emittedCount}`);
      console.log('[LLMSuggestionService] Full streamed content:\n', rawStreamContent);

      console.log('[LLMSuggestionService] Calling parser.end() manually');
      parser.end();

      console.log('[LLMSuggestionService] Calling onComplete handler');
      handlers.onComplete?.({
        trigger,
        reason,
        model: modelName,
        tokenUsage: usageInfo,
        contextMessages: context.history?.length || 0
      });

      console.log('[LLMSuggestionService] Stream completed successfully');
    } catch (error) {
      console.error('[LLMSuggestionService] Stream failed, calling onError handler');
      handlers.onError?.(error);

      console.error('LLM Suggestion Stream Failed - Full Debug Info:', {
        error: {
          message: error.message,
          status: error.status,
          code: error.code,
          type: error.type,
          param: error.param,
          headers: error.headers,
          requestID: error.requestID
        },
        payload,
        llmConfig: {
          id: this.currentLLMConfig.id,
          name: this.currentLLMConfig.name,
          base_url: this.currentLLMConfig.base_url,
          model_name: this.currentLLMConfig.model_name
        },
        requestParams,
        contextInfo: {
          conversationId,
          characterId,
          messageLimit: contextLimit,
          contextHistoryLength: context.history?.length || 0
        },
        streamStats: {
          chunkCount,
          totalContentLength,
          emittedCount
        },
        rawStreamContent
      });
      throw error;
    } finally {
      console.log('[LLMSuggestionService] Clearing timeout');
      clearTimeout(timeoutId);
    }
  }

  buildSuggestionPrompt({ count, trigger, reason, context, previousSuggestions = [], userProfile = '' }) {
    const triggerLabel = trigger === 'manual' ? '用户主动请求' : `系统被动触发（原因：${reason}）`;
    const triggerGuidance = {
      manual: '用户主动求助：提供多元策略（保守/进取/幽默/共情），帮助选择其一。',
      silence: '静默提醒：给破冰/延续话题的轻量提示，降低冷场尴尬。',
      message_count: '角色多条未回：提炼关键点，给一条综合回应思路，包含确认/回应/再提问。',
      topic_change: '话题转折或被提问：先回应问题/态度，再给推进话题的具体方向。',
      refresh: '用户点击"换一批"：生成与上次完全不同方向的新建议。'
    }[trigger === 'manual' && reason === 'refresh' ? 'refresh' : trigger] || '按通用策略生成多样化可选方案。';

    const affinityStageText = context.affinityStage?.label
      ? `${context.affinityStage.label}：${context.affinityStage.strategy}`
      : '好感阶段未知：保持礼貌与真诚。';

    const emotionText = context.emotion?.label
      ? `最后一条角色消息情感：${context.emotion.label}（${context.emotion.reason || '推测'}）`
      : '最后消息情感：中性';

    const previousList = Array.isArray(previousSuggestions)
      ? previousSuggestions.filter((item) => item && (item.title || item.content))
      : [];
    const previousSuggestionText = previousList.length
      ? [
        '【用户反馈】上一批建议未被采纳，用户要求换一批，请给出明显不同的新思路，避免重复或轻微改写。',
        '【上一批建议（仅供去同质化参考）】',
        ...previousList.slice(0, 5).map((item, index) => {
          const tagsText = Array.isArray(item.tags) && item.tags.length ? ` [${item.tags.join('、')}]` : '';
          return `${index + 1}. ${item.title || '未命名'}：${item.content || ''}${tagsText}`;
        })
      ].join('\n')
      : '';

    const historyText = Array.isArray(context.historyText)
      ? context.historyText.join('\n')
      : safeText(context.historyText);

    const skipRule = trigger === 'manual'
      ? '- 必须生成建议，禁止输出 SKIP。'
      : '- 如果对话不需要建议（角色自言自语/话没说完/自然闲聊流畅），直接输出：SKIP';

    // 用户个人档案：如果为空则显示提示文字
    const userProfileText = safeText(userProfile).trim() || '（未设置，生成建议时将使用通用策略）';

    return renderPromptTemplate('suggestion', {
      triggerLabel,
      triggerGuidance,
      characterProfile: safeText(context.characterProfile),
      affinityStageText,
      userProfile: userProfileText,
      historyText,
      emotionText,
      previousSuggestionText,
      count,
      skipRule
    });
  }

  extractJSON(text = '') {
    if (!text) return null;
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }

  decorateSuggestion(item, index, { trigger, reason }, batchTimestamp = null) {
    // 使用批次时间戳，确保同一批次的所有建议使用相同的时间戳
    // 如果没有提供批次时间戳，则使用当前时间（向后兼容）
    const timestamp = batchTimestamp || Date.now();
    const suggestionId = `llm-suggestion-${timestamp}-${index}`;
    const tags = Array.isArray(item.tags)
      ? item.tags.slice(0, 3)
      : typeof item.tags === 'string'
        ? item.tags.split(/[,，、]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 3)
        : [];
    const suggestionText = item.suggestion || item.title || item.content || `选项 ${index + 1}`;
    // affinity_delta 范围：0-10（对方接受度预测）
    const affinityPrediction =
      typeof item.affinity_delta === 'number' && !Number.isNaN(item.affinity_delta)
        ? Math.max(0, Math.min(10, Math.round(item.affinity_delta)))
        : null;
    return {
      id: suggestionId,
      title: suggestionText,
      content: suggestionText,
      tags,
      // affinity_hint: item.affinity_hint || null,
      trigger,
      reason,
      affinity_prediction: affinityPrediction,
      created_at: timestamp // 使用批次时间戳，确保同一批次的所有建议使用相同的时间戳
    };
  }

  runWithTimeout(promise, timeoutMs) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('LLM生成超时，请稍后重试'));
      }, timeoutMs);
    });

    return Promise.race([
      promise.finally(() => clearTimeout(timeoutId)),
      timeoutPromise
    ]);
  }

  analyzeHeuristics() {
    // 关键词启发式已禁用，直接放行由 LLM 判断
    return { shouldCheck: true, reason: 'disabled', features: null };
  }

  clampConfidence(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) return null;
    return Math.min(1, Math.max(0, value));
  }

  parseBoolean(value) {
    const text = String(value ?? '').trim().toLowerCase();
    if (!text) return false;
    return ['true', '1', 'yes', 'y', '是', '需要', '要', '是的'].includes(text);
  }

  csvSplit(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"' && line[i - 1] !== '\\') {
        inQuotes = !inQuotes;
        continue;
      }
      if ((char === ',' || char === '，') && !inQuotes) {
        result.push(current);
        current = '';
        continue;
      }
      current += char;
    }
    if (current !== '' || line.endsWith(',') || line.endsWith('，')) {
      result.push(current);
    }
    return result;
  }

  parseSituationToon(text = '') {
    if (!text) return null;
    const lines = text
      .split('\n')
      .map((line) => line.trim().replace(/^```toon\b/i, '').replace(/```$/i, ''))
      .filter(Boolean);

    let headerIndex = -1;
    let fields = [];
    const headerRegex = /^situation\[(\d+)\]\{([^}]+)\}:\s*$/i;
    for (let i = 0; i < lines.length; i += 1) {
      const match = lines[i].match(headerRegex);
      if (match) {
        headerIndex = i;
        fields = match[2]
          .split(',')
          .map((f) => f.trim())
          .filter(Boolean);
        break;
      }
    }

    if (headerIndex === -1 || !fields.length) {
      console.warn('[SituationToonParser] Header not found or fields empty', { text });
      return null;
    }

    const dataLine = lines.slice(headerIndex + 1).find((line) => line && !/^```/.test(line));
    if (!dataLine) {
      console.warn('[SituationToonParser] No data line found after header');
      return null;
    }

    const values = this.csvSplit(dataLine);
    const result = {};
    fields.forEach((field, idx) => {
      result[field] = values[idx] !== undefined ? values[idx].trim() : '';
    });
    return result;
  }

  buildSituationPrompt(context, heuristicResult, signals = {}) {
    const silenceSeconds = signals.silenceSeconds != null ? Math.min(signals.silenceSeconds, 60) : null;
    const roleBurstCount = signals.roleBurstCount != null ? Math.min(signals.roleBurstCount, 8) : null;
    const triggerHint = signals.triggerHint || 'auto';
    const signalLines = [];
    if (silenceSeconds != null) {
      signalLines.push(`【冷场时长】约 ${silenceSeconds.toFixed(1)} 秒（已封顶 60 秒）`);
    }
    if (roleBurstCount != null) {
      signalLines.push(`【连续角色消息】${roleBurstCount} 条（已封顶 8 条）`);
    }
    signalLines.push(`【触发来源提示】${triggerHint}`);

    const historyText = Array.isArray(context.historyText)
      ? context.historyText.join('\n')
      : safeText(context.historyText);

    return renderPromptTemplate('situation', {
      characterProfile: safeText(context.characterProfile),
      historyText,
      signalLines: signalLines.join('\n')
    });
  }

  async evaluateSituation(payload = {}) {
    const { conversationId, characterId, messageLimit = 6 } = payload;
    const suggestionConfig = this.db.getSuggestionConfig();
    const llmEnabled = suggestionConfig?.situation_llm_enabled ?? suggestionConfig?.topic_detection_enabled;
    if (!llmEnabled) {
      return { shouldSuggest: false, shouldIntervene: false, reason: 'situation_llm_disabled' };
    }

    const context = buildSuggestionContext(this.db, {
      conversationId,
      characterId,
      messageLimit: Math.min(messageLimit, 8)
    });

    const silenceSeconds = Math.min(
      Math.max(Number(payload.silence_seconds ?? 0) || 0, 0),
      60
    );
    const roleBurstCount = Math.min(
      Math.max(Number(payload.role_burst_count ?? 0) || 0, 0),
      8
    );
    const triggerHint = payload.trigger_hint || 'auto';

    const history = context.history || [];
    if (!history.length) {
      return { shouldSuggest: false, shouldIntervene: false, reason: 'no_history' };
    }

    const heuristicResult = this.analyzeHeuristics();

    const client = await this.ensureClient('situation');
    const modelName = this.resolveSituationModelName(this.currentLLMConfig, suggestionConfig);
    const prompt = this.buildSituationPrompt(context, heuristicResult, {
      silenceSeconds,
      roleBurstCount,
      triggerHint
    });

    const requestParams = {
      model: modelName,
      temperature: 0,
      max_tokens: 120,
      reasoning_effort: "disabled", // 禁用 OpenAI 风格推理
      thinking: { type: "disabled" }, // 禁用智谱/GLM 风格深度思考
      stream: true,
      messages: [
        {
          role: 'system',
          content: '你是实时对话决策器，只输出 TOON 表格，不输出任何其他文字。'
        },
        {
          role: 'user',
          content: prompt
        }
      ]
    };

    console.log('Situation LLM Request Debug Info:', {
      payload,
      llmConfig: {
        id: this.currentLLMConfig.id,
        name: this.currentLLMConfig.name,
        base_url: this.currentLLMConfig.base_url,
        model_name: this.currentLLMConfig.model_name
      },
      requestParams
    });

    const controller = new AbortController();

    const buildResult = (parsed = {}) => {
      const needOptions = this.parseBoolean(parsed.need_options ?? parsed.should_suggest ?? parsed.should_intervene);
      const shouldIntervene = this.parseBoolean(parsed.should_intervene ?? parsed.should_suggest ?? parsed.need_options ?? needOptions);
      return {
        shouldIntervene,
        shouldSuggest: needOptions,
        needOptions,
        trigger: parsed.trigger || 'auto',
        reason: parsed.reason || 'llm_evaluation',
        confidence: this.clampConfidence(parsed.confidence),
        features: null,
        model: modelName
      };
    };

    try {
      const timeoutMs = this.resolveTimeoutMs(this.currentLLMConfig, DEFAULT_SITUATION_TIMEOUT_MS);
      const stream = await this.runWithTimeout(
        client.chat.completions.create(requestParams, { signal: controller.signal }),
        timeoutMs
      );

      return await new Promise((resolve, reject) => {
        let buffer = '';
        let rawStreamContent = '';
        let firstContentLogged = false;
        let headerParsed = false;
        let fields = [];
        let lastParsed = null;
        let resolved = false;

        const finish = (parsedObj) => {
          if (resolved) return;
          resolved = true;
          controller.abort();
          console.log('[SituationParser] finish', parsedObj || lastParsed || {});
          resolve(buildResult(parsedObj || lastParsed || {}));
        };

        // 增强的表头正则：兼容冒号可选，并尝试捕获可能连在一起的数据
        const headerRegex = /^situation\[(\d+)\]\{([^}]+)\}:?\s*(.*)$/i;

        // 解析key:value格式的数据行（兼容模型输出在同一行的情况）
        const parseKeyValueLine = (line) => {
          const obj = {};
          // 匹配 key:value 格式，兼容中文字符和逗号
          const kvPattern = /(\w+):\s*([^,}]+)/g;
          let match;
          while ((match = kvPattern.exec(line)) !== null) {
            const key = match[1].trim();
            let value = match[2].trim();
            // 移除末尾可能的逗号或右括号
            value = value.replace(/[,}]$/, '').trim();
            obj[key] = value;
          }
          return Object.keys(obj).length > 0 ? obj : null;
        };

        const processLine = (line) => {
          if (!line) return;
          if (!headerParsed) {
            const match = line.match(headerRegex);
            if (match) {
              headerParsed = true;
              const headerFields = match[2];
              const possibleData = match[3]?.trim();

              fields = headerFields
                .split(',')
                .map((f) => f.trim())
                .filter(Boolean);
              console.log('[SituationParser] header parsed', { fields, possibleData });

              // 如果表头后面有数据（同一行），尝试解析key:value格式
              if (possibleData) {
                const kvObj = parseKeyValueLine(possibleData);
                if (kvObj && Object.keys(kvObj).length > 0) {
                  lastParsed = kvObj;
                  console.log('[SituationParser] data parsed from header line (key:value)', kvObj);
                  // 解析到完整数据后立即返回，无论need_options值
                  finish(kvObj);
                  return;
                }
              }
            }
            return;
          }

          // 数据行处理：先尝试key:value格式，再尝试CSV格式
          let parsedObj = null;

          // 尝试key:value格式
          const kvObj = parseKeyValueLine(line);
          if (kvObj && Object.keys(kvObj).length > 0) {
            parsedObj = kvObj;
            console.log('[SituationParser] data line parsed (key:value)', parsedObj);
          } else {
            // 尝试CSV格式
            const values = this.csvSplit(line);
            parsedObj = {};
            fields.forEach((field, idx) => {
              parsedObj[field] = values[idx] !== undefined ? values[idx].trim() : '';
            });
            console.log('[SituationParser] data line parsed (csv)', parsedObj);
          }

          if (parsedObj && Object.keys(parsedObj).length > 0) {
            lastParsed = parsedObj;
            // 解析到有效数据后立即返回，无论need_options值
            // 如果need_options为true则更快返回，但false也会在流结束时返回
            const needOptions = this.parseBoolean(
              parsedObj.need_options ?? parsedObj.should_suggest ?? parsedObj.should_intervene
            );
            if (needOptions) {
              finish(parsedObj);
            }
            // 如果need_options为false，会在流结束时通过finish(lastParsed)返回
          }
        };

        (async () => {
          try {
            for await (const chunk of stream) {
              const choice = chunk?.choices?.[0];
              const reasoningContent = choice?.delta?.reasoning_content;
              const content = this.normalizeDeltaContent(choice?.delta?.content);

              // 忽略思考内容，确保判定尽快返回
              if (reasoningContent && !content) {
                continue;
              }
              if (!content) continue;

              buffer += content;
              rawStreamContent += content;

              if (!firstContentLogged) {
                firstContentLogged = true;
                console.log('[SituationParser] first content chunk', content.slice(0, 80).replace(/\n/g, '\\n'));
              }

              let newlineIndex = buffer.indexOf('\n');
              while (newlineIndex >= 0) {
                const line = buffer.slice(0, newlineIndex).trim();
                buffer = buffer.slice(newlineIndex + 1);
                processLine(line);
                newlineIndex = buffer.indexOf('\n');
              }
            }
            // 流结束，若未解析到则用最后记录
            if (buffer.trim()) {
              console.log('[SituationParser] flushing tail line', buffer.trim());
              processLine(buffer.trim());
            }
            console.log(
              '[SituationParser] stream end, raw length=',
              rawStreamContent.length,
              'preview=',
              rawStreamContent.slice(0, 120).replace(/\n/g, '\\n'),
              'lastParsed=',
              lastParsed
            );
            finish(lastParsed || {});
          } catch (error) {
            if (error?.name === 'AbortError' && resolved) return;
            reject(error);
          }
        })();
      });
    } catch (error) {
      console.error('Situation LLM Request Failed - Full Debug Info:', {
        error: {
          message: error.message,
          status: error.status,
          code: error.code,
          type: error.type,
          param: error.param,
          headers: error.headers,
          requestID: error.requestID
        },
        payload,
        llmConfig: {
          id: this.currentLLMConfig.id,
          name: this.currentLLMConfig.name,
          base_url: this.currentLLMConfig.base_url,
          model_name: this.currentLLMConfig.model_name
        },
        requestParams,
        contextInfo: {
          conversationId,
          characterId,
          messageLimit: Math.min(messageLimit, 8),
          contextHistoryLength: context.history?.length || 0
        }
      });
      throw error;
    }
  }

  async detectTopicShift(payload = {}) {
    const result = await this.evaluateSituation(payload);
    return {
      shouldSuggest: result.shouldSuggest,
      reason: result.reason,
      trigger: result.trigger,
      confidence: result.confidence,
      features: result.features || null,
      model: result.model
    };
  }

  resolveModelName(llmConfig, suggestionConfig) {
    const llmModel = llmConfig?.model_name && llmConfig.model_name.trim();
    if (llmModel) {
      return llmModel;
    }
    const suggestionModel = suggestionConfig?.model_name && suggestionConfig.model_name.trim();
    if (suggestionModel) {
      return suggestionModel;
    }
    return DEFAULT_MODEL;
  }

  resolveSituationModelName(llmConfig, suggestionConfig) {
    const situationModel = suggestionConfig?.situation_model_name && suggestionConfig.situation_model_name.trim();
    // 若用户未显式设置（默认 gpt-4o-mini），优先使用全局默认 LLM 配置的模型，避免与不同提供商的默认占位不匹配
    if (situationModel && situationModel !== 'gpt-4o-mini') {
      return situationModel;
    }
    return this.resolveModelName(llmConfig, suggestionConfig) || DEFAULT_SITUATION_MODEL;
  }
}

