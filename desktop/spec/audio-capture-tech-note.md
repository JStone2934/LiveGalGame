音频捕获技术方案（麦克风 + 系统音频）

目标
- 同时捕获用户麦克风与对方（应用）系统音频，进行双通道转写与上下文分析。
- 在 Windows 与 macOS 上以 Electron 提供一致体验。

方案总览
1) 麦克风：标准 getUserMedia({ audio: true })，设备可选；回声消除/降噪开启。
2) 系统音频：
   - Windows：Electron desktopCapturer 选择 Entire Screen + audio:true（底层走 WASAPI Loopback）。
   - macOS：desktopCapturer 捕获屏幕并勾选系统音频（需屏幕录制权限）；若某些版本无系统音轨，则引导安装虚拟声卡（如 BlackHole）并将其设为输出-输入桥。
3) 合并/分发：将 micStream 与 sysStream 分发到各自 ASR 管线；必要时做对齐与去混叠。

权限与提示
- Windows：首次无需显式系统音频权限；仅麦克风权限提示。
- macOS：需要“屏幕录制”权限以捕获系统音频轨，以及“麦克风”权限；需文案解释用途。

时序与数据流
- 设备枚举 → 选择设备 → 启动 micStream 与 sysStream → VAD/分段 → ASR（本地或远端）→ 渲染器显示转写。
- 采样率统一至 16k/24k（与 ASR 兼容），采用 WebAudio 或 AudioWorklet 做重采样。

示例（伪代码）

```ts
// 获取麦克风
const mic = await navigator.mediaDevices.getUserMedia({
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
});

// 获取系统音频（带屏幕）
const sources = await desktopCapturer.getSources({ types: ['screen'], fetchWindowIcons: false });
const sys = await navigator.mediaDevices.getUserMedia({
  audio: { mandatory: { chromeMediaSource: 'desktop' } },
  video: {
    mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sources[0].id }
  }
});

// 仅使用音轨
const sysAudio = new MediaStream(sys.getAudioTracks());

// 分发到 ASR
asr.consume('mic', mic);
asr.consume('sys', sysAudio);
```

性能与稳定性
- 将捕获与编码/重采样放在 AudioWorklet 或 Worker，避免阻塞 UI。
- 控制内存与延迟：每段 2-5 秒；启用背压丢弃过期片段。

降级策略
- macOS 若无法获取系统音轨：引导用户选择虚拟声卡输出；或只启用麦克风通道（提示功能受限）。


