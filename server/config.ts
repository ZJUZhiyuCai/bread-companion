import type { Capabilities } from '@/domain/types';
import { serverEnv } from './runtime';
import { CALL_GREETING } from '@/domain/call-greeting';
export function config() {
  const env = serverEnv();
  return {
    publicOrigin: env.BREAD_PUBLIC_ORIGIN,
    agentProvider: env.AGENT_PROVIDER === 'real' ? 'real' as const : 'mock' as const,
    agentBaseUrl: env.AGENT_BASE_URL || 'http://127.0.0.1:3425/v1',
    agentKey: env.AGENT_API_KEY || '',
    agentModel: env.AGENT_MODEL || 'wanjie/deepseek-v4.1-flash-1017',
    agentProtocol: env.AGENT_PROTOCOL === 'anthropic' ? 'anthropic' as const : 'openai' as const,
    companionModel: env.AGENT_COMPANION_MODEL || '',
    companionProtocol: env.AGENT_COMPANION_PROTOCOL === 'anthropic' ? 'anthropic' as const : 'openai' as const,
    callModel: env.AGENT_CALL_MODEL || '',
    callProtocol: env.AGENT_CALL_PROTOCOL === 'anthropic' ? 'anthropic' as const : 'openai' as const,
    agentTimeout: Math.min(90000, Math.max(1000, Number(env.AGENT_TIMEOUT_MS) || 45000)),
    companionTimeout: Math.min(30000, Math.max(1000, Number(env.COMPANION_TIMEOUT_MS) || 15000)),
    miniKey: env.MINIMAX_API_KEY || '',
    miniBaseUrl: env.MINIMAX_BASE_URL || 'https://api.minimax.cn/v1',
    tts: env.TTS_PROVIDER === 'minimax', asr: env.ASR_PROVIDER === 'minimax',
    voice: env.MINIMAX_VOICE_ID || 'Chinese (Mandarin)_Warm_Bestie',
    speechModel: env.MINIMAX_TTS_MODEL || 'speech-2.8-hd',
    asrModel: env.MINIMAX_ASR_MODEL || 'asr-1.0',
    speechSpeed: Math.min(2, Math.max(0.5, Number(env.MINIMAX_VOICE_SPEED) || 1)),
    speechTimeout: Math.min(60000, Math.max(1000, Number(env.SPEECH_TIMEOUT_MS) || 30000)),
    mockDelay: Math.min(5000, Math.max(0, Number(env.MOCK_DELAY_MS) || 400)),
  };
}
export function getCapabilities(): Capabilities {
  const env = serverEnv();
  const c = config();
  const family = (model: string) => /deepseek/i.test(model) ? 'DeepSeek' : /doubao|seed/i.test(model) ? '豆包' : /glm/i.test(model) ? 'GLM' : /minimax/i.test(model) ? 'MiniMax' : /gemini/i.test(model) ? 'Gemini' : '文本模型';
  const engines = [...new Set([family(c.companionModel || c.agentModel), family(c.callModel || c.companionModel || c.agentModel), family(c.agentModel)])].join(' + ');
  const label = c.agentProvider === 'mock' ? '规则演示 · Mock' : `${engines}${c.publicOrigin ? '' : ' · Magpie'}`;
  const processors = (c.companionModel ? `文字倾听由${env.AGENT_COMPANION_PROCESSOR_LABEL || '配置的陪伴模型接入服务'}、整理和复盘由${env.AGENT_PROCESSOR_LABEL || '配置的分析模型接入服务'}` : `由${env.AGENT_PROCESSOR_LABEL || '配置的文本接入服务'}`) + (c.callModel ? `、电话聊天由${env.AGENT_CALL_PROCESSOR_LABEL || '配置的电话模型接入服务'}` : '');
  return { agent: { mode: c.agentProvider, label, configured: c.agentProvider === 'mock' || !!c.agentKey },
    asr: { available: c.asr && !!c.miniKey, label: 'MiniMax 语音转写', ...(!c.asr || !c.miniKey ? { reason: '转写服务未配置，可继续使用文字。' } : {}) },
    tts: { available: c.tts && !!c.miniKey, label: 'MiniMax · 温暖闺蜜', ...(c.tts && c.miniKey && c.voice === CALL_GREETING.voice && c.speechModel === CALL_GREETING.model && c.speechSpeed === CALL_GREETING.speed ? { greeting: CALL_GREETING.url } : {}), ...(!c.tts || !c.miniKey ? { reason: '播报服务未配置，回复仍以文字显示。' } : {}) },
    limits: { maxInputChars: 4000, maxSourceChars: 20000, maxAudioBytes: 44 + 65 * 32000, maxRecordingSeconds: 60 },
    processingNotice: c.agentProvider === 'real' ? `当前问题、最近相关对话和所选材料经${c.publicOrigin ? '本站服务器' : '本机 Magpie 路由'}，${processors}处理。转写和播报分别把音频或回复文本发给 MiniMax。接通电话后，停顿会自动转写、发送与播放；面包说话时也会在本机检测你的开口，以便打断。静音关闭收音，挂断停止麦克风、播报和后续发送，取消未完成请求。本应用不在服务端保存正文；已经发送的内容和服务商保留记录无法由本机撤回，具体保留规则尚未核验。` : '当前文字使用规则演示，不发送给文本模型。若语音已启用，录音和播报内容会发给 MiniMax；接通电话后会自动转写、发送与播放，并在本机检测开口打断。对话默认只在当前页面，保存需由你主动选择。' };
}
