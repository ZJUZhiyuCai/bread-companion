<img src="public/brand/bread-logo.svg" width="146" height="64" alt="Bread 面包" />

# Bread · 面包

**A warm companion for a difficult evening. Complexity belongs to the agent.**

After an interview rejection, stay for a moment without having to explain. When you feel ready, turn your own material into an editable note or practice one question.

[中文](README.md) · [Product & harness](docs/product-harness.md) · [Competitive comparison](docs/competitive-benchmark.md) · [Roadmap](ROADMAP.md) · [Contributing](CONTRIBUTING.md)

[![Checks](https://github.com/ZJUZhiyuCai/bread-companion/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ZJUZhiyuCai/bread-companion/actions/workflows/ci.yml)
[![MIT](https://img.shields.io/badge/License-MIT-amber.svg)](LICENSE)

![Bread's actual home screen: a plush companion, lively glass eyes and a red rotary phone](docs/assets/bread-home-v030.png)

## What works

- An original plush character with steady, fully open glass eyes, gently shifting highlights and touch response. Rest, pause and error keep the eyes open; reduced-motion preferences are respected.
- A Blender-built, Three.js-rendered rotary phone with lacquer-red surfaces, an ivory dial and brass details. It dials and lifts its handset with the real connection state; a bundled opening uses the configured default voice.
- A quiet entry: listen/read first, enter with an empty note, and review only when ready. No greeting hop or forced microphone access.
- Chinese text conversations and continuous browser voice calls, with speech interruption, mute, pause and hangup.
- Agent-led notes, interview review and one-question practice without setup forms.
- Evidence-linked, editable cards. Correcting a source invalidates old references.
- Explicit save preview, browser-local storage, Markdown/JSON export and JSON import.
- Bounded context, in-session preferences, timeouts, deduplication, cancellation and retry without duplicate messages.

**Local single-user preview, version 0.3.0.** There are no accounts, cross-device sync or persistent relationship memories. The public repository is not a hosted public service. Calls use sequential ASR → text generation → TTS, not a native full-duplex speech model.

## Run without API keys

Use the Node version in `.nvmrc` (`nvm use` is optional if it is already installed).

```sh
git clone https://github.com/ZJUZhiyuCai/bread-companion.git
cd bread-companion
nvm use
npm ci
cp .env.example .env.local
npm run dev
```

Open **http://127.0.0.1:3210**. Default Mock mode is visibly labeled and supports the text/card/practice flow; voice requires configured providers. Keep an existing `.env.local` if you already have one. Build a local production instance with `npm run build && npm start`.

For real services, see [Setup](docs/setup.md). The tested configuration uses an Anthropic-compatible Magpie route to DeepSeek, and MiniMax ASR / Speech 2.8 HD with `Chinese (Mandarin)_Warm_Bestie`. Route IDs are provider-specific. Keys stay server-side; never put them in `NEXT_PUBLIC_*`.

The telephone falls back to a callable SVG on loading or graphics failures. See the [model source and rebuild guide](docs/phone-model.md); running Bread does not require Blender.

## Evidence, not an EQ badge

155 unit/integration checks and 40 browser paths cover cancellation, evidence, storage, calls, the opening/animation lifecycle and stationary-pointer regressions. The v14 synthetic Chinese suite completed 16/16 API responses, with a **1.165 s median complete-response latency**. One goodbye used an application rule, not an LLM call. Both before/after outputs remain public: formulaic language, unsupported detail and unsolicited advice still occur.

A local production test with a virtual microphone started the bundled opening in **240 ms**. Two real-provider turns took **4.202 / 3.275 s** from end of input to audio, with **362 ms** speech interruption latency. The opening needs no synthesis round trip; subsequent replies still do. These small samples are not a latency guarantee. Physical microphones, Bluetooth and real mobile devices remain unverified.

```sh
npm run typecheck
npm run check:models
npm test
npm run build
npx playwright install chromium
CI=true BREAD_E2E_PORT=3213 npm run test:e2e
npm run eval:companion -- --dry-run
```

CI uses Mock providers. Live evaluation is opt-in and may incur provider costs:

```sh
npm run eval:companion -- --live --app http://127.0.0.1:3210
```

See the [synthetic cases and published outputs](evaluations/README.md), [current entry, 3D phone and adversarial validation](docs/phone3d-audit.md), [earlier voice validation](docs/living-companion-validation.md), and [sourced competitor comparison](docs/competitive-benchmark.md). The comparison is public-source research plus Bread testing, not a blinded trial of paid competitor products.

## Architecture and participation

`domain/` owns state and validation; `services/` owns session/media/storage lifecycles; `server/` and `app/api/` own provider calls and request boundaries; `prompts/` owns versioned instructions. The model proposes content. The application controls permissions, cancellation and saving.

[Documentation](docs/README.md) · [Contribution guide](CONTRIBUTING.md) · [Security](SECURITY.md) · [Code of conduct](CODE_OF_CONDUCT.md) · [Changelog](CHANGELOG.md)

Official Claude Code and DeepSeek contributed frontend design refinements; Codex implemented and verified backend integration, under the maintainer's direction. Original hashes and integration notes are retained in the provenance documents.

**[MIT](LICENSE)** © 2026 Zhiyu Cai and Bread contributors. See [character/audio provenance and image prompt](docs/living-companion-assets.md) and [Third-party notices](THIRD_PARTY_NOTICES.md) for asset and dependency scope.
