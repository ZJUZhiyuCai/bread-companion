import { describe, expect, it } from 'vitest';
import { requestFixture } from '@/fixtures/scenarios';
import { readAgentSse } from '@/server/providers/agent-sse';
import { JsonFieldTextExtractor, SentenceBuffer, isSafeVoicePrefix, stripId3v2Header } from '@/server/providers/voice-stream';

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const item of source) values.push(item);
  return values;
}
async function* audio(...parts: Uint8Array[]) { yield* parts; }
const u8 = (...bytes: number[]) => Uint8Array.of(...bytes);
const listening = requestFixture({ mode: 'listen', channel: 'call' });

describe('incremental JSON speech', () => {
  it('decodes arbitrary token splits, escaped quotes/path separators, controls and surrogate pairs', () => {
    const raw = '  {\n "assistantText" : "原话：\\"可以\\"，路径 \\\\home\\n换行\\t\\u9762\\u5305\\ud83e\\udd6f 🥯。" , "warnings":[] }';
    const extractor = new JsonFieldTextExtractor();
    const fragments = raw.split('').map(unit => extractor.push(unit));
    expect(fragments).toContain('🥯');
    expect(fragments).not.toContain('\ud83e');
    expect(fragments.join('')).toBe('原话："可以"，路径 \\home\n换行\t面包🥯 🥯。');
    expect(extractor.raw).toBe(raw);
    expect(extractor.complete).toBe(true);
  });

  it('streams before the JSON closes and stops exactly at the end of the field', () => {
    const extractor = new JsonFieldTextExtractor();
    expect(extractor.push('{"assistant')).toBe('');
    expect(extractor.push('Text":"等了这么久。')).toBe('等了这么久。');
    expect(extractor.complete).toBe(false);
    expect(extractor.push('还挺烦的。","warnings":["不能念出来')).toBe('还挺烦的。');
    expect(extractor.complete).toBe(true);
    expect(extractor.push('的内容"]}')).toBe('');
  });

  it('buffers reordered fields and nested lookalikes without queuing accidental speech', () => {
    const extractor = new JsonFieldTextExtractor();
    const raw = '{"warnings":[{"assistantText":"这段不能播放。"}],"assistantText":"等最终核对。"}';
    expect(extractor.push(raw)).toBe('');
    expect(extractor.complete).toBe(false);
    expect(extractor.raw).toBe(raw);
  });

  it.each(['\\x', '\\u12XZ', '\\uDC00', '\\uD800"', '\n'])('rejects invalid JSON text escapes or lone surrogates (%j)', trailing => {
    const extractor = new JsonFieldTextExtractor();
    expect(() => extractor.push('{"assistantText":"前缀' + trailing)).toThrow(expect.objectContaining({ code: 'INVALID_MODEL_OUTPUT' }));
  });
});

describe('sentence boundaries and prefix checks', () => {
  it('emits a substantial first clause, then complete sentences and a residual tail', () => {
    const buffer = new SentenceBuffer();
    expect(buffer.push('嗯，')).toEqual([]);
    expect(buffer.push('等了很长时间才收到这么简短的一句回复，')).toEqual(['嗯，等了很长时间才收到这么简短的一句回复，']);
    expect(buffer.push(' 这一下还挺难受的。我也听到了；')).toEqual([' 这一下还挺难受的。', '我也听到了；']);
    expect(buffer.push('嗯')).toEqual([]);
    expect(buffer.finish()).toEqual(['嗯']);
    expect(buffer.finish()).toEqual([]);
  });

  it('waits for six visible characters and keeps later soft punctuation within the sentence', () => {
    const buffer = new SentenceBuffer();
    expect(buffer.push('好。')).toEqual([]);
    expect(buffer.push('你慢慢说！')).toEqual(['好。你慢慢说！']);
    expect(buffer.push('今天等了很久才知道消息，的确挺不好受的。')).toEqual(['今天等了很久才知道消息，的确挺不好受的。']);
    expect(buffer.push('   ')).toEqual([]);
    expect(buffer.finish()).toEqual([]);
  });

  it.each([
    '怎么又搞砸了？', '有件事想告诉你。你只需要我。', '他们都有眼无珠。', '（轻声，',
    '我们先看 **这个点**。', '接下来看看 *这句，', '保证你一定能拿到 offer。',
    '这一次怎么样？想再说说吗？',
  ])('blocks obvious unsafe or unspeakable prefixes %s', text => {
    expect(isSafeVoicePrefix(text, listening)).toBe(false);
  });

  it('allows a factual correction within a plain reply and respects question preferences', () => {
    expect(isSafeVoicePrefix('不是说你又出了问题，我刚才理解错了。', listening)).toBe(true);
    expect(isSafeVoicePrefix('你想从哪里说起？', { ...listening, context: { ...listening.context, preferences: { questions: 'avoid' } } })).toBe(false);
  });
});

describe('ID3v2 stripping', () => {
  it('removes tags split across arbitrary chunks, including a syncsafe size and an ID3v2.4 footer', async () => {
    const first = u8(73, 68, 51, 4, 0, 0x10, 0, 0, 1, 2);
    const next = u8(73, 68, 51, 3, 0, 0, 0, 0, 0, 3);
    const footer = u8(51, 68, 73, 4, 0, 0x10, 0, 0, 1, 2);
    const frame = u8(0xff, 0xe3, 1, 2);
    const raw = Buffer.concat([first, new Uint8Array(130).fill(5), footer, next, u8(1, 2, 3), frame]);
    const parts = Array.from(raw, byte => u8(byte));
    expect(Buffer.concat(await collect(stripId3v2Header(audio(...parts))))).toEqual(Buffer.from(frame));
  });

  it('passes through undecorated frames and leaves nonleading bytes untouched', async () => {
    const one = u8(0xff, 0xf3), two = u8(73, 68, 51, 4, 0);
    expect(await collect(stripId3v2Header(audio(one, two)))).toEqual([one, two]);
    expect(Buffer.concat(await collect(stripId3v2Header(audio(u8(73), u8(42, 7)))))).toEqual(Buffer.from([73, 42, 7]));
  });

  it('rejects truncated or mis-sized tags before returning any metadata as sound', async () => {
    for (const bytes of [u8(73, 68, 51), u8(73, 68, 51, 3, 0, 0, 0, 0, 0, 4, 1), u8(73, 68, 51, 3, 0, 0, 0x80, 0, 0, 1)]) {
      await expect(collect(stripId3v2Header(audio(bytes)))).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    }
  });
});

describe('bounded model event streams', () => {
  const packet = (text: string) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n';
  const sse = (body: string) => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });

  it('ignores OpenAI usage/chatter, handles CRLF, and checks explicit completion', async () => {
    const reason = 'data: {"choices":[{"delta":{"reasoning_content":"hidden"}}]}\r\n\r\n';
    const usage = 'data: {"choices":[],"usage":{}}\n\n';
    const result = await collect(readAgentSse(sse(': ping\n\n' + reason + packet('面包') + usage + 'data: [DONE]\n\n'), false, AbortSignal.timeout(1000)));
    expect(result).toEqual(['面包']);
    await expect(collect(readAgentSse(sse(packet('partial')), false, AbortSignal.timeout(1000)))).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });

  it('rejects oversized generated text and provider error events with a generic error', async () => {
    for (const [raw, anthropic] of [[packet('x'.repeat(160001)), false], ['event: error\ndata: {"type":"error","secret":"private"}\n\n', true]] as const) {
      await expect(collect(readAgentSse(sse(raw), anthropic, AbortSignal.timeout(1000)))).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    }
  });
});
