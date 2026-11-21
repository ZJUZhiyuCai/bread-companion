export const CHAT_ASR_SECONDS = 65;
export const INTERVIEW_ASR_SECONDS = 125;
export const WAV_BYTES_PER_SECOND = 32000;

export const pcmWavBytes = (seconds: number) => 44 + seconds * WAV_BYTES_PER_SECOND;
