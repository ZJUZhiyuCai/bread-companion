import type { Activity, CallPhase, CallState, Capabilities } from '@/domain/types';
import type { BuddyState } from './BreadBuddy';
import type { AvatarState } from './labels';

/**
 * The phone button's own description. Not printed on the page — "打电话" needs no manual, and the real
 * gate is the browser's permission prompt. It stays for screen readers, where the consequence of
 * pressing isn't otherwise visible.
 */
export const CALL_PREFACE = '网页里和 AI 的语音对话，会先请求麦克风权限。接通后直接说话就行。';

export const IDLE_CALL: CallState = {
  active: false,
  phase: 'idle',
  muted: false,
  elapsedSeconds: 0,
  level: 0,
  heardSpeech: false,
  lastHeard: '',
  caption: '',
  error: '',
};

/** The call room is on screen whenever a call is running or still has something to say (paused, error). */
export function isCallOpen(call: CallState): boolean {
  return call.active || call.phase !== 'idle';
}

/** Phases in which the microphone or speaker may be busy; a modal would put the controls out of reach. */
export const CALL_RUNNING: CallPhase[] = ['connecting', 'listening', 'transcribing', 'thinking', 'speaking', 'muted'];

/**
 * One short line per phase, in 面包's own voice. `hint` is only for the four phases where something
 * about the device or the error genuinely needs saying — the running phases say nothing, because the
 * keys carry their own names and speaking up no longer needs instructions.
 *
 * 转写 and 思考 deliberately share a title: which one is running is an implementation detail, and
 * swapping headings twice inside a second just reads as a machine busy with itself.
 */
export function callMeta(call: CallState): { title: string; hint: string } {
  switch (call.phase) {
    case 'idle':
      return { title: '还没接通', hint: '' };
    case 'connecting':
      return { title: '正在接通', hint: '浏览器问你时，选“允许”就好。' };
    case 'listening':
      return { title: call.heardSpeech ? '嗯，在听' : '在听', hint: '' };
    case 'transcribing':
    case 'thinking':
      return { title: '嗯，让我想想', hint: '' };
    case 'speaking':
      return { title: '面包在说', hint: '' };
    case 'muted':
      return { title: '你静音了', hint: '面包听不到你。' };
    case 'paused':
      return { title: '通话暂停了', hint: '麦克风关上了。' };
    case 'error':
      return { title: '这次没接上', hint: '刚才的文字都还在。' };
  }
}

export function buddyForCall(call: CallState): BuddyState {
  switch (call.phase) {
    case 'connecting':
      return 'connecting';
    case 'listening':
      return call.heardSpeech ? 'hearing' : 'listening';
    case 'transcribing':
      return 'transcribing';
    case 'thinking':
      return 'thinking';
    case 'speaking':
      return 'speaking';
    case 'muted':
      return 'muted';
    case 'paused':
      return 'paused';
    case 'error':
      return 'error';
    default:
      return 'idle';
  }
}

/** Text-chat activity → what the loaf is doing. `typing` = the user is writing to it right now. */
export function buddyForActivity(a: AvatarState, typing = false): BuddyState {
  switch (a) {
    case 'requesting_mic':
      return 'asking';
    case 'recording':
    case 'recorded':
      return 'recording';
    case 'transcribing':
      return 'transcribing';
    case 'generating':
    case 'validating':
      return 'thinking';
    case 'speaking':
      return 'speaking';
    case 'paused':
      return typing ? 'attentive' : 'paused';
    case 'error':
      return 'error';
    case 'ended':
      return 'night';
    default:
      return typing ? 'attentive' : 'idle';
  }
}

/** One short line in the loaf's own voice. It only ever says what it is doing, never what you feel. */
export const BUDDY_LINE: Record<BuddyState, string> = {
  idle: '我在。想说什么都行。',
  wave: '嗨，我是面包。',
  attentive: '慢慢写，我等你。',
  listening: '在听。',
  hearing: '嗯，我在听。',
  transcribing: '在把你说的转成字。',
  thinking: '嗯，让我想想…',
  speaking: '念给你听。',
  connecting: '电话响了，我来接…',
  asking: '等你允许麦克风。',
  recording: '在听这一段。',
  muted: '你静音了，我等着。',
  paused: '先停一下，不着急。',
  // No promise about what still works: that depends on what failed, and the notice says it exactly.
  error: '刚才出了点问题。',
  night: '晚安。',
};

/**
 * The line 面包 actually says. A failed text reply that can be sent again gets its own line, so the
 * loaf names what happened and the retry next to that message is the obvious next step.
 */
export function buddyLine(state: BuddyState, canRetry = false): string {
  if (state === 'error' && canRetry) return '刚才那句没回上来。';
  return BUDDY_LINE[state];
}

/** Text-mode activities that hold the microphone or speaker; a call has to take over from them. */
export const AUDIO_ACTIVITIES: Activity[] = ['requesting_mic', 'recording', 'recorded', 'transcribing', 'speaking'];

/**
 * Why a call can't start right now, or '' if it can. Never pretends to connect. Kept to one short line:
 * the form beside the phone is already the way back, and the technical reason belongs in the tooltip.
 */
export function callBlockReason(caps: Capabilities | null): string {
  if (!caps) return '还在检查语音能力';
  if (!caps.agent.configured) return '面包暂时接不上，稍后再试';
  if (!caps.asr.available) return '现在打不了电话，先打字吧';
  if (!caps.tts.available) return '面包暂时发不出声音，先打字吧';
  return '';
}

/** The operator's own reason, for the button's tooltip only. */
export function callBlockDetail(caps: Capabilities | null): string {
  if (!caps) return '';
  if (!caps.agent.configured) return '面包的回复服务未配置。';
  if (!caps.asr.available) return caps.asr.reason || '语音转写未配置。';
  if (!caps.tts.available) return caps.tts.reason || '语音合成未配置。';
  return '';
}
