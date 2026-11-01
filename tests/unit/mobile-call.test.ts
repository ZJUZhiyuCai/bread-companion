import { describe, expect, it } from 'vitest';
import { microphoneRecoveryHint } from '@/services/call-audio';
import { CaptureHealth } from '@/services/capture-health';
import { VoiceActivity } from '@/services/voice-activity';
import { speechLikeFrame } from '@/services/playback-echo';
import { responseStyleErrors } from '@/domain/response-style';

describe('phone microphone health', () => {
  it('distinguishes no frames, digital silence and quiet but working input', () => {
    const h = new CaptureHealth(); h.reset(100);
    expect(h.check(5099, false)).toBe('ok'); expect(h.check(5100, false)).toBe('stalled');
    h.frame(new Float32Array(1024), 8200); expect(h.check(8200, false)).toBe('silent');
    h.frame(new Float32Array(1024).fill(.0001), 8300); expect(h.check(8300, false)).toBe('ok');
  });
  it('tolerates a short OS mute but detects a persistent mute even with incoming zero frames', () => {
    const h = new CaptureHealth(); h.reset(0);
    expect(h.check(100, true)).toBe('ok'); expect(h.check(2000, true)).toBe('ok');
    h.frame(new Float32Array(1024), 2100); expect(h.check(2100, true)).toBe('muted');
    expect(h.check(2200, false)).toBe('ok'); expect(h.check(4000, true)).toBe('ok');
    h.reset(10000); expect(h.check(10000, false)).toBe('ok');
  });
  for (const rate of [16000, 44100, 48000]) it(`retains quiet speech at ${rate} Hz without weakening interruption or admitting hiss`, () => {
    const vad = new VoiceActivity(rate); let started = false, result: Float32Array | null = null;
    for (let j = 0; j < Math.ceil(rate * .5 / 1024); j++) {
      const frame = Float32Array.from({length:1024}, (_,i) => .005 * Math.sin((i + j * 1024) * 2 * Math.PI * 233 / rate));
      expect(speechLikeFrame(frame)).toBe(false);
      const r = vad.push(frame, speechLikeFrame(frame, .002)); started ||= r.speechStarted;
    }
    for(let j=0;j<Math.ceil(rate / 1024);j++) { const r=vad.push(new Float32Array(1024), false); if(r.utterance)result=r.utterance; }
    expect(started).toBe(true); expect(result).not.toBeNull();
    const hiss = Float32Array.from({length:1024}, (_,i) => i % 2 ? .003 : -.003);
    expect(speechLikeFrame(hiss, .002)).toBe(false);
    expect(speechLikeFrame(new Float32Array(1024).fill(.005), .002)).toBe(false);
  });
});
describe('gentle openings', () => {
  const input = {mode:'listen',channel:'call'} as const;
  it('rejects the reported blaming response and its close variants', () => {
    for(const text of ['又出岔子了？这次是哪儿不太顺。','你怎么又搞砸了？','又失败了？']) expect(responseStyleErrors(text,input)).toContain('STYLE_NO_BLAMING_OPENER');
  });
  it('allows specific acknowledgement, quotation and disagreement with a self-judgment', () => {
    for(const text of ['面试不太顺啊。愿意说说发生了什么吗？','一次没过，不等于你又失败了。','“又出岔子了”这句是我说重了，抱歉。']) expect(responseStyleErrors(text,input)).toEqual([]);
  });
});

it('gives a WeChat-specific browser handoff rather than an iOS-only instruction',()=>{
 expect(microphoneRecoveryHint('Mozilla HarmonyOS MicroMessenger/8.0')).toContain('在微信右上角');
 expect(microphoneRecoveryHint('Mozilla HarmonyOS HuaweiBrowser')).toContain('麦克风权限');
});
