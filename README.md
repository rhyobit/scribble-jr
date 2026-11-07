# Scribble Jr

Scribble Jr is a free Windows app where young children (ages 5–7) snap together
picture blocks to make characters move, jump, dance and sing. It is built from
the open-source code of [ScratchJr](https://www.scratchjr.org/), made to work with
a keyboard and mouse on Windows, with an all-new, openly licensed art library.

Code by Peter Rafferty, art direction by James Rafferty.

> Scribble Jr is an independent project. It is not affiliated with or endorsed by
> MIT, Tufts University or the Scratch Foundation. "Scratch", "ScratchJr" and the
> Scratch Cat are trademarks of MIT and are not used by this app.

## Status

| Platform | Status |
|---|---|
| Windows (desktop) | Current: built from this repository |
| iOS, Android | Not built by Scribble Jr; the `ios/` and `android/` folders are upstream ScratchJr code, left unchanged |

## What's different from ScratchJr

- **Runs on Windows** as a small native app (Tauri + the system WebView2), not a tablet app.
- **Keyboard and mouse first**: mouse mode everywhere, and the number pad on blocks accepts typed digits, Backspace and Enter.
- **Picture import**: the paint editor's camera tool also offers "Choose a picture", and works with no camera at all.
- **Project files**: "Save to file" writes a `.sjr` project; "Open project" on the home screen imports one (compatible with ScratchJr projects).
- **New art**: Tabby, Plum and Nova, 147 library characters from Twemoji, original backgrounds, and a new logo. See [CREDITS.md](CREDITS.md).
- **Private by design**: no analytics or telemetry; the app cannot browse the web.

## Building

Requirements: Node.js 20+, Rust (stable) and the Visual Studio C++ build tools.

```bash
npm ci --ignore-scripts
NODE_OPTIONS=--openssl-legacy-provider npx webpack --mode=production
cd desktop
npm ci
npx tauri build
```

The installer is written to `desktop/src-tauri/target/release/bundle/nsis/`.

Every push to `main` also builds the installer on GitHub Actions
([Windows build](.github/workflows/windows-build.yml)). The installer and app
`.exe` are attached to each run as an artifact for 30 days.

How the pieces fit:

| Path | What it is |
|---|---|
| `src/`, `editions/free/src/` | The ScratchJr web client (lightly modified: rename, start-screen art, no intro video) |
| `desktop/tablet-desktop.js` | Replaces ScratchJr's iPad native layer: sound, microphone, camera/picture import, `.sjr` files |
| `desktop/src-tauri/` | Windows shell in Rust: SQLite storage, file dialogs, locked-down webview |
| `desktop/assemble.mjs` | Builds `desktop/dist` from the web client plus `desktop/open-art` |
| `desktop/open-art/` | All new artwork and the tools that generate it |
| `desktop/harness/` | Developer test server that runs the app in a normal browser |

## Licences

- Code: BSD 3-Clause, see [LICENSE](LICENSE) (ScratchJr © MIT; Scribble Jr changes © Peter Rafferty, James Rafferty and contributors).
- Art: see [CREDITS.md](CREDITS.md). Character art is Twemoji (CC BY 4.0); everything drawn for Scribble Jr is CC0.
- Third-party software: see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

The original ScratchJr README is kept in [doc/ORIGINAL-SCRATCHJR-README.md](doc/ORIGINAL-SCRATCHJR-README.md)
for reference.
