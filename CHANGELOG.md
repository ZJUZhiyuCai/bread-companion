# Changelog

## Unreleased

- Lightened the surface system and redrew the controls: warm-white rooms, softer fibre and shadows, matte ink primary actions, paper-secondaries, restrained clay-red hang-up. The call room now uses the same light tokens instead of a forced dark scene; mobile card actions, 320px top bar, touch targets and error-toast placement were repaired. No backend, call state machine or media behavior changed.
- Route common direct Chinese review requests through the same controller flow as buttons; keep negation and quoted material distinct.
- Carry bounded rejected-judgment records into regeneration, remove stale assistant analysis and reject exact repeated judgments. Audit contested analysis with at most one repair; fall back to quotations and unknowns after repeated rejection. Ordinary chat incurs no extra call.
- Add redo on valid cards with an optional direction; retain user-edit provenance through preview, storage and export.
- Reframe the submission around the core task, with real-service synthetic workflows and a clearly unexecuted formative-observation plan.

- Replace the offset ellipse-and-tongue mouth with a gently parting stitched seam; add a muted felt flower, fine lashes and soft blush. Stop speech motion only after closing the seam completely.
- Keep read-aloud expressions quiet while synthesis and browser playback are pending; begin speech on actual playback and cancel preparation when the page goes into the background.

- Keep one red telephone throughout home loading, using a matching rendered still while capabilities, model bytes and the first GPU frame are pending. Graphics failure retains the same callable image; pending service checks no longer briefly gray the phone out.

## 0.4.0 — 2026-11-01

A lamp-lit desk with self-hosted typography, isolated service capacity and an HTTPS trial deployment.

- Integrated official Claude refinements across paper, lighting, enamel/brass controls, dialogue, cards and call states. Reduced the paper grain after visual review.
- Self-hosted renamed OFL WenKai subsets: a 167 KiB core, with remaining characters loaded by unicode range.
- Prepared the fixed public welcome audio in parallel with microphone permission; cancellation and permission denial never trigger paid synthesis or late playback. Loaded saved cards and provider capabilities concurrently.
- Added per-capability circuit breaking and concurrency isolation, bounded incoming-body readers, exact hosted origins and signed anonymous visits.
- Added D1 atomic shared rolling budgets, deduplication and expiring active leases; accounting failure rejects paid work. Worker secrets are scoped to each request.
- Retained local Next development and added a separate reproducible Sites/Vinext staging path with versioned migrations. Updated bilingual documentation and hosted data boundaries.

See [validation](docs/craft-online-validation.md), [deployment](docs/deployment.md), [Claude design](docs/design-craft-release.md) and [font attribution](docs/fonts.md).

## 0.3.0 — 2026-11-01

A quieter first visit and a real 3D telephone beside the photo plush, with bounded graphics loading and recoverable audio interruptions.

- Replaced the opening demand to talk with permission to stay. Listen/read first, enter a chat with an empty note, and find optional interview review later on the page.
- Removed the greeting hops and every eye-squashing blink. Glass highlights and restrained gaze movement keep the companion awake without half-closed eyes.
- Integrated DeepSeek's telephone and layout refinements, followed by official Claude's scene, lighting, copy and responsive composition. The Blender generator reproduces the committed GLB byte for byte in the documented environment.
- Added lazy Three.js rendering, a fixed interactive hit area, a 10-second model-download deadline and callable SVG fallback. Construction, rendering, context-loss and malformed-model failures release graphics resources; idle and hidden scenes stop drawing.
- Wait for service readiness before home graphics initialization; use the callable SVG on software GPUs to prevent shader setup from freezing interaction. Hardware rendering and fault-injection coverage remain.
- Kept initial 3D preparation behind the opening audio. Unexpected AudioContext suspension/closure now releases microphone capture and offers explicit reconnection.
- Expanded adversarial browser coverage for graphics failures, late results, audio interruptions and the new entry. Test conditions and physical-device limitations are documented separately.

See [validation and limits](docs/phone3d-audit.md), [Claude's opening design](docs/design-calm-entry.md), [model rebuild guide](docs/phone-model.md) and [source provenance](docs/calm-entry-provenance.json).

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
