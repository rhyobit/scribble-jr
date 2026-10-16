// Builds library characters from Twemoji (CC BY 4.0, https://github.com/jdecked/twemoji).
// Usage: node make-twemoji-characters.mjs <path to twemoji assets/svg>
// Writes ../characters/<Name>.svg and ../characters/characters.json (media entries).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {convertSvg} from './svg-to-sjr.mjs';

const src = process.argv[2];
if (!src || !fs.existsSync(src)) {
    console.error('usage: node make-twemoji-characters.mjs <twemoji/assets/svg>');
    process.exit(1);
}
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'characters');
fs.rmSync(out, {recursive: true, force: true});
fs.mkdirSync(out, {recursive: true});

// [file name without .svg, Character name]. Library sections follow the category order.
const groups = {
    '03 people': [
        ['1f6b6', 'Walker'], ['1f3c3', 'Runner'], ['1f483', 'Dancer'], ['1f57a', 'Disco Dancer'],
        ['1f938', 'Cartwheel'], ['1f3c4', 'Surfer'], ['1f6b4', 'Cyclist'], ['1f9cd', 'Standing Person'],
        ['26f9', 'Ball Player'], ['1f3cc', 'Golfer'], ['1f3c2', 'Snowboarder'], ['26f7', 'Skier'],
        ['1f9d1-200d-1f680', 'Astronaut'], ['1f9d1-200d-1f692', 'Firefighter'], ['1f9d1-200d-1f373', 'Cook'],
        ['1f9d1-200d-1f3a8', 'Artist'], ['1f9d1-200d-1f52c', 'Scientist'], ['1f9d1-200d-1f33e', 'Farmer'],
        ['1f477', 'Builder'], ['1f46e', 'Police Officer'], ['1f478', 'Princess'], ['1f934', 'Prince'],
        ['1f385', 'Santa'], ['1f9b8', 'Superhero'], ['1f977', 'Ninja']
    ],
    '04 animals': [
        ['1f415', 'Dog'], ['1f408', 'Cat'], ['1f407', 'Rabbit'], ['1f401', 'Mouse'], ['1f414', 'Chicken'],
        ['1f424', 'Chick'], ['1f416', 'Pig'], ['1f404', 'Cow'], ['1f411', 'Sheep'], ['1f410', 'Goat'],
        ['1f40e', 'Horse'], ['1f993', 'Zebra'], ['1f412', 'Monkey'], ['1f418', 'Elephant'], ['1f992', 'Giraffe'],
        ['1f42a', 'Camel'], ['1f405', 'Tiger'], ['1f406', 'Leopard'], ['1f998', 'Kangaroo'], ['1f9a5', 'Sloth'],
        ['1f994', 'Hedgehog'], ['1f43f', 'Chipmunk'], ['1f987', 'Bat'], ['1f989', 'Owl'], ['1f986', 'Duck'],
        ['1f99c', 'Parrot'], ['1f9a9', 'Flamingo'], ['1f427', 'Penguin'], ['1f422', 'Turtle'], ['1f40d', 'Snake'],
        ['1f40a', 'Crocodile'], ['1f438', 'Frog'], ['1f98b', 'Butterfly'], ['1f41d', 'Bee'], ['1f41e', 'Ladybug'],
        ['1f40c', 'Snail'], ['1f577', 'Spider'], ['1f42c', 'Dolphin'], ['1f433', 'Whale'], ['1f41f', 'Fish'],
        ['1f420', 'Tropical Fish'], ['1f421', 'Pufferfish'], ['1f419', 'Octopus'], ['1f980', 'Crab'],
        ['1f988', 'Shark'], ['1f9ad', 'Seal']
    ],
    '05 fantasy': [
        ['1f996', 'T-Rex'], ['1f995', 'Long Neck Dinosaur'], ['1f409', 'Dragon'], ['1f984', 'Unicorn'],
        ['1f9d9', 'Wizard'], ['1f9da', 'Fairy'], ['1f9dc', 'Mermaid'], ['1f9de', 'Genie'], ['1f9dd', 'Elf'],
        ['1f47b', 'Ghost'], ['1f47d', 'Alien'], ['1f47e', 'Space Monster'], ['1f916', 'Robot'], ['1f9df', 'Zombie']
    ],
    '06 vehicles': [
        ['1f697', 'Car'], ['1f3ce', 'Racing Car'], ['1f695', 'Taxi'], ['1f68c', 'Bus'], ['1f69a', 'Truck'],
        ['1f692', 'Fire Engine'], ['1f691', 'Ambulance'], ['1f693', 'Police Car'], ['1f69c', 'Tractor'],
        ['1f682', 'Steam Train'], ['1f6b2', 'Bicycle'], ['1f6f4', 'Scooter'], ['1f681', 'Helicopter'],
        ['2708', 'Aeroplane'], ['1f680', 'Rocket'], ['1f6f8', 'Flying Saucer'], ['26f5', 'Sailboat'],
        ['1f6a4', 'Speedboat'], ['1f3a0', 'Carousel Horse']
    ],
    '07 things': [
        ['26bd', 'Football'], ['1f3c0', 'Basketball'], ['1f3be', 'Tennis Ball'], ['1f388', 'Balloon'],
        ['1f381', 'Present'], ['1f382', 'Birthday Cake'], ['1f9f8', 'Teddy Bear'], ['1fa81', 'Kite'],
        ['1f451', 'Crown'], ['1f48e', 'Gem'], ['1f3b8', 'Guitar'], ['1f941', 'Drum'], ['1f3ba', 'Trumpet'],
        ['1f3a8', 'Paint Palette'], ['1f4da', 'Books'], ['1f3e0', 'House'], ['1f3f0', 'Castle'],
        ['1f34e', 'Apple'], ['1f34c', 'Banana'], ['1f353', 'Strawberry'], ['1f349', 'Watermelon'],
        ['1f355', 'Pizza'], ['1f366', 'Ice Cream'], ['1f36a', 'Cookie'], ['1f955', 'Carrot']
    ],
    '08 nature': [
        ['1f333', 'Tree'], ['1f332', 'Pine Tree'], ['1f334', 'Palm Tree'], ['1f335', 'Cactus'],
        ['1f33b', 'Sunflower'], ['1f337', 'Tulip'], ['1f344', 'Mushroom'], ['1f342', 'Leaves'],
        ['2600', 'Sun'], ['1f319', 'Moon'], ['2b50', 'Star'], ['2601', 'Cloud'], ['1f308', 'Rainbow'],
        ['26a1', 'Lightning'], ['2744', 'Snowflake'], ['26c4', 'Snowman'], ['1f525', 'Fire'], ['1f30b', 'Volcano']
    ]
};

const entries = [];
const skipped = [];
for (const [order, list] of Object.entries(groups)) {
    for (const [code, name] of list) {
        // Some codepoints ship with a -fe0f variation suffix.
        const file = [code, `${code}-fe0f`].map((c) => path.join(src, `${c}.svg`)).find((f) => fs.existsSync(f));
        if (!file) {
            skipped.push(`${name} (${code}: missing)`);
            continue;
        }
        const md5 = `${name.replace(/[^A-Za-z0-9]/g, '')}.svg`;
        const res = convertSvg(fs.readFileSync(file, 'utf8'), {height: 150, id: md5});
        if (!res) {
            skipped.push(`${name} (${code}: uses unsupported SVG features)`);
            continue;
        }
        fs.writeFileSync(path.join(out, md5), res.svg);
        entries.push({md5, width: res.width, height: res.height, ext: 'svg', name,
            order: `characters,${order}`, tags: ['characters', order], source: `twemoji ${path.basename(file)}`});
    }
}
fs.writeFileSync(path.join(out, 'characters.json'), JSON.stringify(entries, null, 4) + '\n');
console.log(`wrote ${entries.length} characters`);
if (skipped.length) {
    console.log('skipped:\n  ' + skipped.join('\n  '));
}
