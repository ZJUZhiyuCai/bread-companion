import type { ConversationPreferences, Message } from './types';

/** Session-only, explicit first-person instructions. No inferred mood/personality or durable profile. */
export function conversationPreferences(messages: Pick<Message, 'role' | 'text'>[]): ConversationPreferences {
  const preferences: ConversationPreferences = {};
  for (const { role, text } of messages) {
    if (role !== 'user') continue;
    // Quoted material and third-person stories must not silently become a user preference.
    const direct = text.replace(/[“「『"].*?[”」』"]/gs, '');
    for (const part of direct.split(/[。！？!?,，\n]/).map(s => s.trim())) {
      if (/^(?:我(?:现在|今天|今晚)?|你|也|先)?(?:不想|不需要|不用|不要|别)[^。！？!?\n]{0,10}(?:建议|办法|说教)/.test(part)) preferences.advice = 'on_request';
      if (/^(?:我(?:现在|今天|今晚)?|你|也|先)?(?:不想|不需要|不用|不要|别)[^。！？!?\n]{0,6}(?:问|追问)/.test(part)) preferences.questions = 'avoid';
      if (/^(?:现在|接下来)?(?:可以|你可以)(?:给我|提)(?:一个|点|些)?建议/.test(part)) preferences.advice = 'welcome';
      if (/^(?:现在|接下来)?(?:可以|你可以)问我/.test(part)) preferences.questions = 'allowed';
    }
  }
  return preferences;
}
