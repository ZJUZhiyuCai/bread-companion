import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserCallAudio, joinCallUtterances } from '@/services/call-audio';
import { CallController } from '@/services/call-controller';
import type { CallAudioEvents } from '@/services/call-audio';
import { encodeWav } from '@/services/media-controller';
import { VoiceActivity } from '@/services/voice-activity';

const rate = 16000;
const tone = (samples: number) => Float32Array.from({ length: samples }, (_, i) => .06 * Math.sin(i * 2 * Math.PI * 213 / rate));
const wav = (seconds: number) => new File([encodeWav(new Float32Array(Math.round(seconds * rate)))], 'turn.wav', { type: 'audio/wav' });

afterEach(() => vi.unstubAllGlobals());

describe('interview capture profiles', () => {
  it('uses the chat gap and extends a buffered answer to the 1.8 second interview gap', () => {
    const voice = new Float32Array(200).fill(.1);
    const vad = new VoiceActivity(1000);
    vad.push(voice);
    expect(vad.push(new Float32Array(649)).utterance).toBeNull();
    expect(vad.push(new Float32Array(1)).utterance?.length).toBe(400);

    vad.push(voice);
    vad.push(new Float32Array(500));
    vad.setConfig({ gapSeconds: 1.8, maxSeconds: 120 });
    expect(vad.push(new Float32Array(1000)).utterance).toBeNull();
    expect(vad.push(new Float32Array(200).fill(.2)).speechStarted).toBe(false);
    expect(vad.push(new Float32Array(1799)).utterance).toBeNull();
    const answer = vad.push(new Float32Array(1)).utterance!;
    expect(answer.length).toBe(2100);
    expect(answer[0]).toBeCloseTo(.1);
    expect(answer[1700]).toBeCloseTo(.2);
  });

  it.each([['chat', 55], ['interview', 120]] as const)('bounds continuous %s speech at %i seconds, including a partial final frame', (profile, maxSeconds) => {
    const vad = new VoiceActivity(1000);
    if (profile === 'interview') vad.setConfig({ gapSeconds: 1.8, maxSeconds });
    for (let i = 0; i < maxSeconds - 1; i++) {
      expect(vad.push(new Float32Array(1000).fill(.1)).utterance).toBeNull();
    }
    expect(vad.push(new Float32Array(990).fill(.1)).utterance).toBeNull();
    expect(vad.push(new Float32Array(40).fill(.1)).utterance?.length).toBe(maxSeconds * 1000);
  });

  it('applies the initial profile on open and switches the browser worklet detector without replacing the mic', async () => {
    let worklet!: Worklet;
    let epoch = 0;
    class Worklet {
      constructor() { worklet = this; }
      connect = vi.fn();
      disconnect = vi.fn();
      port = {
        onmessage: null as ((event: { data: { samples: Float32Array; epoch: number; at: number } }) => void) | null,
        postMessage: (message: { epoch: number }) => { epoch = message.epoch; },
        close: vi.fn(),
      };
    }
    const track = { enabled: false, stop: vi.fn(), onended: null };
    const mic = vi.fn(async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }));
    const close = vi.fn(async () => {});
    vi.stubGlobal('AudioWorkletNode', Worklet);
    vi.stubGlobal('AudioContext', class {
      state = 'running';
      sampleRate = rate;
      destination = {};
      audioWorklet = { addModule: vi.fn(async () => {}) };
      createMediaStreamSource = () => ({ connect: vi.fn(), disconnect: vi.fn() });
      resume = async () => {};
      close = close;
    });
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: mic } });

    const audio = new BrowserCallAudio();
    const utterance = vi.fn<(file: File) => void>();
    const emit = (samples: Float32Array) => worklet.port.onmessage?.({ data: { samples, epoch, at: 0 } });
    try {
      audio.setProfile('interview');
      await expect(audio.open({ utterance, meter: vi.fn(), failure: vi.fn() })).resolves.toBe(true);
      audio.listen(true);
      emit(tone(rate / 5));
      emit(new Float32Array(rate * 1.3));
      expect(utterance).not.toHaveBeenCalled();
      emit(tone(rate / 5));
      emit(new Float32Array(rate * 1.8));
      expect(utterance).toHaveBeenCalledOnce();
      expect(utterance.mock.calls[0][0].size).toBe(44 + 1.9 * rate * 2);

      audio.listen(true);
      emit(tone(rate / 5));
      audio.setProfile('chat');
      expect(track.enabled).toBe(true);
      emit(new Float32Array(rate * .65 - 1));
      expect(utterance).toHaveBeenCalledOnce();
      emit(new Float32Array(1));
      expect(utterance).toHaveBeenCalledTimes(2);
      expect(utterance.mock.calls[1][0].size).toBe(44 + .4 * rate * 2);
      expect(mic).toHaveBeenCalledOnce();
      expect(close).not.toHaveBeenCalled();
      expect(track.stop).not.toHaveBeenCalled();
    } finally { audio.close(); }
  });

  it('retains audio already captured under the longer profile when changing back to chat', () => {
    const vad = new VoiceActivity(1000, 1.8, 120);
    for (let i = 0; i < 70; i++) expect(vad.push(new Float32Array(1000).fill(.1)).utterance).toBeNull();
    vad.setConfig({ gapSeconds: .65, maxSeconds: 55 });
    expect(vad.push(new Float32Array(20)).utterance?.length).toBe(70_000);
  });

  it('joins up to 120 seconds in interview and keeps the default chat cap', async () => {
    const first = Promise.resolve(wav(60));
    await expect(joinCallUtterances(first, wav(59.9), 120)).resolves.toMatchObject({ size: 44 + 120 * rate * 2 });
    await expect(joinCallUtterances(first, wav(60), 120)).rejects.toThrow('这一段有点长');
    await expect(joinCallUtterances(first, wav(1))).rejects.toThrow('这一段有点长');
  });

  it('joins a resumed interview sentence using the live profile cap', async () => {
    let events!: CallAudioEvents;
    const transcribe = vi.fn<(file: File, signal: AbortSignal) => Promise<string>>()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce('这是接着说完的回答。');
    const call = new CallController({
      update: vi.fn(), transcribe, reply: vi.fn(async () => null),
      synthesize: vi.fn(), cancelReply: vi.fn(),
    }, {
      open: async handlers => { events = handlers; return true; },
      listen: vi.fn(), finish: vi.fn(), play: vi.fn(), stopPlayback: vi.fn(), close: vi.fn(),
    });
    try {
      call.setProfile('interview');
      await call.start();
      events.utterance(wav(60));
      await vi.waitFor(() => expect(transcribe).toHaveBeenCalledOnce());
      events.speechStart!();
      events.utterance(wav(40));
      await vi.waitFor(() => expect(call.snapshot.lastHeard).toBe('这是接着说完的回答。'));
      expect(transcribe.mock.calls[0][1].aborted).toBe(true);
      expect(transcribe.mock.calls[1][0].size).toBe(44 + 100.1 * rate * 2);
    } finally { call.hangup(); }
  });
});
