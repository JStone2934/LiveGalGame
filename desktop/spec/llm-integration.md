LLM 集成与配置体验

用户体验（设置 → 连接测试 → 首次成功）
- 模型选择以结果导向文案呈现：
  - 最智能（性能优先）
  - 情感理解好（情感/社交优化）
  - 隐私更强（本地/自建推理）
- 输入 API Key/Endpoint/模型名；“测试连接”触发一次最小请求并显示：
  - 成功/失败、耗时、流式延迟估计；失败提供可执行修复建议（网络/权限/额度）。
- 支持多配置并可设默认；星标为默认模型。

架构与接口
- Provider 插件化：OpenAI、Anthropic、本地 Oobabooga（text-generation-webui 或 OpenAI-compatible）。
- 统一接口：
  - createClient(config)
  - streamCompletion({ system, messages, tools?, temperature?, maxTokens? }) → AsyncIterable<delta>
  - embeddings?(input) → number[]
- 速率限制与并发队列：防止 HUD 产生的多路请求拥塞；错误可重试。

提示工程（简要）
- 系统提示由三部分组成：
  1) 人物档案摘要（昵称、关系、偏好、禁忌）。
  2) 对话上下文摘要（最近 N 轮关键句）。
  3) 目标策略（提高好感/婉拒/推进邀约等）。
- 建议卡模板：标题/一句话/标签/风险提示/效果预测；可 A/B 测试多个模板。

本地化与隐私
- 本地模型：通过 HTTP 兼容接口访问（例如 Oobabooga/openai-compatible）；默认关闭遥测。
- 网络代理：支持自定义代理；建议在下载大模型/资源前执行 `dl1` 启用代理以加速。

错误与降级
- 当云端失败：自动切至备用 Provider；或退化为“建议模板库 + 关键词检索”模式。


