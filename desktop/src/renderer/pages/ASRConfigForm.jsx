import { languageOptions, formatBytes } from './asrSettingsUtils';

export function ASRConfigForm({
  formData,
  setFormData,
  modelPresets,
  selectedModelPreset,
  onCreate,
  onCancel,
}) {
  return (
    <div className="mb-8 p-6 bg-white rounded-lg border border-gray-200 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">添加 ASR 配置</h3>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">模型 *</label>
          <select
            value={formData.model_name}
            onChange={(e) => setFormData({ ...formData, model_name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {modelPresets.length === 0 && <option value="">暂无可用模型</option>}
            {modelPresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label} ({formatBytes(preset.sizeBytes)})
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">
            {selectedModelPreset
              ? `${selectedModelPreset.description} · 推荐: ${selectedModelPreset.recommendedSpec}`
              : '选择模型后可查看详细说明'}
          </p>
          {selectedModelPreset?.engine === 'siliconflow' && (
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              SiliconFlow 云端模型使用 TeleAI/TeleSpeechASR，需要先配置 API Key（环境变量{' '}
              <span className="font-mono">SILICONFLOW_API_KEY</span>），否则无法识别。
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">识别语言 *</label>
          <select
            value={formData.language}
            onChange={(e) => setFormData({ ...formData, language: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {languageOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">分句停顿阈值（秒）</label>
          <input
            type="number"
            step="0.1"
            min="0.2"
            max="5.0"
            value={formData.sentence_pause_threshold}
            onChange={(e) => setFormData({ ...formData, sentence_pause_threshold: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="mt-1 text-xs text-gray-500">检测到停顿超过此时间（秒）时进行分句</p>
        </div>

        <div className="flex items-center">
          <input
            type="checkbox"
            id="enable_vad"
            checked={formData.enable_vad}
            onChange={(e) => setFormData({ ...formData, enable_vad: e.target.checked })}
            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
          />
          <label htmlFor="enable_vad" className="ml-2 text-sm text-gray-700">
            启用语音活动检测（VAD）
          </label>
        </div>

        <div className="flex items-center">
          <input
            type="checkbox"
            id="retain_audio_files"
            checked={formData.retain_audio_files}
            onChange={(e) => setFormData({ ...formData, retain_audio_files: e.target.checked })}
            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
          />
          <label htmlFor="retain_audio_files" className="ml-2 text-sm text-gray-700">
            保留录音文件
          </label>
        </div>

        {formData.retain_audio_files && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">录音文件保留天数</label>
            <input
              type="number"
              min="1"
              max="365"
              value={formData.audio_retention_days}
              onChange={(e) => setFormData({ ...formData, audio_retention_days: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        {formData.retain_audio_files && (
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-2">录音文件存储路径（可选）</label>
            <input
              type="text"
              placeholder="默认为: desktop/audio_recordings/"
              value={formData.audio_storage_path}
              onChange={(e) => setFormData({ ...formData, audio_storage_path: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">留空使用默认路径，或指定自定义路径</p>
          </div>
        )}
      </div>

      <div className="mt-6 flex justify-end space-x-3">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
        >
          取消
        </button>
        <button
          onClick={onCreate}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
        >
          创建配置
        </button>
      </div>
    </div>
  );
}
