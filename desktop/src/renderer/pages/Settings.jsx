import { useEffect } from 'react';
import { Link } from 'react-router-dom';

// Hooks
import { useLLMConfig } from '../hooks/useLLMConfig.js';
import { useSuggestionConfig } from '../hooks/useSuggestionConfig.js';
import { useAudioDevices } from '../hooks/useAudioDevices.js';
import { useAudioCapture } from '../hooks/useAudioCapture.js';

// Components
import { LLMConfigList } from '../components/LLM/LLMConfigList.jsx';
import { LLMConfigForm } from '../components/LLM/LLMConfigForm.jsx';
import { SuggestionConfigForm } from '../components/Suggestions/SuggestionConfigForm.jsx';
import { AudioDeviceSelector } from '../components/Audio/AudioDeviceSelector.jsx';
import { AudioTester } from '../components/Audio/AudioTester.jsx';

function Settings() {
  // 使用自定义Hooks
  const llmHook = useLLMConfig();
  const suggestionHook = useSuggestionConfig();
  const audioDevicesHook = useAudioDevices();
  const audioCaptureHook = useAudioCapture();

  // 初始化
  useEffect(() => {
    llmHook.loadConfigs();
    llmHook.loadFeatureBindings();
    suggestionHook.loadSuggestionSettings();
    audioDevicesHook.initializeAudioDevices();
  }, []);

  // 当音频源配置加载完成后，更新设备选择并自动保存
  useEffect(() => {
    audioDevicesHook.handleAudioSourcesLoaded();
  }, [audioDevicesHook.speaker1Source, audioDevicesHook.speaker2Source, audioDevicesHook.audioDevices]);

  // 开始监听
  const handleStartListening = async () => {
    await audioCaptureHook.startListening({
      selectedAudioDevice: audioDevicesHook.selectedAudioDevice,
      captureSystemAudio: audioDevicesHook.captureSystemAudio
    });
  };

  return (
    <div className="p-8 overflow-y-auto h-full">
      <div className="max-w-4xl mx-auto pb-8">
        {/* 标题 */}
        <div className="mb-8">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-primary hover:text-primary/80 mb-4 transition-colors"
          >
            <span className="material-symbols-outlined">arrow_back</span>
            <span>返回</span>
          </Link>
          <h1 className="text-3xl font-bold text-text-light dark:text-text-dark">设置</h1>
          <p className="text-text-muted-light dark:text-text-muted-dark mt-2">
            管理应用设置和LLM配置
          </p>
        </div>

        {/* LLM配置部分 */}
        <div className="bg-surface-light dark:bg-surface-dark rounded-xl p-6 border border-border-light dark:border-border-dark mb-6">
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-text-light dark:text-text-dark flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">settings</span>
              LLM配置
            </h2>
          </div>

          <div className="space-y-4">
            {!llmHook.showAddConfig && llmHook.llmConfigs.length > 0 && (
              <div className="flex justify-end mb-4">
                <button
                  onClick={() => llmHook.setShowAddConfig(true)}
                  className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-sm">add</span>
                  添加配置
                </button>
              </div>
            )}

            {llmHook.llmConfigs.length === 0 && !llmHook.showAddConfig ? (
              <div className="text-center py-8">
                <p className="text-text-muted-light dark:text-text-muted-dark mb-4">暂无LLM配置</p>
                <button
                  onClick={() => llmHook.setShowAddConfig(true)}
                  className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
                >
                  添加配置
                </button>
              </div>
            ) : (
              <>
                <LLMConfigList
                  configs={llmHook.llmConfigs}
                  defaultConfig={llmHook.defaultConfig}
                  loading={llmHook.loading}
                  onSetDefault={llmHook.handleSetDefault}
                  onEdit={llmHook.handleEditConfig}
                  onDelete={llmHook.handleDeleteConfig}
                />

                {llmHook.showAddConfig && (
                  <LLMConfigForm
                    newConfig={llmHook.newConfig}
                    onChange={llmHook.setNewConfig}
                    onSubmit={llmHook.handleSaveConfig}
                    onTest={llmHook.handleTestLLMConfig}
                    onCancel={llmHook.handleCancelAdd}
                    testingConfig={llmHook.testingConfig}
                    testConfigMessage={llmHook.testConfigMessage}
                    testConfigError={llmHook.testConfigError}
                    isEditing={!!llmHook.editingConfigId}
                  />
                )}
              </>
            )}

            {/* 功能绑定到指定 LLM 配置 */}
            <div className="p-4 rounded-lg border border-border-light dark:border-border-dark">
              <div className="mb-3">
                <p className="font-medium text-text-light dark:text-text-dark">按功能选择 LLM 配置</p>
                <p className="text-sm text-text-muted-light dark:text-text-muted-dark">
                  不同功能可绑定不同的 LLM（未选择时沿用默认配置）。
                </p>
              </div>

              {llmHook.featureBindingError ? (
                <div className="mb-3 p-3 rounded bg-red-50 dark:bg-red-900/20 text-sm text-red-600 dark:text-red-300 border border-red-200 dark:border-red-500/40">
                  {llmHook.featureBindingError}
                </div>
              ) : null}

              <div className="space-y-3">
                {[
                  { key: 'suggestion', label: '对话建议' },
                  { key: 'review', label: '复盘报告' }
                ].map((item) => (
                  <div key={item.key} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                    <div className="w-28 text-sm text-text-light dark:text-text-dark">{item.label}</div>
                    <select
                      disabled={llmHook.featureBindingLoading || llmHook.loading}
                      value={llmHook.featureBindings?.[item.key] || ''}
                      onChange={(e) => llmHook.handleSetFeatureConfig(item.key, e.target.value || null)}
                      className="flex-1 px-3 py-2 border border-border-light dark:border-border-dark rounded-lg bg-surface-light dark:bg-surface-dark text-text-light dark:text-text-dark focus:outline-none focus:ring-2 focus:ring-primary/50"
                    >
                      <option value="">使用默认配置</option>
                      {llmHook.llmConfigs.map((cfg) => (
                        <option key={cfg.id} value={cfg.id}>
                          {cfg.name || '未命名'}（{cfg.model_name || '未配置模型'}）
                          {llmHook.defaultConfig?.id === cfg.id ? ' - 默认' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 对话建议配置 */}
        <div className="bg-surface-light dark:bg-surface-dark rounded-xl p-6 border border-border-light dark:border-border-dark mb-6">
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-text-light dark:text-text-dark flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">auto_awesome</span>
              对话建议配置
            </h2>
            <p className="text-sm text-text-muted-light dark:text-text-muted-dark">
              控制 LLM 生成选项的触发策略、上下文窗口以及使用的模型。
            </p>
          </div>

          {suggestionHook.suggestionLoading ? (
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <p className="mt-4 text-text-muted-light dark:text-text-muted-dark">加载中...</p>
            </div>
          ) : (
            <SuggestionConfigForm
              form={suggestionHook.suggestionForm}
              onUpdateField={suggestionHook.updateSuggestionField}
              onNumberChange={suggestionHook.handleSuggestionNumberChange}
              onSave={suggestionHook.handleSaveSuggestionConfig}
              loading={suggestionHook.suggestionLoading}
              saving={suggestionHook.suggestionSaving}
              message={suggestionHook.suggestionMessage}
              error={suggestionHook.suggestionError}
            />
          )}
        </div>

        {/* 音频设置 */}
        <div className="bg-surface-light dark:bg-surface-dark rounded-xl p-6 border border-border-light dark:border-border-dark mb-6">
          <h2 className="text-xl font-semibold text-text-light dark:text-text-dark mb-4 flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">mic</span>
            音频输入设置
          </h2>

          <AudioDeviceSelector
            audioDevices={audioDevicesHook.audioDevices}
            selectedAudioDevice={audioDevicesHook.selectedAudioDevice}
            onDeviceChange={audioDevicesHook.handleAudioDeviceChange}
            captureSystemAudio={audioDevicesHook.captureSystemAudio}
            onSystemAudioToggle={audioDevicesHook.handleSystemAudioToggle}
            speaker1Source={audioDevicesHook.speaker1Source}
            speaker2Source={audioDevicesHook.speaker2Source}
          />

          <AudioTester
            isListening={audioCaptureHook.isListening}
            audioStatus={audioCaptureHook.audioStatus}
            desktopCapturerError={audioCaptureHook.desktopCapturerError}
            micVolumeLevel={audioCaptureHook.micVolumeLevel}
            systemVolumeLevel={audioCaptureHook.systemVolumeLevel}
            totalVolumeLevel={audioCaptureHook.totalVolumeLevel}
            onStart={handleStartListening}
            onStop={audioCaptureHook.stopListening}
            captureSystemAudio={audioDevicesHook.captureSystemAudio}
          />
        </div>

        {/* ASR设置 */}
        <div className="bg-surface-light dark:bg-surface-dark rounded-xl p-6 border border-border-light dark:border-border-dark mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-text-light dark:text-text-dark flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">mic</span>
              语音识别设置
            </h2>
            <Link
              to="/asr-settings"
              className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors text-sm flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-sm">settings</span>
              管理ASR配置
            </Link>
          </div>
          <p className="text-text-muted-light dark:text-text-muted-dark">
            配置语音识别模型、音频设备和录音选项
          </p>
        </div>

      </div>
    </div>
  );
}

export default Settings;