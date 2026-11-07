# Credits and artwork licences

Code by Peter Rafferty, art direction by James Rafferty.

Scribble Jr is an independent Windows version of ScratchJr. It is not affiliated
with or endorsed by MIT, Tufts University or the Scratch Foundation.

## Software

ScratchJr was created by the DevTech Research Group at Tufts University, the
Lifelong Kindergarten Group at the MIT Media Lab and the Playful Invention
Company. Its source code is used under the BSD 3-Clause licence in `LICENSE`.
"Scratch", "ScratchJr", their logos and the Scratch Cat are trademarks of MIT
(see `TRADEMARK`); Scribble Jr does not use them.

## Artwork

| Art | Where | Author | Licence |
|---|---|---|---|
| Character library (people, animals, fantasy, vehicles, things, nature) | `desktop/open-art/characters/` | [Twemoji](https://github.com/jdecked/twemoji) graphics, Copyright Twitter, Inc and other contributors | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| Tabby, Plum and Nova (mascots) | `desktop/open-art/svglibrary/` | Scribble Jr contributors | CC0 1.0 |
| Backgrounds | `desktop/open-art/backgrounds/` | Scribble Jr contributors | CC0 1.0 |
| Logo, start screen, app icon, "Sparky" | `desktop/open-art/brand/`, `editions/free/src/assets/start/`, `editions/free/src/assets/lobby/scratchJrlogo.svg`, `desktop/icon/` | Scribble Jr contributors | CC0 1.0 |
| Interface art (buttons, block icons, paint tools, sounds) | `editions/free/src/assets/`, `editions/free/src/sounds/` | ScratchJr project (MIT) | BSD 3-Clause, as published in the ScratchJr open-source repository |

Twemoji characters were converted (not redrawn) into the SVG subset ScratchJr's
paint editor understands by `desktop/open-art/tools/svg-to-sjr.mjs`: shapes were
turned into paths, curves into cubic Béziers, transforms applied and the drawings
scaled. Library thumbnails in `desktop/open-art/pnglibrary/` are renders of the
art above and carry the same licences.

The original ScratchJr character library, sample projects, logo, intro video and
help screenshots are not included: they were never released under an open licence
or show MIT's trademarks.
