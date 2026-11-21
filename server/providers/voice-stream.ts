import type { InterviewUpdate, TurnRequest } from '@/domain/types';
import { responseStyleErrors } from '@/domain/response-style';
import { AppError } from '@/server/errors';
import { ModelOutputError } from './real-agent';

const jsonPrefix = ['{', '"assistantText"', ':', '"'];
const invalidText = () => new ModelOutputError('上次 assistantText 的 JSON 字符串不合法。请先输出该字段并使用合法转义。');

/** Only the declared first field is eligible for early speech. Other orderings
 * still reach full JSON validation without playing a prefix from another field. */
export class JsonFieldTextExtractor {
  private buffer = '';
  private state: 'prefix' | 'text' | 'complete' | 'deferred' = 'prefix';
  private prefixToken = 0;
  private prefixOffset = 0;
  private escape = '';
  private highSurrogate = '';

  get raw(): string { return this.buffer; }
  get complete(): boolean { return this.state === 'complete'; }

  push(chunk: string): string {
    this.buffer += chunk;
    let decoded = '';
    for (let i = 0; i < chunk.length; i++) {
      if (this.state === 'complete' || this.state === 'deferred') break;
      const char = chunk[i];
      if (this.state === 'prefix') {
        if (!this.prefixOffset && /[ \r\t\n]/.test(char)) continue;
        if (char !== jsonPrefix[this.prefixToken][this.prefixOffset++]) {
          this.state = 'deferred';
        } else if (this.prefixOffset === jsonPrefix[this.prefixToken].length) {
          this.prefixOffset = 0;
          if (++this.prefixToken === jsonPrefix.length) this.state = 'text';
        }
        continue;
      }
      if (this.escape) {
        this.escape += char;
        if (this.escape[1] === 'u' && this.escape.length < 6) {
          if (this.escape.length > 2 && !/^[\da-f]$/i.test(char)) throw invalidText();
          continue;
        }
        let unit: string;
        try { unit = JSON.parse('"' + this.escape + '"'); } catch { throw invalidText(); }
        this.escape = '';
        decoded += this.decodeUnit(unit);
      } else if (char === '"') {
        if (this.highSurrogate) throw invalidText();
        this.state = 'complete';
      } else if (char === '\\') {
        this.escape = '\\';
      } else {
        if (char.charCodeAt(0) < 0x20) throw invalidText();
        decoded += this.decodeUnit(char);
      }
    }
    return decoded;
  }

  private decodeUnit(unit: string): string {
    const code = unit.charCodeAt(0);
    const low = code >= 0xdc00 && code <= 0xdfff;
    if (this.highSurrogate) {
      if (!low) throw invalidText();
      const pair = this.highSurrogate + unit;
      this.highSurrogate = '';
      return pair;
    }
    if (low) throw invalidText();
    if (code >= 0xd800 && code <= 0xdbff) {
      this.highSurrogate = unit;
      return '';
    }
    return unit;
  }
}

export class SentenceBuffer {
  private pending = '';
  private length = 0;
  private first = true;

  push(text: string): string[] {
    const ready: string[] = [];
    for (const char of text) {
      this.pending += char;
      if (!/\s/u.test(char)) this.length++;
      if ((this.length >= 6 && /[。！？!?;；]/.test(char)) || (this.first && this.length >= 18 && /[，,、]/.test(char))) {
        ready.push(this.pending);
        this.pending = '';
        this.length = 0;
        this.first = false;
      }
    }
    return ready;
  }

  finish(): string[] {
    const rest = this.pending;
    this.pending = '';
    this.length = 0;
    return rest.trim() ? [rest] : [];
  }
}

/** Check all decoded speech so far. A split cannot hide an earlier opener,
 * forbidden phrase, unmatched stage direction or accumulating style limit. */
export function isSafeVoicePrefix(text: string, input: TurnRequest, supportGuidance?: boolean, interviewStage?: InterviewUpdate['stage']): boolean {
  return !responseStyleErrors(text, input, supportGuidance, interviewStage).length
    && !/`|\*|!\[|\[[^\]\n]*]\(|^\s*>\s|(?:^|\s)_[^_\s]/m.test(text)
    && !/[（(](?:叹气|微笑|拥抱|抱住|摸头|轻声|温柔地)/.test(text);
}

const id3 = [0x49, 0x44, 0x33];
const invalidMp3 = () => new AppError('PROVIDER_UNAVAILABLE', 502, true);

/** Drop only leading ID3v2 tags, including headers split across provider chunks. */
export async function* stripId3v2Header(source: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
  const header = new Uint8Array(10);
  let length = 0, skip = 0, audioStarted = false;
  for await (const chunk of source) {
    if (!chunk.length) continue;
    if (audioStarted) { yield chunk; continue; }
    let offset = 0;
    while (offset < chunk.length) {
      if (skip) {
        const taken = Math.min(skip, chunk.length - offset);
        skip -= taken; offset += taken;
        continue;
      }
      const prior = length, start = offset;
      const take = Math.min((length < 3 ? 3 : 10) - length, chunk.length - offset);
      header.set(chunk.subarray(offset, offset + take), length);
      length += take; offset += take;
      if (header.subarray(0, Math.min(3, length)).some((byte, i) => byte !== id3[i])) {
        length = 0;
        audioStarted = true;
        if (prior) yield header.slice(0, prior);
        yield chunk.subarray(start);
        break;
      }
      if (length === 10) {
        const version = header[3], size = header.subarray(6);
        if (version < 2 || version > 4 || header[4] === 0xff || size.some(byte => byte > 0x7f)) throw invalidMp3();
        skip = size.reduce((total, byte) => total * 128 + byte, 0) + (version === 4 && (header[5] & 0x10) ? 10 : 0);
        length = 0;
      }
    }
  }
  if (skip || length >= 3) throw invalidMp3();
  if (length) yield header.slice(0, length);
}
