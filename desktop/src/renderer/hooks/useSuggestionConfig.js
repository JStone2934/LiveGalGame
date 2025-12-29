import { useState, useCallback } from 'react';
import { coerceNumberValue } from '../utils/validation.js';

const DEFAULT_SUGGESTION_FORM = {
  enable_passive_suggestion: true,
  suggestion_count: 3,
  silence_threshold_seconds: 3,
  message_threshold_count: 3,
  cooldown_seconds: 15,
  context_message_limit: 10,
  user_profile: ''
};

/**
 * 建议配置管理的自定义Hook
 */
export const useSuggestionConfig = () => {
  const [suggestionConfig, setSuggestionConfig] = useState(null);
  const [suggestionForm, setSuggestionForm] = useState(DEFAULT_SUGGESTION_FORM);
  const [suggestionLoading, setSuggestionLoading] = useState(true);
  const [suggestionSaving, setSuggestionSaving] = useState(false);
  const [suggestionMessage, setSuggestionMessage] = useState('');
  const [suggestionError, setSuggestionError] = useState('');

  /**
   * 标准化建议配置表单数据
   * @param {Object} config - 配置对象
   * @returns {Object} 标准化后的配置
   */
  const normalizeSuggestionForm = useCallback((config) => {
    const merged = {
      ...DEFAULT_SUGGESTION_FORM,
      ...(config || {})
    };
    return {
      enable_passive_suggestion: Boolean(merged.enable_passive_suggestion),
      suggestion_count: coerceNumberValue(merged.suggestion_count, DEFAULT_SUGGESTION_FORM.suggestion_count),
      silence_threshold_seconds: coerceNumberValue(merged.silence_threshold_seconds, DEFAULT_SUGGESTION_FORM.silence_threshold_seconds),
      message_threshold_count: coerceNumberValue(merged.message_threshold_count, DEFAULT_SUGGESTION_FORM.message_threshold_count),
      cooldown_seconds: coerceNumberValue(merged.cooldown_seconds, DEFAULT_SUGGESTION_FORM.cooldown_seconds),
      context_message_limit: coerceNumberValue(merged.context_message_limit, DEFAULT_SUGGESTION_FORM.context_message_limit),
      user_profile: merged.user_profile || ''
    };
  }, []);

  /**
   * 更新建议配置字段
   * @param {string} field - 字段名
   * @param {*} value - 字段值
   */
  const updateSuggestionField = useCallback((field, value) => {
    setSuggestionForm(prev => ({
      ...prev,
      [field]: value
    }));
  }, []);

  /**
   * 处理数字字段变化
   * @param {string} field - 字段名
   * @returns {Function} 事件处理器
   */
  const handleSuggestionNumberChange = (field) => (event) => {
    const value = event.target.value;
    updateSuggestionField(field, value === '' ? '' : Number(value));
  };

  /**
   * 加载建议设置
   */
  const loadSuggestionSettings = useCallback(async () => {
    if (!window.electronAPI?.getSuggestionConfig) {
      setSuggestionLoading(false);
      return;
    }
    setSuggestionLoading(true);
    setSuggestionError('');
    try {
      const config = await window.electronAPI.getSuggestionConfig();
      setSuggestionConfig(config);
      setSuggestionForm(normalizeSuggestionForm(config));
    } catch (error) {
      console.error('加载建议配置失败:', error);
      setSuggestionError(error?.message || '加载失败，请稍后重试');
    } finally {
      setSuggestionLoading(false);
    }
  }, [normalizeSuggestionForm]);

  /**
   * 保存建议配置
   */
  const handleSaveSuggestionConfig = useCallback(async () => {
    if (!window.electronAPI?.updateSuggestionConfig) {
      return;
    }
    setSuggestionSaving(true);
    setSuggestionMessage('');
    setSuggestionError('');
    try {
      const payload = {
        enable_passive_suggestion: suggestionForm.enable_passive_suggestion ? 1 : 0,
        suggestion_count: coerceNumberValue(suggestionForm.suggestion_count, DEFAULT_SUGGESTION_FORM.suggestion_count),
        silence_threshold_seconds: coerceNumberValue(suggestionForm.silence_threshold_seconds, DEFAULT_SUGGESTION_FORM.silence_threshold_seconds),
        message_threshold_count: coerceNumberValue(suggestionForm.message_threshold_count, DEFAULT_SUGGESTION_FORM.message_threshold_count),
        cooldown_seconds: coerceNumberValue(suggestionForm.cooldown_seconds, DEFAULT_SUGGESTION_FORM.cooldown_seconds),
        context_message_limit: coerceNumberValue(suggestionForm.context_message_limit, DEFAULT_SUGGESTION_FORM.context_message_limit),
        user_profile: suggestionForm.user_profile || null,
        // 场景判定模型配置项取消，统一使用数据库默认 LLM；后台按需保持开启
        topic_detection_enabled: 1,
        situation_llm_enabled: 1
      };
      await window.electronAPI.updateSuggestionConfig(payload);
      // 通知 HUD 侧刷新建议配置，避免需切换会话才生效
      window.electronAPI?.send?.('suggestion-config-updated');
      setSuggestionMessage('已保存');
      await loadSuggestionSettings();
      setTimeout(() => setSuggestionMessage(''), 3000);
    } catch (error) {
      console.error('保存建议配置失败:', error);
      setSuggestionError(error?.message || '保存失败，请稍后重试');
    } finally {
      setSuggestionSaving(false);
    }
  }, [loadSuggestionSettings, suggestionForm]);

  /**
   * 清除消息
   */
  const clearSuggestionMessage = useCallback(() => {
    setSuggestionMessage('');
    setSuggestionError('');
  }, []);

  return {
    // 状态
    suggestionConfig,
    suggestionForm,
    suggestionLoading,
    suggestionSaving,
    suggestionMessage,
    suggestionError,

    // 常量
    DEFAULT_SUGGESTION_FORM,

    // 方法
    updateSuggestionField,
    handleSuggestionNumberChange,
    loadSuggestionSettings,
    handleSaveSuggestionConfig,
    clearSuggestionMessage
  };
};
