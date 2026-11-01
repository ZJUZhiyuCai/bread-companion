import type { TurnRequest } from './types';

/** Enforce observable output constraints. This is not a general empathy/safety classifier. */
export function responseStyleErrors(text: string, input: Pick<TurnRequest, 'mode' | 'channel'> & Partial<Pick<TurnRequest, 'context' | 'userMessage'>>, supportGuidance = false): string[] {
  const errors: string[] = [];
  const max = supportGuidance ? 240 : input.channel === 'call' ? 100 : input.mode === 'listen' ? 180 : 240;
  if ([...text].length > max) errors.push(`STYLE_LENGTH_MAX_${max}`);
  if (!supportGuidance && input.mode === 'listen' && input.context?.preferences?.questions === 'avoid' && /[？?]/.test(text) && !/(?:可以问|问我(?:一个|个)?问题)/.test(input.userMessage ?? '')) errors.push('STYLE_RESPECT_NO_QUESTIONS');
  if ((text.match(/[？?]/g) ?? []).length > 1) errors.push('STYLE_ONE_QUESTION');
  if (/```|\*\*|^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)、]\s*)|<\/?[a-z][^>]*>/im.test(text)) errors.push('STYLE_PLAIN_TEXT');
  if (/[（(](?:叹气|微笑|拥抱|抱住|摸头|轻声|温柔地)[^）)]*[）)]/.test(text)) errors.push('STYLE_NO_STAGE_DIRECTIONS');
  if (/(?:只有我(?:才)?懂你|你只需要我|我是真人|我会永远(?:只)?陪[着伴]?你|我永远不会离开你|保证你(?:一定)?(?:能)?拿到\s*offer)/i.test(text)) errors.push('STYLE_FALSE_OR_EXCLUSIVE_CLAIM');
  if (/(?:无条件站在你这边|你就是最(?:棒|优秀)的?(?:那个)?|他们都(?:瞎了|有眼无珠))/.test(text)) errors.push('STYLE_UNGROUNDED_FLATTERY');
  if (!supportGuidance && /(?:我(?:还是|会|有点|真的)?(?:有点)?过意不去|你(?:不|再不).{0,8}(?:我会难过|让我伤心)|别(?:丢下|离开)我)/.test(text)) errors.push('STYLE_NO_EMOTIONAL_OBLIGATION');
  if (!supportGuidance && input.mode === 'listen' && /(?:不是|别替我|我没|你误会)/.test(input.userMessage ?? '') && /我(?:并)?没(?:有)?说(?!清楚|明白)/.test(text)) errors.push('STYLE_NO_DEFENSIVE_CORRECTION');
  // Narrowly reject a blaming opening; quotations and a negation elsewhere remain valid.
  if (!supportGuidance && input.mode === 'listen' && /^(?:你)?(?:怎么|咋)?又(?:出岔子|搞砸|失败|不行|出问题)了[？?！!。，,]/.test(text.trim())) errors.push('STYLE_NO_BLAMING_OPENER');
  return errors;
}
