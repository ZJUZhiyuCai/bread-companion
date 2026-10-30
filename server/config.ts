import type { Capabilities } from '@/domain/types';
export function config() {
  return {
    agentProvider: process.env.AGENT_PROVIDER === 'real' ? 'real' as const : 'mock' as const,
    agentBaseUrl: process.env.AGENT_BASE_URL || 'http://127.0.0.1:3425/v1',
    agentKey: process.env.AGENT_API_KEY || '',
    agentModel: process.env.AGENT_MODEL || 'wanjie/deepseek-v4.1-flash-1017',
    agentProtocol: process.env.AGENT_PROTOCOL === 'anthropic' ? 'anthropic' as const : 'openai' as const,
    agentTimeout: Math.min(90000, Math.max(1000, Number(process.env.AGENT_TIMEOUT_MS) || 45000)),
    miniKey: process.env.MINIMAX_API_KEY || '',
    miniBaseUrl: process.env.MINIMAX_BASE_URL || 'https://api.minimax.cn/v1',
    tts: process.env.TTS_PROVIDER === 'minimax', asr: process.env.ASR_PROVIDER === 'minimax',
    voice: process.env.MINIMAX_VOICE_ID || 'Chinese (Mandarin)_Warm_Bestie',
    speechModel: process.env.MINIMAX_TTS_MODEL || 'speech-2.8-hd',
    asrModel: process.env.MINIMAX_ASR_MODEL || 'asr-1.0',
    speechSpeed: Math.min(2, Math.max(0.5, Number(process.env.MINIMAX_VOICE_SPEED) || 1)),
    speechTimeout: Math.min(60000, Math.max(1000, Number(process.env.SPEECH_TIMEOUT_MS) || 30000)),
    mockDelay: Math.min(5000, Math.max(0, Number(process.env.MOCK_DELAY_MS) || 400)),
  };
}
export function getCapabilities(): Capabilities {
  const c = config();
  const label = c.agentProvider === 'mock' ? '规则演示 · Mock' : 'DeepSeek · Magpie';
  return { agent: { mode: c.agentProvider, label, configured: c.agentProvider === 'mock' || !!c.agentKey },
    asr: { available: c.asr && !!c.miniKey, label: 'MiniMax 语音转写', ...(!c.asr || !c.miniKey ? { reason: '转写服务未配置，可继续使用文字。' } : {}) },
    tts: { available: c.tts && !!c.miniKey, label: 'MiniMax 语音播报', ...(!c.tts || !c.miniKey ? { reason: '播报服务未配置，回复仍以文字显示。' } : {}) },
    limits: { maxInputChars: 4000, maxSourceChars: 20000, maxAudioBytes: 10 * 1024 * 1024, maxRecordingSeconds: 60 },
    processingNotice: c.agentProvider === 'real' ? `发送后，当前问题、最近相关对话和所选材料由本机 Magpie 路由给${process.env.AGENT_PROCESSOR_LABEL || '配置的 DeepSeek 接入服务'}处理。录音转写和点击播放会分别把音频或回复文本发给 MiniMax。供应商的数据保留规则尚未逐项核验，请只提供愿意交给这些服务的内容。本应用不在服务端保存正文。` : '当前文字使用本机规则演示，不发送给文本模型。若语音已启用，录音和播报内容会发给 MiniMax。对话默认只在当前页面，保存需由你主动选择。' };
}
