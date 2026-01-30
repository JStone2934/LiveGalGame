import { Link, useLocation } from 'react-router-dom';
import { useEffect, useId, useRef, useState } from 'react';
import { calculateProgress, formatBytes, formatSpeed } from '../pages/asrSettingsUtils';

function Layout({ children }) {
  const location = useLocation();
  const logoId = useId();
  const [downloadStatus, setDownloadStatus] = useState(null);
  const hideTimerRef = useRef(null);
  const [hudNotice, setHudNotice] = useState(null);
  const hudNoticeTimerRef = useRef(null);

  const isActive = (path) => {
    if (path === '/') {
      return location.pathname === '/';
    }
    return location.pathname.startsWith(path);
  };

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) {
      return undefined;
    }

    const cleanups = [];

    const upsertStatus = (payload = {}) => {
      setDownloadStatus((prev) => {
        const base = prev || {};
        return {
          ...base,
          ...payload,
          lastUpdated: Date.now()
        };
      });
    };

    const handleStart = (payload) => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
      upsertStatus({
        ...payload,
        activeDownload: true,
        status: 'start',
        source: payload?.source || 'preload'
      });
    };

    const handleProgress = (payload) => {
      upsertStatus({
        ...payload,
        activeDownload: true,
        status: 'progress',
        source: payload?.source || 'preload'
      });
    };

    const handleComplete = (payload) => {
      const status = payload?.status || {};
      upsertStatus({
        ...status,
        ...payload,
        activeDownload: false,
        status: 'complete',
        isDownloaded: true,
        source: payload?.source || status?.source || 'preload'
      });
      hideTimerRef.current = setTimeout(() => {
        setDownloadStatus(null);
      }, 5000);
    };

    const handleError = (payload) => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
      upsertStatus({
        ...payload,
        activeDownload: false,
        status: 'error',
        source: payload?.source || 'preload'
      });
    };

    const handleCancelled = (payload) => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
      upsertStatus({
        ...payload,
        activeDownload: false,
        status: 'cancelled',
        source: payload?.source || 'preload'
      });
      hideTimerRef.current = setTimeout(() => setDownloadStatus(null), 2000);
    };

    if (api.onAsrModelDownloadStarted) {
      cleanups.push(api.onAsrModelDownloadStarted(handleStart));
    }
    if (api.onAsrModelDownloadProgress) {
      cleanups.push(api.onAsrModelDownloadProgress(handleProgress));
    }
    if (api.onAsrModelDownloadComplete) {
      cleanups.push(api.onAsrModelDownloadComplete(handleComplete));
    }
    if (api.onAsrModelDownloadError) {
      cleanups.push(api.onAsrModelDownloadError(handleError));
    }
    if (api.onAsrModelDownloadCancelled) {
      cleanups.push(api.onAsrModelDownloadCancelled(handleCancelled));
    }

    return () => {
      cleanups.forEach((cleanup) => {
        if (typeof cleanup === 'function') {
          cleanup();
        }
      });
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.on) {
      return undefined;
    }

    const safeNumber = (value) => (typeof value === 'number' && !Number.isNaN(value) ? value : null);

    const handleHudLoading = (payload = {}) => {
      if (hudNoticeTimerRef.current) {
        clearTimeout(hudNoticeTimerRef.current);
      }
      const waitedSeconds = safeNumber(payload.waitedSeconds);
      const message = payload.message
        || (payload.downloading
          ? '正在下载语音模型，首次下载可能较慢，请耐心等待...'
          : 'ASR 模型正在加载，HUD 将在就绪后自动打开');
      setHudNotice({
        message,
        waitedSeconds,
        ready: false,
        downloading: Boolean(payload.downloading)
      });
      if (api.log) {
        try {
          const waitedLabel = waitedSeconds !== null ? `（已等待 ${waitedSeconds.toFixed(1)}s）` : '';
          api.log(`[HUD] ${message}${waitedLabel}`);
        } catch (error) {
          console.warn('[HUD] 记录日志失败:', error);
        }
      }
    };

    const handleHudReady = (payload = {}) => {
      const waitedSeconds = safeNumber(payload.waitedSeconds);
      setHudNotice((prev) => ({
        message: payload.message || 'ASR 模型已就绪，正在打开 HUD',
        waitedSeconds: waitedSeconds ?? prev?.waitedSeconds ?? null,
        ready: true
      }));
      if (hudNoticeTimerRef.current) {
        clearTimeout(hudNoticeTimerRef.current);
      }
      hudNoticeTimerRef.current = setTimeout(() => setHudNotice(null), 3000);
    };

    api.on('hud-loading', handleHudLoading);
    api.on('hud-ready', handleHudReady);

    return () => {
      api.removeListener?.('hud-loading', handleHudLoading);
      api.removeListener?.('hud-ready', handleHudReady);
      if (hudNoticeTimerRef.current) {
        clearTimeout(hudNoticeTimerRef.current);
      }
    };
  }, []);

  const handleMinimize = () => {
    window.electronAPI?.minimizeWindow();
  };

  const handleClose = () => {
    window.electronAPI?.closeWindow();
  };

  return (
    <div style={{ 
      display: 'flex', 
      height: '100vh', 
      width: '100vw', 
      backgroundColor: 'transparent', 
      padding: 0, 
      boxSizing: 'border-box'
    }}>
      <div style={{
        flex: 1,
        display: 'flex',
        borderRadius: '24px',
        overflow: 'visible',
        backgroundColor: '#f8f6f7',
        position: 'relative',
        border: '1px solid rgba(255,255,255,0.5)'
      }}>
        {/* Window Drag Region */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '40px',
          WebkitAppRegion: 'drag',
          zIndex: 50
        }} />

        {/* Window Controls */}
        <div style={{
          position: 'absolute',
          top: '12px',
          right: '16px',
          zIndex: 60,
          display: 'flex',
          gap: '8px',
          WebkitAppRegion: 'no-drag'
        }}>
          <button
            onClick={handleMinimize}
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              border: 'none',
              background: 'rgba(0, 0, 0, 0.05)',
              color: '#666',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '18px',
              transition: 'background 0.2s'
            }}
            onMouseOver={(e) => e.currentTarget.style.background = 'rgba(0, 0, 0, 0.1)'}
            onMouseOut={(e) => e.currentTarget.style.background = 'rgba(0, 0, 0, 0.05)'}
            title="最小化"
          >
            -
          </button>
          <button
            onClick={handleClose}
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              border: 'none',
              background: 'rgba(197, 22, 98, 0.1)',
              color: '#c51662',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '14px',
              transition: 'all 0.2s'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = '#c51662';
              e.currentTarget.style.color = 'white';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = 'rgba(197, 22, 98, 0.1)';
              e.currentTarget.style.color = '#c51662';
            }}
            title="关闭"
          >
            ✕
          </button>
        </div>

        {/* 左侧导航栏 */}
        <aside style={{ display: 'flex', height: '100%', width: '180px', flexDirection: 'column', justifyContent: 'space-between', background: 'linear-gradient(to bottom, #d81b60, #8e24aa)', padding: '16px', color: 'white', paddingTop: '50px' }}>
          <div className="flex flex-col gap-6">
            {/* Logo */}
            <div className="flex flex-col items-center gap-3 px-2">
              <div 
                className="flex items-center justify-center rounded-full overflow-hidden"
                style={{
                  width: '56px',
                  height: '56px',
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  padding: '4px'
                }}
              >
                <svg 
                  className="anim-active exp-cute" 
                  viewBox="0 0 200 200" 
                  xmlns="http://www.w3.org/2000/svg"
                  style={{ width: '100%', height: '100%' }}
                >
                  <defs>
                    <filter id={`glow-${logoId}`} x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="2.5" result="blur" />
                      <feComposite in="SourceGraphic" in2="blur" operator="over" />
                    </filter>
                    
                    <style>
                      {`
                        @keyframes breathe-${logoId} {
                          0%, 100% { transform: scale(1) translateY(0); }
                          50% { transform: scale(1.03) translateY(-2px); }
                        }
                        
                        @keyframes headFloat-${logoId} {
                          0%, 100% { transform: rotate(0deg) translateY(0); }
                          50% { transform: rotate(1deg) translateY(1px); }
                        }
                        
                        @keyframes tailWag-${logoId} {
                          0%, 100% { transform: rotate(-12deg); }
                          50% { transform: rotate(18deg); }
                        }
                        
                        @keyframes blink-${logoId} {
                          0%, 90%, 100% { transform: scaleY(1); }
                          95% { transform: scaleY(0.1); }
                        }
                        
                        @keyframes earTwitchLeft-${logoId} {
                          0%, 90%, 100% { transform: rotate(0deg); }
                          92% { transform: rotate(-10deg); }
                          94% { transform: rotate(0deg); }
                        }
                        
                        @keyframes earTwitchRight-${logoId} {
                          0%, 70%, 100% { transform: rotate(0deg); }
                          72% { transform: rotate(10deg); }
                          74% { transform: rotate(0deg); }
                        }
                        
                        #catTorsoGroup-${logoId} {
                          animation: breathe-${logoId} 4s ease-in-out infinite;
                          transform-origin: bottom center;
                        }
                        
                        #headGroup-${logoId} {
                          animation: headFloat-${logoId} 5s ease-in-out infinite;
                          transform-origin: center 80px;
                        }
                        
                        #tail-${logoId} {
                          animation: tailWag-${logoId} 3s ease-in-out infinite;
                          transform-origin: 130px 150px;
                        }
                        
                        .eye-shape-${logoId} {
                          animation: blink-${logoId} 4s infinite;
                          transform-origin: center;
                          transform-box: fill-box;
                        }
                        
                        #earL-${logoId} {
                          animation: earTwitchLeft-${logoId} 7s infinite;
                          transform-origin: bottom right;
                          transform-box: fill-box;
                        }
                        
                        #earR-${logoId} {
                          animation: earTwitchRight-${logoId} 9s infinite;
                          transform-origin: bottom left;
                          transform-box: fill-box;
                        }
                      `}
                    </style>
                  </defs>
                  
                  <path id={`bgShape-${logoId}`} d="" fill="#3f3f46" opacity="0" />

                  <g id={`mainCat-${logoId}`} fill="none" stroke="#ffffff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
                    <path id={`tail-${logoId}`} d="M130 150 Q170 150 170 100" />
                    
                    <g id={`catTorsoGroup-${logoId}`}>
                      <path id={`body-${logoId}`} d="M70 170 L130 170 Q140 170 135 150 L120 90 Q100 80 80 90 L65 150 Q60 170 70 170 Z" />
                      <path id={`legs-${logoId}`} d="M85 170 L85 130 M115 170 L115 130" />

                      <g id={`headGroup-${logoId}`}>
                        <path id={`headShape-${logoId}`} d="M65 70 Q65 35 100 35 Q135 35 135 70 Q135 105 100 105 Q65 105 65 70 Z" fill="rgba(255,255,255,0.1)" />
                        
                        <path id={`earL-${logoId}`} d="M75 45 L65 20 L90 38" fill="rgba(255,255,255,0.1)" strokeLinejoin="round"/>
                        <path id={`earR-${logoId}`} d="M125 45 L135 20 L110 38" fill="rgba(255,255,255,0.1)" strokeLinejoin="round"/>

                        <g id={`faceFeatures-${logoId}`} strokeWidth="5">
                          <path id={`eyeL-${logoId}`} className={`eye-shape-${logoId}`} d="M80 70 L80 70.01" strokeWidth="9"/>
                          <path id={`eyeR-${logoId}`} className={`eye-shape-${logoId}`} d="M120 70 L120 70.01" strokeWidth="9"/>
                          
                          <path id={`nose-${logoId}`} d="M95 80 L105 80 L100 85 Z" fill="currentColor" stroke="none"/>
                          <path id={`mouth-${logoId}`} d="M100 85 L100 90 M90 90 Q100 90 100 85 Q100 90 110 90" strokeWidth="4"/>
                          
                          <g strokeWidth="3" opacity="0.6">
                            <path d="M130 75 L150 70 M130 80 L155 80 M130 85 L150 90" />
                            <path d="M70 75 L50 70 M70 80 L45 80 M70 85 L50 90" />
                          </g>
                        </g>
                      </g>
                    </g>
                  </g>
                </svg>
              </div>
              <h1 className="text-white text-base font-bold leading-normal text-center">LiveGalGame</h1>
            </div>

            {/* 导航菜单 */}
            <nav className="flex flex-col gap-2">
              <Link
                to="/"
                className={`nav-item flex items-center gap-3 px-3 py-2 rounded transition-colors ${
                  isActive('/')
                    ? 'bg-white/20 text-white'
                    : 'text-white/80 hover:bg-white/10'
                }`}
              >
                <span 
                  className="material-symbols-outlined"
                  style={{ fontVariationSettings: isActive('/') ? "'FILL' 1" : "'FILL' 0" }}
                >
                  dashboard
                </span>
                <p className="text-sm font-medium leading-normal">总览</p>
              </Link>
              <Link
                to="/characters"
                className={`nav-item flex items-center gap-3 px-3 py-2 rounded transition-colors ${
                  isActive('/characters')
                    ? 'bg-white/20 text-white'
                    : 'text-white/80 hover:bg-white/10'
                }`}
              >
                <span 
                  className="material-symbols-outlined"
                  style={{ fontVariationSettings: isActive('/characters') ? "'FILL' 1" : "'FILL' 0" }}
                >
                  groups
                </span>
                <p className="text-sm font-medium leading-normal">攻略对象</p>
              </Link>
              <Link
                to="/conversations"
                className={`nav-item flex items-center gap-3 px-3 py-2 rounded transition-colors ${
                  isActive('/conversations')
                    ? 'bg-white/20 text-white'
                    : 'text-white/80 hover:bg-white/10'
                }`}
              >
                <span 
                  className="material-symbols-outlined"
                  style={{ fontVariationSettings: isActive('/conversations') ? "'FILL' 1" : "'FILL' 0" }}
                >
                  history
                </span>
                <p className="text-sm font-medium leading-normal">历史对话</p>
              </Link>
              <Link
                to="/settings"
                className={`nav-item flex items-center gap-3 px-3 py-2 rounded transition-colors ${
                  isActive('/settings')
                    ? 'bg-white/20 text-white'
                    : 'text-white/80 hover:bg-white/10'
                }`}
              >
                <span 
                  className="material-symbols-outlined"
                  style={{ fontVariationSettings: isActive('/settings') ? "'FILL' 1" : "'FILL' 0" }}
                >
                  settings
                </span>
                <p className="text-sm font-medium leading-normal">设置</p>
              </Link>
            </nav>
          </div>
        </aside>

        {/* 主内容区域 */}
        <main className="flex-1 overflow-y-auto" style={{ paddingTop: '40px' }}>
          {hudNotice && (
            <div className="px-6 pt-4">
              <div className={`rounded-xl border ${hudNotice.ready ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'} shadow-sm`}>
                <div className="flex items-start justify-between gap-3 px-4 py-3">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">
                      {hudNotice.ready ? 'ASR 模型已就绪，正在打开 HUD' : 'ASR 模型加载中，HUD 将在就绪后弹出'}
                    </div>
                    <div className="text-xs text-gray-700 mt-1">
                      {hudNotice.message}
                      {typeof hudNotice.waitedSeconds === 'number'
                        ? `（已等待 ${hudNotice.waitedSeconds.toFixed(1)}s）`
                        : ''}
                    </div>
                  </div>
                  <button
                    className="text-gray-500 hover:text-gray-700 text-sm"
                    onClick={() => setHudNotice(null)}
                    title="关闭提示"
                    style={{ WebkitAppRegion: 'no-drag' }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
          )}
          {downloadStatus && (
            <div className="px-6 pt-4">
              <div className="rounded-xl border border-blue-200 bg-white shadow-sm">
                <div className="flex items-start justify-between gap-3 px-4 py-3">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">
                      ASR 模型下载中（首次运行可能较久）
                    </div>
                    <div className="text-xs text-gray-600 mt-1">
                      {downloadStatus.status === 'complete'
                        ? '下载完成，语音识别已就绪'
                        : downloadStatus.status === 'error'
                          ? `下载失败：${downloadStatus.message || '请检查网络后重试'}`
                          : '后台正在准备语音模型，请保持应用运行'}
                    </div>
                  </div>
                  <button
                    className="text-gray-500 hover:text-gray-700 text-sm"
                    onClick={() => setDownloadStatus(null)}
                    title="关闭提示"
                    style={{ WebkitAppRegion: 'no-drag' }}
                  >
                    ✕
                  </button>
                </div>
                <div className="px-4 pb-4">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-blue-500"
                      style={{
                        width: `${calculateProgress(
                          downloadStatus.downloadedBytes || 0,
                          downloadStatus.totalBytes || downloadStatus.sizeBytes || 0
                        )}%`
                      }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-gray-600">
                    <span>
                      {formatBytes(downloadStatus.downloadedBytes || 0)} / {formatBytes(downloadStatus.totalBytes || downloadStatus.sizeBytes || 0)} ({calculateProgress(
                        downloadStatus.downloadedBytes || 0,
                        downloadStatus.totalBytes || downloadStatus.sizeBytes || 0
                      )}%)
                    </span>
                    <span>速度：{formatSpeed(downloadStatus.bytesPerSecond)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}

export default Layout;
