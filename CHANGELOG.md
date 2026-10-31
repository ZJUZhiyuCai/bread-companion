# Changelog

## 0.2.1 — 2026-10-31

A steadier, open-eyed companion and a shared material language for the character, telephone and original SVG brand.

- Removed persistent closed and half-closed eye states; rest, mute, pause and error use posture and small props. Only a brief 190 ms blink remains.
- Removed frequent random gaze jitter. Fixed stationary-pointer hover loops on both the home and chat telephones without moving their hit areas.
- Rebuilt the phone with lacquer shading, an inset ivory dial, brass details, dimensional handset and coiled cord; added matching light and contact shadows to the plush.
- Original vector logo, standalone mark, monochrome logo and favicon; shared paths in the interface.
- Fixed the transient narrow call column when resizing from desktop to portrait. Preserved the real call-state animation and cached Warm Bestie greeting.
- 155 unit/integration checks and 27 browser flows pass locally, including three new motion regressions.

See [validation and limits](docs/material-identity-validation.md), [Claude's design](docs/design-material-identity.md) and [source provenance](docs/material-identity-provenance.json).

## 0.2.0 — 2026-10-31

A plush companion and a red rotary telephone, with a shorter path from tapping to hearing a voice.

- Original textured plush body; animated glass eyes, blinks, gaze, touch response and call-state expressions.
- A red desk phone is the call button. Its dial turns while connecting and its handset lifts when the audio starts; motion follows the actual call state.
- Locally served MiniMax Warm Bestie opening for the matching voice configuration, plus quiet local ringback. Other voices use their configured TTS; missing assets fall back once.
- Natural interruption also cancels an opening still being prepared. Hangup prevents late playback and releases devices/audio nodes.
- Narrow direct-goodbye handling, correction and emotional-obligation constraints; v13/v14 synthetic outputs retained with remaining quality failures.
- Small-screen greeting/phone overlap fixed; reduced-motion and text focus preserved.

See [validation and limits](docs/living-companion-validation.md), [asset provenance](docs/living-companion-assets.md), and [Claude design provenance](docs/living-companion-provenance.json).

## 0.1.0 — 2026-10-31

First open-source preview. This is a working local application, not a hosted multi-user service.

- Expressive Bread character; text, continuous voice calls, and editable one-off transcription.
- Speech interruption, mute/pause/hangup, cancellation and stale-response protection.
- DeepSeek-compatible text routing and MiniMax speech adapters; no-key Mock mode.
- Bounded context, explicit in-session preferences, request deadlines, deduplication and retry without duplicated user messages.
- Evidence-linked cards, optional practice, explicit save preview, local import/export and deletion.
- MIT license, bilingual entry points, contribution/security policies, reproducible synthetic companion evaluation and a sourced competitive comparison.

Known gaps: opt-in cross-session companion memory, streaming speech response, physical-device validation and blinded human evaluation. See [Roadmap](ROADMAP.md) and [validation scope](docs/upgrade-validation.md).
