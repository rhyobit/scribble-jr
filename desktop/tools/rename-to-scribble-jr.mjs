// One-time source edit: rename user-facing "ScratchJr" text to "Scribble Jr".
// Keys describing the original ScratchJr project (who made/funded/inspired it) are
// kept as attribution, and a translated "independent, not affiliated" note is added.
// Usage: node desktop/tools/rename-to-scribble-jr.mjs
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execSync} from 'node:child_process';
import {about} from './about-scribble-jr.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pageRoot = path.join(repoRoot, 'editions', 'free', 'src');
// Last upstream ScratchJr commit; the untouched locale files are read from here.
const ORIGINAL_COMMIT = '566f2f9';
const RENAME_KEYS = ['QUICK_INTRO', 'ABOUT_SCRATCHJR', 'ABOUT_WHAT_IS', 'ABOUT_DESCRIPTION',
    'SHARING_EMAIL_SUBJECT', 'SHARING_EMAIL_TEXT', 'USAGE_QUESTION'];

const ADAPTED_BY = 'Scribble Jr: code by Peter Rafferty, art direction by James Rafferty.';
const TWEMOJI_CREDIT = 'Character art: Twemoji by Twitter, Inc and other contributors, licensed under CC BY 4.0 ' +
    '(creativecommons.org/licenses/by/4.0). All other new art is CC0.';

const notice = {
    ca: 'Scribble Jr és una versió independent de ScratchJr per a Windows i no està afiliada ni avalada pel MIT, la Universitat Tufts ni la Scratch Foundation.',
    cy: 'Mae Scribble Jr yn fersiwn annibynnol o ScratchJr ar gyfer Windows ac nid yw’n gysylltiedig â MIT, Prifysgol Tufts na’r Scratch Foundation nac wedi’i chymeradwyo ganddynt.',
    da: 'Scribble Jr er en uafhængig Windows-version af ScratchJr og er ikke tilknyttet eller godkendt af MIT, Tufts University eller Scratch Foundation.',
    de: 'Scribble Jr ist eine unabhängige Windows-Version von ScratchJr und steht in keiner Verbindung zum MIT, zur Tufts University oder zur Scratch Foundation und wird von diesen nicht unterstützt.',
    el: 'Το Scribble Jr είναι μια ανεξάρτητη έκδοση του ScratchJr για Windows και δεν συνδέεται ούτε εγκρίνεται από το MIT, το Πανεπιστήμιο Tufts ή το Scratch Foundation.',
    en: 'Scribble Jr is an independent Windows version of ScratchJr and is not affiliated with or endorsed by MIT, Tufts University or the Scratch Foundation.',
    es: 'Scribble Jr es una versión independiente de ScratchJr para Windows y no está afiliada ni respaldada por el MIT, la Universidad Tufts ni la Scratch Foundation.',
    fr: 'Scribble Jr est une version Windows indépendante de ScratchJr ; elle n’est ni affiliée ni approuvée par le MIT, l’Université Tufts ou la Scratch Foundation.',
    it: 'Scribble Jr è una versione indipendente di ScratchJr per Windows e non è affiliata né approvata dal MIT, dalla Tufts University o dalla Scratch Foundation.',
    ja: 'Scribble Jr は ScratchJr の独立した Windows 版であり、MIT、タフツ大学、Scratch Foundation とは提携しておらず、承認も受けていません。',
    nl: 'Scribble Jr is een onafhankelijke Windows-versie van ScratchJr en is niet verbonden aan of goedgekeurd door MIT, Tufts University of de Scratch Foundation.',
    no: 'Scribble Jr er en uavhengig Windows-versjon av ScratchJr og er ikke tilknyttet eller godkjent av MIT, Tufts University eller Scratch Foundation.',
    pl: 'Scribble Jr to niezależna wersja ScratchJr dla systemu Windows, niezwiązana z MIT, Uniwersytetem Tufts ani Scratch Foundation i niezatwierdzona przez nie.',
    pt: 'O Scribble Jr é uma versão independente do ScratchJr para Windows e não é afiliado nem aprovado pelo MIT, pela Universidade Tufts ou pela Scratch Foundation.',
    'pt-br': 'O Scribble Jr é uma versão independente do ScratchJr para Windows e não é afiliado nem endossado pelo MIT, pela Universidade Tufts ou pela Scratch Foundation.',
    sv: 'Scribble Jr är en fristående Windows-version av ScratchJr och är inte ansluten till eller godkänd av MIT, Tufts University eller Scratch Foundation.',
    th: 'Scribble Jr เป็น ScratchJr เวอร์ชันสำหรับ Windows ที่พัฒนาแยกอิสระ และไม่มีส่วนเกี่ยวข้องหรือได้รับการรับรองจาก MIT มหาวิทยาลัยทัฟส์ หรือ Scratch Foundation',
    tr: 'Scribble Jr, ScratchJr’ın bağımsız bir Windows sürümüdür; MIT, Tufts Üniversitesi veya Scratch Foundation ile bağlantılı değildir ve onlar tarafından onaylanmamıştır.',
    'zh-cn': 'Scribble Jr 是 ScratchJr 的独立 Windows 版本，与麻省理工学院（MIT）、塔夫茨大学或 Scratch 基金会无关，也未获得其认可。',
    'zh-tw': 'Scribble Jr 是 ScratchJr 的獨立 Windows 版本，與麻省理工學院（MIT）、塔夫茨大學或 Scratch 基金會無關，也未獲其認可。'
};

const locDir = path.join(pageRoot, 'localizations');
for (const file of fs.readdirSync(locDir).filter((f) => f.endsWith('.json'))) {
    const lang = file.replace(/\.json$/, '');
    const p = path.join(locDir, file);
    const raw = fs.readFileSync(p, 'utf8');
    const strings = JSON.parse(raw);
    // Always start from the original ScratchJr text so re-running gives the same result
    // (the notice itself mentions ScratchJr, so editing in place would compound).
    const original = JSON.parse(execSync(`git show ${ORIGINAL_COMMIT}:editions/free/src/localizations/${file}`,
        {cwd: repoRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024}));
    for (const key of RENAME_KEYS) {
        if (typeof original[key] === 'string') {
            strings[key] = original[key].replace(/Scratch ?Jr/g, 'Scribble Jr');
        }
    }
    const own = about[lang] || about.en;
    strings.ABOUT_WHY_SCRIBBLE = own.why;
    strings.ABOUT_WHY_SCRIBBLE_DESCRIPTION = own.story;
    strings.ABOUT_WHY_CREATE = own.whyCreated;
    if (typeof strings.ABOUT_DESCRIPTION === 'string') {
        // Attribution required by the Twemoji licence (CC BY 4.0) is kept in English.
        strings.ABOUT_DESCRIPTION = [strings.ABOUT_DESCRIPTION, notice[lang], ADAPTED_BY, TWEMOJI_CREDIT]
            .filter(Boolean).join('<br/><br/>');
    }
    const indent = /\n(\s+)"/.exec(raw);
    fs.writeFileSync(p, JSON.stringify(strings, null, indent ? indent[1] : 4) + '\n');
    if (!notice[lang]) {
        console.warn('no notice translation for', lang);
    }
}

for (const html of ['index.html', 'home.html']) {
    const p = path.join(pageRoot, html);
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/<title>[^<]*<\/title>/, '<title>Scribble Jr</title>'));
}
console.log('renamed');
