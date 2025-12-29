import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ASRModelCard } from './ASRModelCard';
import { ASRConfigForm } from './ASRConfigForm';
import {
  buildStatusMap,
  engineNames,
} from './asrSettingsUtils';

/**
 * ASR（语音识别）设置页面
 */
function ASRSettings() {
  // ASR 配置
  const [asrConfigs, setAsrConfigs] = useState([]);
  const [asrDefaultConfig, setAsrDefaultConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAddConfig, setShowAddConfig] = useState(false);
  const [editingConfig, setEditingConfig] = useState(null);
  const [testingASR, setTestingASR] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testError, setTestError] = useState('');

  // ASR 模型（支持多引擎）
  const [modelPresets, setModelPresets] = useState([]);
  const [modelStatuses, setModelStatuses] = useState({});
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState('');
  const [activeModelId, setActiveModelId] = useState(null);
  const [savingModelId, setSavingModelId] = useState(null);
  const [downloadSource, setDownloadSource] = useState('huggingface');

  // 模型缓存目录（HF / ModelScope）
  const [cacheInfo, setCacheInfo] = useState(null);
  const [cacheLoading, setCacheLoading] = useState(true);
  const [cacheSaving, setCacheSaving] = useState(false);
  const [cacheError, setCacheError] = useState('');
  const [cacheNotice, setCacheNotice] = useState('');

  // SiliconFlow API Key（云端）
  const [siliconflowApiKey, setSiliconflowApiKey] = useState('');
  const [siliconflowApiKeyLoading, setSiliconflowApiKeyLoading] = useState(true);
  const [siliconflowApiKeySaving, setSiliconflowApiKeySaving] = useState(false);
  const [siliconflowApiKeyError, setSiliconflowApiKeyError] = useState('');
  const [siliconflowApiKeyNotice, setSiliconflowApiKeyNotice] = useState('');
  const [siliconflowApiSupported, setSiliconflowApiSupported] = useState(true);
  const [showSiliconflowApiKey, setShowSiliconflowApiKey] = useState(false);

  // 按引擎分组模型
  const modelsByEngine = modelPresets.reduce((acc, preset) => {
    const engine = preset.engine || 'funasr';
    if (!acc[engine]) {
      acc[engine] = [];
    }
    acc[engine].push(preset);
    return acc;
  }, {});

  // 表单数据
  const [formData, setFormData] = useState({
    model_name: 'siliconflow-cloud',
    language: 'zh',
    enable_vad: true,
    // 云端默认更灵敏；FunASR 实际会在主进程侧做下限保护，不会被该默认值影响
    sentence_pause_threshold: 0.6,
    retain_audio_files: false,
    audio_retention_days: 30,
    audio_storage_path: ''
  });

  useEffect(() => {
    loadASRConfigs();
    loadModelData();
    loadCacheInfo();
    loadSiliconflowApiKey();

    const api = window.electronAPI;
    if (!api) {
      return undefined;
    }

    const cleanups = [];

    if (api.onAsrModelDownloadStarted) {
      cleanups.push(api.onAsrModelDownloadStarted((payload) => {
        setModelStatuses((prev) => {
          const previous = prev[payload.modelId] || { modelId: payload.modelId };
          return {
            ...prev,
            [payload.modelId]: {
              ...previous,
              modelId: payload.modelId,
              activeDownload: true,
              bytesPerSecond: 0,
              lastError: null, // 清除上一次错误
            },
          };
        });
      }));
    }

    if (api.onAsrModelDownloadProgress) {
      cleanups.push(api.onAsrModelDownloadProgress((payload) => {
        setModelStatuses((prev) => {
          const previous = prev[payload.modelId] || { modelId: payload.modelId };
          return {
            ...prev,
            [payload.modelId]: {
              ...previous,
              modelId: payload.modelId,
              downloadedBytes: payload.downloadedBytes ?? previous.downloadedBytes ?? 0,
              totalBytes: payload.totalBytes ?? previous.totalBytes ?? previous.sizeBytes ?? 0,
              bytesPerSecond: payload.bytesPerSecond ?? previous.bytesPerSecond ?? 0,
              activeDownload: true,
              isDownloaded: false,
              // 如果 progress 事件里带了 message，也更新
              progressMessage: payload.message || previous.progressMessage,
            },
          };
        });
      }));
    }

    if (api.onAsrModelDownloadLog) {
      cleanups.push(api.onAsrModelDownloadLog((payload) => {
        setModelStatuses((prev) => {
          const previous = prev[payload.modelId] || { modelId: payload.modelId };
          return {
            ...prev,
            [payload.modelId]: {
              ...previous,
              modelId: payload.modelId,
              progressMessage: payload.message,
              activeDownload: true,
            },
          };
        });
      }));
    }

    if (api.onAsrModelDownloadComplete) {
      cleanups.push(api.onAsrModelDownloadComplete((payload) => {
        const status = payload.status || {};
        setModelStatuses((prev) => ({
          ...prev,
          [payload.modelId]: {
            ...(status.modelId ? status : { ...status, modelId: payload.modelId }),
            bytesPerSecond: 0,
            activeDownload: false,
            lastError: null,
          },
        }));
      }));
    }

    if (api.onAsrModelDownloadError) {
      cleanups.push(api.onAsrModelDownloadError((payload) => {
        const reason =
          payload?.message ||
          (payload?.code ? `进程退出码 ${payload.code}${payload?.signal ? `, 信号 ${payload.signal}` : ''}` : '未知错误');
        setModelStatuses((prev) => {
          const previous = prev[payload.modelId] || { modelId: payload.modelId };
          return {
            ...prev,
            [payload.modelId]: {
              ...previous,
              modelId: payload.modelId,
              activeDownload: false,
              lastError: reason,
            },
          };
        });
        alert(`下载模型失败：${reason}`);
      }));
    }

    if (api.onAsrModelDownloadCancelled) {
      cleanups.push(api.onAsrModelDownloadCancelled((payload) => {
        setModelStatuses((prev) => {
          const previous = prev[payload.modelId] || { modelId: payload.modelId };
          return {
            ...prev,
            [payload.modelId]: {
              ...previous,
              modelId: payload.modelId,
              activeDownload: false,
            },
          };
        });
      }));
    }

    return () => {
      cleanups.forEach((cleanup) => {
        if (typeof cleanup === 'function') {
          cleanup();
        }
      });
    };
  }, []);

  const loadCacheInfo = async () => {
    const api = window.electronAPI;
    if (!api?.appGetModelCachePaths) {
      setCacheLoading(false);
      return;
    }
    setCacheLoading(true);
    setCacheError('');
    try {
      const res = await api.appGetModelCachePaths();
      if (!res?.ok) {
        throw new Error(res?.message || '获取缓存目录失败');
      }
      setCacheInfo(res);
    } catch (error) {
      setCacheError(error?.message || String(error));
    } finally {
      setCacheLoading(false);
    }
  };

  const handlePickCacheDir = async () => {
    const api = window.electronAPI;
    if (!api?.appSelectDirectory || !api?.appSetAsrCacheBase) {
      setCacheError('当前版本不支持通过 GUI 配置缓存目录');
      return;
    }
    setCacheNotice('');
    setCacheError('');
    try {
      const selected = await api.appSelectDirectory({ title: '选择模型缓存目录（HF / ModelScope）' });
      if (selected?.canceled || !selected?.path) {
        return;
      }
      setCacheSaving(true);
      const res = await api.appSetAsrCacheBase(selected.path);
      if (!res?.ok) {
        throw new Error(res?.message || '保存缓存目录失败');
      }
      setCacheNotice('已保存：ASR 将自动重载以应用新缓存目录（可能需要 10-30 秒）。');
      await loadCacheInfo();
    } catch (error) {
      setCacheError(error?.message || String(error));
    } finally {
      setCacheSaving(false);
    }
  };

  const handleResetCacheDir = async () => {
    const api = window.electronAPI;
    if (!api?.appSetAsrCacheBase) {
      setCacheError('当前版本不支持通过 GUI 配置缓存目录');
      return;
    }
    setCacheNotice('');
    setCacheError('');
    try {
      setCacheSaving(true);
      const res = await api.appSetAsrCacheBase(null);
      if (!res?.ok) {
        throw new Error(res?.message || '重置缓存目录失败');
      }
      setCacheNotice('已重置为默认目录：ASR 将自动重载以应用变更。');
      await loadCacheInfo();
    } catch (error) {
      setCacheError(error?.message || String(error));
    } finally {
      setCacheSaving(false);
    }
  };

  const loadSiliconflowApiKey = async () => {
    const api = window.electronAPI;
    if (!api?.appGetSiliconflowApiKey) {
      setSiliconflowApiSupported(false);
      setSiliconflowApiKeyLoading(false);
      return;
    }
    setSiliconflowApiSupported(true);
    setSiliconflowApiKeyLoading(true);
    setSiliconflowApiKeyError('');
    try {
      const res = await api.appGetSiliconflowApiKey();
      if (!res?.ok) {
        throw new Error(res?.message || '读取 API Key 失败');
      }
      setSiliconflowApiKey(res.apiKey || '');
    } catch (error) {
      setSiliconflowApiKeyError(error?.message || String(error));
    } finally {
      setSiliconflowApiKeyLoading(false);
    }
  };

  const handleSaveSiliconflowApiKey = async () => {
    const api = window.electronAPI;
    if (!api?.appSetSiliconflowApiKey) {
      setSiliconflowApiSupported(false);
      setSiliconflowApiKeyError('当前版本不支持通过 GUI 配置 SiliconFlow API Key');
      return;
    }
    setSiliconflowApiKeySaving(true);
    setSiliconflowApiKeyError('');
    setSiliconflowApiKeyNotice('');
    try {
      const res = await api.appSetSiliconflowApiKey(siliconflowApiKey);
      if (!res?.ok) {
        throw new Error(res?.message || '保存 API Key 失败');
      }
      setSiliconflowApiKeyNotice(res?.cleared ? '已清除 API Key。' : '已保存 API Key。');
      if (api.asrReloadModel) {
        api.asrReloadModel().catch(() => {});
      }
    } catch (error) {
      setSiliconflowApiKeyError(error?.message || String(error));
    } finally {
      setSiliconflowApiKeySaving(false);
    }
  };

  const handleClearSiliconflowApiKey = async () => {
    setSiliconflowApiKey('');
    const api = window.electronAPI;
    if (!api?.appSetSiliconflowApiKey) {
      setSiliconflowApiSupported(false);
      setSiliconflowApiKeyError('当前版本不支持通过 GUI 配置 SiliconFlow API Key');
      return;
    }
    setSiliconflowApiKeySaving(true);
    setSiliconflowApiKeyError('');
    setSiliconflowApiKeyNotice('');
    try {
      const res = await api.appSetSiliconflowApiKey('');
      if (!res?.ok) {
        throw new Error(res?.message || '清除 API Key 失败');
      }
      setSiliconflowApiKeyNotice('已清除 API Key。');
      if (api.asrReloadModel) {
        api.asrReloadModel().catch(() => {});
      }
    } catch (error) {
      setSiliconflowApiKeyError(error?.message || String(error));
    } finally {
      setSiliconflowApiKeySaving(false);
    }
  };

  const loadModelData = async () => {
    try {
      setModelsError('');
      setModelsLoading(true);
      const api = window.electronAPI;
      if (!api?.asrGetModelPresets) {
        throw new Error('ASR 模型接口不可用');
      }

      const presets = await api.asrGetModelPresets();
      const statuses = await api.asrGetAllModelStatuses();

      setModelPresets(presets || []);
      setModelStatuses(buildStatusMap(statuses || []));
    } catch (err) {
      console.error('加载模型数据失败：', err);
      setModelsError(err.message || '加载模型数据失败');
    } finally {
      setModelsLoading(false);
    }
  };

  const handleDownloadModel = async (modelId) => {
    // 先标记前端状态，按钮/文案立刻反馈，便于“继续下载”场景
    setModelStatuses((prev) => ({
      ...prev,
      [modelId]: {
        ...(prev[modelId] || { modelId }),
        modelId,
        activeDownload: true,
        lastError: null,
        bytesPerSecond: 0,
      },
    }));

    try {
      const api = window.electronAPI;
      if (!api?.asrDownloadModel) {
        throw new Error('下载接口不可用');
      }
      await api.asrDownloadModel(modelId, downloadSource);
    } catch (err) {
      console.error('下载模型失败：', err);
      setModelStatuses((prev) => ({
        ...prev,
        [modelId]: {
          ...(prev[modelId] || { modelId }),
          modelId,
          activeDownload: false,
          lastError: err.message || '未知错误',
        },
      }));
      alert('下载模型失败：' + (err.message || '未知错误'));
    }
  };

  const handleCancelDownload = async (modelId) => {
    try {
      const api = window.electronAPI;
      if (!api?.asrCancelModelDownload) {
        throw new Error('取消下载接口不可用');
      }
      await api.asrCancelModelDownload(modelId);
    } catch (err) {
      console.error('取消下载失败：', err);
      alert('取消下载失败：' + (err.message || '未知错误'));
    }
  };

  const handleSetActiveModel = async (modelId) => {
    try {
      if (!asrDefaultConfig) {
        alert('请先创建并设置一个默认的 ASR 配置');
        return;
      }
      const api = window.electronAPI;
      if (!api?.asrUpdateConfig) {
        throw new Error('ASR 配置接口不可用');
      }
      setSavingModelId(modelId);
      await api.asrUpdateConfig(asrDefaultConfig.id, { model_name: modelId });
      await loadASRConfigs();
      setActiveModelId(modelId);
      api.asrReloadModel()
        .then(() => {
          alert('ASR 模型切换成功，后台已重新加载新模型，将在后续识别中生效。');
        })
        .catch((error) => {
          console.error('重新加载 ASR 模型失败：', error);
          alert('重新加载 ASR 模型失败：' + (error.message || '未知错误'));
        });
    } catch (err) {
      console.error('设置默认模型失败：', err);
      alert('设置默认模型失败：' + (err.message || '未知错误'));
    } finally {
      setSavingModelId(null);
    }
  };

  useEffect(() => {
    if (modelPresets.length === 0) {
      return;
    }
    setFormData((prev) => {
      if (modelPresets.some((preset) => preset.id === prev.model_name)) {
        return prev;
      }
      return {
        ...prev,
        model_name: modelPresets[0].id,
      };
    });
  }, [modelPresets]);

  // 加载 ASR 配置
  const loadASRConfigs = async () => {
    try {
      setLoading(true);
      const api = window.electronAPI;
      if (!api?.asrGetConfigs) {
        throw new Error('ASR API 不可用');
      }

      const configs = await api.asrGetConfigs();
      setAsrConfigs(configs || []);

      // 查找默认配置
      const defaultConfig = configs?.find(config => config.is_default === 1);
      setAsrDefaultConfig(defaultConfig || null);
      const activeModel = defaultConfig?.model_name || configs?.[0]?.model_name || null;
      setActiveModelId(activeModel || null);

      console.log('ASR configs loaded:', configs);
    } catch (err) {
      console.error('加载 ASR 配置失败：', err);
      alert('加载 ASR 配置失败：' + (err.message || '未知错误'));
    } finally {
      setLoading(false);
    }
  };

  // 创建 ASR 配置
  const handleCreateConfig = async () => {
    try {
      const api = window.electronAPI;
      if (!api?.asrCreateConfig) {
        throw new Error('ASR API 不可用');
      }

      // 验证数据
      if (!formData.model_name) {
        alert('请选择模型');
        return;
      }

      const config = await api.asrCreateConfig({
        ...formData,
        enable_vad: formData.enable_vad ? 1 : 0,
        retain_audio_files: formData.retain_audio_files ? 1 : 0,
        sentence_pause_threshold: parseFloat(formData.sentence_pause_threshold) || 1.0,
        audio_retention_days: parseInt(formData.audio_retention_days) || 30
      });

      if (config) {
        alert('ASR 配置创建成功！');
        setShowAddConfig(false);
        resetForm();
        await loadASRConfigs();
      }
    } catch (err) {
      console.error('创建 ASR 配置失败：', err);
      alert('创建 ASR 配置失败：' + (err.message || '未知错误'));
    }
  };

  // 设置默认配置
  const handleSetDefault = async (configId) => {
    try {
      const api = window.electronAPI;
      if (!api?.asrSetDefaultConfig) {
        throw new Error('ASR API 不可用');
      }

      const success = await api.asrSetDefaultConfig(configId);
      if (success) {
        alert('已设置为默认配置');
        await loadASRConfigs();
      }
    } catch (err) {
      console.error('设置默认配置失败：', err);
      alert('设置默认配置失败：' + (err.message || '未知错误'));
    }
  };

  // 删除配置
  const handleDeleteConfig = async (configId) => {
    if (!confirm('确定要删除这个配置吗？此操作不可恢复。')) {
      return;
    }

    try {
      const api = window.electronAPI;
      if (!api?.deleteLLMConfig) {
        // TODO: 实现删除 ASR 配置的方法
        alert('删除功能暂未实现');
        return;
      }

      // await api.deleteASRConfig(configId);
      alert('配置已删除（模拟）');
      await loadASRConfigs();
    } catch (err) {
      console.error('删除配置失败：', err);
      alert('删除配置失败：' + (err.message || '未知错误'));
    }
  };

  // 重置表单
  const resetForm = () => {
    setFormData({
      model_name: modelPresets[0]?.id || 'siliconflow-cloud',
      language: 'zh',
      enable_vad: true,
      sentence_pause_threshold: 0.6,
      retain_audio_files: false,
      audio_retention_days: 30,
      audio_storage_path: ''
    });
  };

  // 测试 ASR 功能
  const testASR = async () => {
    if (testingASR) return;
    setTestingASR(true);
    setTestResult(null);
    setTestError('');

    let captureService = null;
    let sentenceListener = null;
    let testConversationId = null;
    const cleanupListener = () => {
      if (sentenceListener) {
        window.electronAPI?.removeListener?.('asr-sentence-complete', sentenceListener);
        sentenceListener = null;
      }
    };

    try {
      const api = window.electronAPI;
      if (!api) throw new Error('electronAPI 不可用');

      // 确保测试角色存在
      try {
        await api.createCharacter({
          id: 'asr-test-character',
          name: 'ASR 测试角色',
          nickname: '测试',
          affinity: 50,
          created_at: Date.now(),
          updated_at: Date.now()
        });
      } catch {
        // 角色可能已存在，忽略错误
      }

      // 创建一个临时对话，便于把识别结果保存/回显
      const conversation = await api.dbCreateConversation({
        id: 'asr-settings-test',
        character_id: 'asr-test-character',
        title: 'ASR 测试',
        date: Date.now(),
        affinity_change: 0,
        summary: 'ASR 设置页测试会话',
        tags: null,
        created_at: Date.now(),
        updated_at: Date.now()
      });
      testConversationId = conversation?.id || 'asr-settings-test';

      // 1) 检查模型就绪
      const ready = await api.asrCheckReady();
      if (!ready?.ready) {
        throw new Error(ready?.message || 'ASR 模型未就绪，请先下载并设为默认');
      }

      // 2) 启动 ASR（使用测试会话 ID）
      await api.asrStart(testConversationId);

      // 3) 监听识别结果（拿到一句就停）
      sentenceListener = (payload) => {
        const finalText = payload?.text || payload?.content;
        if (!finalText) return;
        setTestResult(finalText);
        if (captureService) {
          captureService.stopCapture('speaker1').catch(() => {});
        }
        api.asrStop().catch(() => {});
        setTestingASR(false);
        cleanupListener();
      };
      api.on('asr-sentence-complete', sentenceListener);

      // 4) 启动麦克风采集，录 6 秒
      // audio-capture-service 默认导出的是单例实例，而非类
      const { default: audioCaptureService } = await import('../../asr/audio-capture-service');
      captureService = audioCaptureService;

      await captureService.startMicrophoneCapture('speaker1');
      // 超时保护：6 秒后自动停止
      setTimeout(() => {
        if (captureService) {
          captureService.stopCapture('speaker1').catch(() => {});
        }
        api.asrStop().catch(() => {});
        setTestingASR(false);
        cleanupListener();
      }, 6000);
    } catch (err) {
      console.error('ASR 测试失败：', err);
      setTestError(err.message || '未知错误');
      cleanupListener();
      setTestingASR(false);
    }
  };

  const selectedModelPreset = modelPresets.find((preset) => preset.id === formData.model_name);

  if (loading) {
    return (
      <div className="container mx-auto p-6 max-w-6xl">
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">加载中...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      {/* 页面标题 */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">ASR 语音识别设置</h1>
            <p className="text-gray-600">配置语音识别模型、音频设备和录音选项</p>
          </div>
          <Link
            to="/settings"
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-sm">arrow_back</span>
            返回设置
          </Link>
        </div>
      </div>

      {/* 模型缓存目录 */}
      <div className="mb-8">
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">模型缓存目录</h2>
              <p className="text-sm text-gray-600 mt-1">
                管理 FunASR / HuggingFace / ModelScope 的模型下载位置，方便跨平台统一与迁移。
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handlePickCacheDir}
                disabled={cacheSaving}
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
              >
                {cacheSaving ? '保存中…' : '选择目录…'}
              </button>
              <button
                onClick={handleResetCacheDir}
                disabled={cacheSaving}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
              >
                重置默认
              </button>
              <button
                onClick={loadCacheInfo}
                disabled={cacheSaving}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
              >
                刷新
              </button>
            </div>
          </div>

          {cacheNotice && (
            <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
              {cacheNotice}
            </div>
          )}
          {cacheError && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {cacheError}
            </div>
          )}

          {cacheLoading ? (
            <div className="mt-4 text-sm text-gray-600">正在读取缓存目录…</div>
          ) : cacheInfo?.computed ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="text-xs font-semibold text-gray-700">ASR 缓存根目录（ASR_CACHE_BASE）</div>
                <div className="mt-1 break-all font-mono text-xs text-gray-800">{cacheInfo.computed.asrCacheBase}</div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="text-xs font-semibold text-gray-700">HuggingFace 缓存（HF_HOME / hub）</div>
                <div className="mt-1 break-all font-mono text-xs text-gray-800">{cacheInfo.computed.hfHome}</div>
                <div className="mt-1 break-all font-mono text-xs text-gray-600">{cacheInfo.computed.asrCacheDir}</div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 md:col-span-2">
                <div className="text-xs font-semibold text-gray-700">ModelScope 缓存（MODELSCOPE_CACHE / hub）</div>
                <div className="mt-1 break-all font-mono text-xs text-gray-800">{cacheInfo.computed.modelscopeCacheBase}</div>
                <div className="mt-1 break-all font-mono text-xs text-gray-600">{cacheInfo.computed.modelscopeCacheHub}</div>
              </div>
              {cacheInfo?.persistedAsrCacheBase && (
                <div className="rounded-lg border border-gray-200 bg-white p-3 md:col-span-2">
                  <div className="text-xs font-semibold text-gray-700">已保存的自定义目录</div>
                  <div className="mt-1 break-all font-mono text-xs text-gray-800">{cacheInfo.persistedAsrCacheBase}</div>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-4 text-sm text-gray-600">
              当前未能读取缓存目录信息（可能是旧版本主进程未实现对应 IPC）。
            </div>
          )}
        </div>
      </div>

      {/* 模型管理 */}
      <div className="mb-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">ASR 模型管理</h2>
            <p className="text-sm text-gray-600 mt-1">
              选择适合设备性能的模型，查看本地缓存状态，并监控下载速度
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setDownloadSource('huggingface')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${downloadSource === 'huggingface'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                  }`}
              >
                HuggingFace
              </button>
              <button
                onClick={() => setDownloadSource('modelscope')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${downloadSource === 'modelscope'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                  }`}
              >
                ModelScope (国内推荐)
              </button>
            </div>
            <button
              onClick={loadModelData}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-sm">refresh</span>
              刷新状态
            </button>
          </div>
        </div>

        <div className="mt-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">SiliconFlow API Key</h3>
                <p className="text-sm text-gray-600 mt-1">
                  用于 TeleAI/TeleSpeechASR 云端识别；保存后会自动重载 ASR。
                </p>
              </div>
              <button
                onClick={loadSiliconflowApiKey}
                disabled={siliconflowApiKeySaving}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
              >
                刷新
              </button>
            </div>

            {!siliconflowApiSupported ? (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                当前版本不支持通过 GUI 配置 SiliconFlow API Key。
              </div>
            ) : (
              <>
                {siliconflowApiKeyNotice && (
                  <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                    {siliconflowApiKeyNotice}
                  </div>
                )}
                {siliconflowApiKeyError && (
                  <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    {siliconflowApiKeyError}
                  </div>
                )}
                {siliconflowApiKeyLoading ? (
                  <div className="mt-4 text-sm text-gray-600">正在读取 API Key…</div>
                ) : (
                  <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
                    <div className="relative">
                      <input
                        type={showSiliconflowApiKey ? 'text' : 'password'}
                        placeholder="请输入 SiliconFlow API Key"
                        value={siliconflowApiKey}
                        onChange={(e) => setSiliconflowApiKey(e.target.value)}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-16 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowSiliconflowApiKey((prev) => !prev)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
                      >
                        {showSiliconflowApiKey ? '隐藏' : '显示'}
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleSaveSiliconflowApiKey}
                        disabled={siliconflowApiKeySaving}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                      >
                        {siliconflowApiKeySaving ? '保存中…' : '保存'}
                      </button>
                      <button
                        onClick={handleClearSiliconflowApiKey}
                        disabled={siliconflowApiKeySaving}
                        className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
                      >
                        清除
                      </button>
                    </div>
                  </div>
                )}
                <div className="mt-2 text-xs text-gray-500">
                  API Key 会保存在本地设置中，仅用于本机调用云端 ASR。
                </div>
              </>
            )}
          </div>
        </div>

        {modelsError && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {modelsError}
          </div>
        )}

        {modelsLoading ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[...Array(6)].map((_, index) => (
              <div
                key={index}
                className="h-48 animate-pulse rounded-2xl border border-gray-200 bg-gray-100"
              />
            ))}
          </div>
        ) : modelPresets.length === 0 ? (
          <div className="mt-6 rounded-lg border-2 border-dashed border-gray-200 p-8 text-center text-gray-500">
            暂无可用的 ASR 模型预设
          </div>
        ) : (
          <div className="mt-6 space-y-8">
            {Object.entries(modelsByEngine).map(([engine, presets]) => (
              <div key={engine} className="space-y-4">
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {engineNames[engine] || engine}
                  </h3>
                </div>
                <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                  {presets.map((preset) => (
                    <ASRModelCard
                      key={preset.id}
                      preset={preset}
                      status={modelStatuses[preset.id] || {}}
                      activeModelId={activeModelId}
                      savingModelId={savingModelId}
                      modelsLoading={modelsLoading}
                      onSetActive={handleSetActiveModel}
                      onDownload={handleDownloadModel}
                      onCancelDownload={handleCancelDownload}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 默认配置信息 */}
      {asrDefaultConfig && (
        <div className="mb-6 space-y-4">
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-blue-800">
                  当前默认配置: {asrDefaultConfig.model_name}
                </h3>
                <div className="mt-1 text-sm text-blue-700">
                  <p>语言: {asrDefaultConfig.language === 'zh' ? '中文' : asrDefaultConfig.language}</p>
                  <p>VAD: {asrDefaultConfig.enable_vad ? '已启用' : '已禁用'}</p>
                  {asrDefaultConfig.retain_audio_files && (
                    <p>录音保留: {asrDefaultConfig.audio_retention_days} 天</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 本地模型警告信息 */}
          {asrDefaultConfig.model_name && !asrDefaultConfig.model_name.includes('cloud') && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-start">
                <div className="flex-shrink-0 mt-0.5">
                  <span className="material-symbols-outlined text-amber-600">warning</span>
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-amber-800">
                    正在使用本地模型
                  </h3>
                  <div className="mt-1 text-sm text-amber-700 space-y-1">
                    <p>• 本地模型需要下载较大的模型文件（约 1-3GB），且需要占用较多的系统资源（CPU/内存）。</p>
                    <p>• 优势：响应速度更快（低延迟），数据完全本地处理，隐私性更好。</p>
                    <p>• 如果您的设备性能较弱，推荐切换回 <b>SiliconFlow Cloud</b> 远程模式。</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 远程模型提示信息 */}
          {asrDefaultConfig.model_name && asrDefaultConfig.model_name.includes('cloud') && (
             <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-start">
                <div className="flex-shrink-0 mt-0.5">
                  <span className="material-symbols-outlined text-green-600">cloud_done</span>
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-green-800">
                    正在使用远程云端模型 (推荐)
                  </h3>
                  <div className="mt-1 text-sm text-green-700 space-y-1">
                    <p>• 无需下载模型文件，不占用本地算力。</p>
                    <p>• 依赖网络连接，可能会有轻微的网络延迟。</p>
                    <p>• SiliconFlow 云端模型使用 TeleAI/TeleSpeechASR，请先配置 API Key（SILICONFLOW_API_KEY）。</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 配置列表 */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900">ASR 配置列表</h2>
          <button
            onClick={() => setShowAddConfig(true)}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <span className="material-symbols-outlined text-sm">add</span>
            添加配置
          </button>
        </div>

        {asrConfigs.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900">暂无 ASR 配置</h3>
            <p className="mt-1 text-sm text-gray-500">点击上方按钮添加第一个配置</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {asrConfigs.map((config) => (
              <div key={config.id} className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center">
                      <h3 className="text-lg font-medium text-gray-900">
                        {config.model_name}
                      </h3>
                    </div>
                    <div className="mt-1 text-sm text-gray-600">
                      <p>语言: {config.language === 'zh' ? '中文' : config.language}</p>
                      <p>VAD: {config.enable_vad ? '已启用' : '已禁用'}</p>
                      <p>停顿阈值: {config.sentence_pause_threshold} 秒</p>
                      {config.retain_audio_files ? (
                        <p className="text-green-600">录音保留: {config.audio_retention_days} 天</p>
                      ) : (
                        <p className="text-gray-500">不保留录音</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    {config.is_default !== 1 && (
                      <button
                        onClick={() => handleSetDefault(config.id)}
                        className="px-3 py-1 text-sm text-blue-600 border border-blue-600 rounded hover:bg-blue-50 transition-colors"
                      >
                        设为默认
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteConfig(config.id)}
                      className="px-3 py-1 text-sm text-red-600 border border-red-600 rounded hover:bg-red-50 transition-colors"
                    >
                      删除
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 添加配置表单 */}
      {showAddConfig && (
        <ASRConfigForm
          formData={formData}
          setFormData={setFormData}
          modelPresets={modelPresets}
          selectedModelPreset={selectedModelPreset}
          onCreate={handleCreateConfig}
          onCancel={() => {
            setShowAddConfig(false);
            resetForm();
          }}
        />
      )}

      {/* 操作按钮 */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={testASR}
          disabled={testingASR}
          className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors disabled:cursor-not-allowed disabled:bg-green-300"
        >
          {testingASR ? '🎤 测试中...' : '🎤 测试语音识别'}
        </button>
        <button
          onClick={loadASRConfigs}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          🔄 刷新配置
        </button>
      </div>

      {/* 说明信息 */}
      {(testResult || testError) && (
        <div className="mt-4 p-4 rounded-lg border text-sm">
          {testResult && (
            <div className="text-green-700">
              <div className="font-semibold">测试识别结果</div>
              <div className="mt-1 break-words">{testResult}</div>
            </div>
          )}
          {testError && (
            <div className="text-red-700">
              <div className="font-semibold">测试失败</div>
              <div className="mt-1">{testError}</div>
            </div>
          )}
          <div className="mt-2 text-gray-600">
            若想重新测试，请确保麦克风权限已开启并保持安静环境，再点击“测试语音识别”。
          </div>
        </div>
      )}

      <div className="mt-8 p-4 bg-gray-50 rounded-lg">
        <h3 className="text-sm font-medium text-gray-900 mb-2">💡 使用说明</h3>
        <ul className="text-sm text-gray-600 space-y-1">
          <li>• 模型大小影响识别准确率和性能，请根据设备性能选择</li>
          <li>• VAD（语音活动检测）可提高识别准确性，建议开启</li>
          <li>• 录音文件可用于回放和质量分析，但会占用存储空间</li>
          <li>• 在 HUD 界面中点击"开始识别"按钮启动语音识别</li>
          <li>• 识别结果会自动保存到当前对话中</li>
        </ul>
      </div>
    </div>
  );
}

export default ASRSettings;
