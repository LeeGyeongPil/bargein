# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.1] - 2026-11-17

### Fixed
- Demo page URL field now follows `BARGEIN_MOCK_PORT` instead of always defaulting to port 8787.

## [0.1.0] - 2026-11-17

### Added
- Core: PCM16 and base64 helpers, streaming linear resampler, `bytesToMs`, `computeAudioEndMs`.
- `PlaybackCore` and `CaptureCore`: DOM-free logic behind the AudioWorklets, with sample-counted playback position.
- `createPlayer` and `createCapture` for the browser (inline Blob worklets or `workletUrl` for strict CSP).
- `bargein/openai` and `bargein/gemini` adapters.
- Practice mock WebSocket server, `npm run lesson` and a Vite demo page (English / Korean).
