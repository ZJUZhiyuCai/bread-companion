import type { Activity, CallPhase, CallState, Capabilities } from '@/domain/types';
import type { BuddyState } from './BreadBuddy';
import type { AvatarState } from './labels';

/** Said once, before anyone taps the phone: how a call works, in one natural sentence. */
export const CALL_PREFACE = '接通后直接说就好。你停一下，面包就接话；它说话时想插话，点一下就行。';

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

export function callMeta(call: CallState): { title: string; hint: string } {
  switch (call.phase) {
    case 'idle':
      return { title: '还没接通', hint: '' };
    case 'connecting':
      return { title: '正在接通', hint: '在打开麦克风。浏览器问你时，选“允许”就好。' };
    case 'listening':
      return call.heardSpeech
        ? { title: '在听，你说', hint: '说完停一下，面包就接话；也可以点“说完了”。' }
        : { title: '在听你说', hint: '想到什么说什么，慢一点也没关系。' };
    case 'transcribing':
      return { title: '在听清你说的', hint: '马上就好。想重说，点“插话”。' };
    case 'thinking':
      return { title: '在想怎么回你', hint: '想插话就点“插话”，它会停下来听你。' };
    case 'speaking':
      return { title: '面包在说', hint: '想插话随时点，它会马上停下来听你。' };
    case 'muted':
      return { title: '你静音了', hint: '面包现在听不到你。想说的时候，点“打开麦克风”。' };
    case 'paused':
      return { title: '通话暂停了', hint: '麦克风关上了。想继续就点“继续通话”，或者挂断后接着打字。' };
    case 'error':
      return { title: '这次没接上', hint: '可以再试一次，或者挂断后接着打字。刚才的文字都还在。' };
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
      return 'asleep';
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
  connecting: '戴上耳机…',
  asking: '等你允许麦克风。',
  recording: '在听这一段。',
  muted: '你静音了，我等着。',
  paused: '先停一下，不着急。',
  error: '出了点小问题，打字还能用。',
  asleep: '晚安。',
};

/** Text-mode activities that hold the microphone or speaker; a call has to take over from them. */
export const AUDIO_ACTIVITIES: Activity[] = ['requesting_mic', 'recording', 'recorded', 'transcribing', 'speaking'];

/** Why a call can't start right now, or '' if it can. Never pretends to connect. */
export function callBlockReason(caps: Capabilities | null): string {
  if (!caps) return '还在检查语音能力';
  if (!caps.agent.configured) return '面包的回复服务暂时没接好，稍后再试';
  if (!caps.asr.available) return `现在打不了电话${caps.asr.reason ? `（${caps.asr.reason}）` : ''}，打字照样可以`;
  if (!caps.tts.available) return `面包现在发不出声音${caps.tts.reason ? `（${caps.tts.reason}）` : ''}，打字照样可以`;
  return '';
}
