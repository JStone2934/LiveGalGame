import { useState } from 'react';
import { formatBytes, formatSpeed, calculateProgress, isPresetActive, engineNames } from './asrSettingsUtils';

// 过滤 ANSI 转义序列
function stripAnsi(str) {
  if (!str) return str;
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]|\[A/g, '').trim();
}

export function ASRModelCard({
  preset,
  status = {},
  activeModelId,
  savingModelId,
  modelsLoading,
  onSetActive,
  onDownload,
  onCancelDownload,
  // SiliconFlow API Key props (optional, only for siliconflow-cloud)
  apiKey,
  apiKeyLoading,
  apiKeySaving,
  apiKeyError,
  apiKeyNotice,
  apiKeySupported,
  onApiKeyChange,
  onApiKeySave,
  onApiKeyClear,
  onApiKeyRefresh,
}) {
  const [showApiKey, setShowApiKey] = useState(false);
  const isCloudModel = preset.id === 'siliconflow-cloud' || preset.id === 'baidu-cloud';
  const totalBytes = status.totalBytes || status.sizeBytes || preset.sizeBytes || 0;
  const downloadedBytes = status.downloadedBytes || 0;
  const percent = calculateProgress(downloadedBytes, totalBytes);
  const isDownloaded = Boolean(status.isDownloaded);
  const activeDownload = Boolean(status.activeDownload);
  const isActive = isPresetActive(preset, activeModelId);
  const updatedAt = status.updatedAt ? new Date(status.updatedAt).toLocaleString() : null;
  const progressVisible = (totalBytes > 0 && (activeDownload || (downloadedBytes > 0 && !isDownloaded))) || (activeDownload && status.progressMessage);
  const engine = preset.engine || 'funasr';
  const canResume = !isDownloaded && downloadedBytes > 0 && !activeDownload;
  const progressMessage = stripAnsi(status.progressMessage);
  // 是否有进度条（有字节数据）
  const hasProgressBar = totalBytes > 0 && percent > 0;

  return (
    <div
      className={`rounded-2xl border bg-white p-5 shadow-sm transition-all ${
        isActive ? 'border-blue-500 ring-2 ring-blue-100' : 'border-gray-200'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-gray-900">{preset.label}</h3>
            <span
              className={`px-2 py-1 text-xs font-medium rounded-full ${
                engine === 'funasr' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
              }`}
            >
              {engineNames[engine] || engine}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-600">{preset.description}</p>
          {preset.language && (
            <p className="mt-1 text-xs text-gray-500">
              语言: {preset.language === 'zh' ? '中文' : preset.language === 'multilingual' ? '多语言' : preset.language}
            </p>
          )}
        </div>
        {isActive && (
          <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700">
            当前使用
          </span>
        )}
      </div>

      <div className="mt-4 grid gap-2 text-sm text-gray-700">
        <p>推荐配置：{preset.recommendedSpec}</p>
        <p>速度参考：{preset.speedHint}</p>
        <p>模型大小：{formatBytes(preset.sizeBytes)}</p>
      </div>

      <div className="mt-4 text-sm">
        {isDownloaded || preset.sizeBytes === 0 ? (
          <div className="flex items-center text-green-600">
            <span className="material-symbols-outlined mr-1 text-sm">check_circle</span>
            <span>{preset.sizeBytes === 0 ? '无需下载 (云端)' : `本地可用${updatedAt ? ` · 更新于 ${updatedAt}` : ''}`}</span>
          </div>
        ) : status.lastError ? (
          <div className="flex items-start text-red-600">
            <span className="material-symbols-outlined mr-1 text-sm">error</span>
            <span>上次下载失败：{status.lastError}</span>
          </div>
        ) : (
          <div className="text-gray-500">
            {activeDownload ? '正在下载模型...' : '尚未下载，点击下方按钮开始下载'}
          </div>
        )}
      </div>

      {progressVisible && (
        <div className="mt-3">
          {totalBytes > 0 && percent > 0 ? (
            <>
              <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                <div
                  className={`h-full rounded-full ${isDownloaded ? 'bg-green-500' : 'bg-blue-500'}`}
                  style={{ width: `${percent}%` }}
                />
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-gray-600">
                <span>
                  {formatBytes(downloadedBytes)} / {formatBytes(totalBytes)} ({percent}%)
                </span>
                <span>速度：{formatSpeed(status.bytesPerSecond)}</span>
              </div>
            </>
          ) : (
            <div className="text-xs text-gray-500 animate-pulse flex items-center gap-2">
               <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
               {progressMessage || '正在准备下载...'}
            </div>
          )}
        </div>
      )}

      {/* API Key input (for cloud models) */}
      {isCloudModel && apiKeySupported !== false && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">API Key</span>
            <button
              onClick={onApiKeyRefresh}
              disabled={apiKeySaving}
              className="text-xs text-gray-500 hover:text-gray-700 disabled:text-gray-300"
            >
              刷新
            </button>
          </div>
          {apiKeyNotice && (
            <div className="mb-2 rounded-lg border border-blue-200 bg-blue-50 p-2 text-xs text-blue-800">
              {apiKeyNotice}
            </div>
          )}
          {apiKeyError && (
            <div className="mb-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
              {apiKeyError}
            </div>
          )}
          {apiKeyLoading ? (
            <div className="text-xs text-gray-500">正在读取 API Key…</div>
          ) : (
            <>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  placeholder="请输入 SiliconFlow API Key"
                  value={apiKey || ''}
                  onChange={(e) => onApiKeyChange?.(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-14 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey((prev) => !prev)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
                >
                  {showApiKey ? '隐藏' : '显示'}
                </button>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={onApiKeySave}
                  disabled={apiKeySaving}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                >
                  {apiKeySaving ? '保存中…' : '保存'}
                </button>
                <button
                  onClick={onApiKeyClear}
                  disabled={apiKeySaving}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
                >
                  清除
                </button>
              </div>
              <div className="mt-2 text-xs text-gray-500">
                API Key 会保存在本地设置中，仅用于本机调用云端 ASR。
              </div>
            </>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {isDownloaded || preset.sizeBytes === 0 ? (
          <button
            onClick={() => onSetActive(preset.id)}
            disabled={isActive || savingModelId === preset.id}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${
              isActive ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'
            } transition-colors`}
          >
            {isActive ? '当前已启用' : savingModelId === preset.id ? '应用中...' : '设为当前模型'}
          </button>
        ) : (
          <button
            onClick={() => onDownload(preset.id)}
            disabled={activeDownload || modelsLoading}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
          >
            {activeDownload ? '下载中...' : canResume ? '继续下载' : '下载模型'}
          </button>
        )}

        {activeDownload && (
          <button
            onClick={() => onCancelDownload(preset.id)}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            取消下载
          </button>
        )}
      </div>
    </div>
  );
}

