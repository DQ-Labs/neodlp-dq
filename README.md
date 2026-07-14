# NeoDLP DQ

Modern Video/Audio Downloader based on yt-dlp — DQ Labs' internal fork of [NeoDLP](https://github.com/neosubhamoy/neodlp) by [Subhamoy Biswas](https://github.com/neosubhamoy), trimmed down for our own needs (Windows-only, no browser extension integration, no SponsorBlock).

## Building from Source

* Install [Rust](https://www.rust-lang.org/tools/install), [Node.js](https://nodejs.org/en), and [Git](https://git-scm.com/downloads).
* Install [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/) for Windows.

1. Install Node.js dependencies: `npm install`
2. Download required external binaries: `npm run download`
3. Run the build:
```shell
npm run tauri:build:windows-x64     # for x64 devices
npm run tauri:build:windows-arm64   # for ARM64 devices
```
4. Compiled packages land under `src-tauri/target/release/bundle`.

For local development, use `npm run tauri:dev:windows-x64` (or `-arm64`).

## Credits

Built on top of [NeoDLP](https://github.com/neosubhamoy/neodlp), which is itself powered by [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [FFmpeg](https://www.ffmpeg.org). See [LICENSE](./LICENSE) for the original MIT license and copyright.

## License and Usage

MIT licensed — see [LICENSE](./LICENSE).

> [!WARNING]
> This app facilitates downloading from various online platforms with different policies and terms of use, which users must follow. It is only intended for downloading content the user holds the copyright to or has authorization for.
