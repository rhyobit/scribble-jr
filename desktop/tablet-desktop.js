// ScratchJr desktop "tablet" bridge.
//
// ScratchJr's shared web client talks to a native layer through
// window.tablet.postMessage({id, method, params}) and expects the answer via
// window.iOS.resolve(id, result) (see src/tablet/iOS.js). This file is that
// native layer for Windows: it is injected by the Tauri shell before every
// page loads. Persistence (SQLite, asset files, .sjr save/open dialogs) is
// done in Rust; sound, microphone, camera and picture import are done here
// with standard browser APIs.
//
// Behaviour mirrors ios/ScratchJr/src/{JsBridge,IO,RecordSound,ScratchJr}.m:
// results are strings, and strings that look like JSON are passed as objects.

(function () {
    'use strict';
    if (window.__sjrDesktopBridge) {
        return;
    }
    window.__sjrDesktopBridge = true;

    // Always run ScratchJr in mouse mode, even on touchscreen PCs. The app picks
    // touch or mouse handlers from ('ontouchstart' in document.documentElement);
    // touch input still works because Windows synthesises mouse events.
    [window, Document.prototype, Element.prototype, HTMLElement.prototype].forEach(function (o) {
        try {
            delete o.ontouchstart;
        } catch (e) {
            // not deletable on this object; ignore
        }
    });

    // The paint editor finds shapes with SVGSVGElement.getIntersectionList().
    // On iPad (WebKit) that matches by bounding box, so tapping inside an
    // outlined shape selects it; Chromium only matches painted pixels, which
    // breaks the paint bucket and camera/picture fill on unfilled shapes.
    // Give it WebKit's bounding-box behaviour.
    SVGSVGElement.prototype.getIntersectionList = function (rect, referenceElement) {
        var root = referenceElement || this;
        var rootInverse = this.getScreenCTM().inverse();
        var out = [];
        var els = root.querySelectorAll('path,rect,circle,ellipse,line,polyline,polygon,image,text,use');
        for (var i = 0; i < els.length; i++) {
            var el = els[i];
            var ctm = el.getScreenCTM();
            if (!ctm) {
                continue; // not rendered (display: none)
            }
            var b;
            try {
                b = el.getBBox();
            } catch (e) {
                continue;
            }
            var m = rootInverse.multiply(ctm);
            var xs = [];
            var ys = [];
            [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].forEach(function (c) {
                xs.push(m.a * c[0] + m.c * c[1] + m.e);
                ys.push(m.b * c[0] + m.d * c[1] + m.f);
            });
            if (Math.min.apply(null, xs) <= rect.x + rect.width && Math.max.apply(null, xs) >= rect.x &&
                Math.min.apply(null, ys) <= rect.y + rect.height && Math.max.apply(null, ys) >= rect.y) {
                out.push(el);
            }
        }
        return out;
    };

    function invoke (cmd, args) {
        return window.__TAURI_INTERNALS__.invoke(cmd, args || {});
    }

    function log () {
        console.log.apply(console, ['[desktop]'].concat([].slice.call(arguments))); // eslint-disable-line no-console
    }

    ///////////////////////////////////////////
    // Encoding helpers
    ///////////////////////////////////////////

    function bytesToBase64 (bytes) {
        var chunks = [];
        for (var i = 0; i < bytes.length; i += 0x8000) {
            chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)));
        }
        return btoa(chunks.join(''));
    }

    function base64ToBytes (b64) {
        var bin = atob(b64);
        var out = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) {
            out[i] = bin.charCodeAt(i);
        }
        return out;
    }

    function utf8Bytes (str) {
        return new TextEncoder().encode(str);
    }

    async function readFileBytes (name) {
        var b64 = await invoke('file_read', {name: name});
        return b64 ? base64ToBytes(b64) : null;
    }

    async function writeFileBytes (name, bytes) {
        return invoke('file_write', {name: name, base64: bytesToBase64(bytes)});
    }

    ///////////////////////////////////////////
    // Audio playback (io_registersound / io_playsound / io_stopsound)
    ///////////////////////////////////////////

    var audioCtx = null;
    function getAudioContext () {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        return audioCtx;
    }
    // Browsers only allow audio to start after a user gesture.
    ['pointerdown', 'mousedown', 'keydown'].forEach(function (evt) {
        window.addEventListener(evt, function () {
            if (audioCtx && audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
        }, true);
    });

    var soundBuffers = {};
    var playingSources = {};

    async function loadSoundBytes (dir, name) {
        if (dir === 'Documents') {
            return readFileBytes(name);
        }
        // On iOS the web content lives in an "HTML5" folder inside the app
        // bundle; here it is the page root.
        var url = (dir || '').replace(/^HTML5\//, '') + name;
        var res = await fetch(url);
        if (!res.ok) {
            return null;
        }
        return new Uint8Array(await res.arrayBuffer());
    }

    async function registerSound (dir, name) {
        try {
            var bytes = await loadSoundBytes(dir, name);
            if (!bytes) {
                return 'error';
            }
            var buffer = await getAudioContext().decodeAudioData(bytes.buffer.slice(0));
            soundBuffers[name] = buffer;
            return name + ',' + buffer.duration;
        } catch (e) {
            log('registerSound failed', dir, name, e);
            return 'error';
        }
    }

    function stopSound (name) {
        var src = playingSources[name];
        if (!src) {
            return name + ' not found';
        }
        delete playingSources[name];
        try {
            src.stop();
        } catch (e) {
            // already stopped
        }
        return name + ' stopped';
    }

    function playSound (name) {
        var buffer = soundBuffers[name];
        if (!buffer) {
            return name + ' not found';
        }
        if (playingSources[name]) {
            stopSound(name);
        }
        var ctx = getAudioContext();
        var src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(ctx.destination);
        src.onended = function () {
            // Only report the end of the instance that is still current.
            if (playingSources[name] === src) {
                delete playingSources[name];
            }
            if (window.OS && window.OS.soundDone) {
                window.OS.soundDone(name);
            }
        };
        playingSources[name] = src;
        src.start();
        return name + ' played';
    }

    ///////////////////////////////////////////
    // Microphone recording (recordsound_*)
    // Recorded as 16-bit mono WAV so projects stay compatible with the tablet apps.
    ///////////////////////////////////////////

    var rec = {
        soundname: null,
        stream: null,
        source: null,
        processor: null,
        chunks: [],
        sampleRate: 44100,
        level: 0,
        pendingWrite: Promise.resolve(),
        player: null
    };

    var micAvailable = false;
    var cameraAvailable = false;
    var devicesChecked = (async function () {
        try {
            var devices = await navigator.mediaDevices.enumerateDevices();
            micAvailable = devices.some(function (d) {
                return d.kind === 'audioinput';
            });
            cameraAvailable = devices.some(function (d) {
                return d.kind === 'videoinput';
            });
        } catch (e) {
            log('enumerateDevices failed', e);
        }
    })();

    function releaseMic () {
        if (rec.processor) {
            rec.processor.onaudioprocess = null;
            rec.processor.disconnect();
        }
        if (rec.source) {
            rec.source.disconnect();
        }
        if (rec.stream) {
            rec.stream.getTracks().forEach(function (t) {
                t.stop();
            });
        }
        rec.processor = rec.source = rec.stream = null;
    }

    function encodeWav (chunks, inputRate) {
        // Downsample to 22.05 kHz to keep projects small.
        var outRate = 22050;
        var total = 0;
        chunks.forEach(function (c) {
            total += c.length;
        });
        var ratio = inputRate / outRate;
        var outLen = Math.floor(total / ratio);
        var samples = new Float32Array(total);
        var off = 0;
        chunks.forEach(function (c) {
            samples.set(c, off);
            off += c.length;
        });
        var buf = new ArrayBuffer(44 + outLen * 2);
        var v = new DataView(buf);
        function str (o, s) {
            for (var i = 0; i < s.length; i++) {
                v.setUint8(o + i, s.charCodeAt(i));
            }
        }
        str(0, 'RIFF');
        v.setUint32(4, 36 + outLen * 2, true);
        str(8, 'WAVE');
        str(12, 'fmt ');
        v.setUint32(16, 16, true);
        v.setUint16(20, 1, true); // PCM
        v.setUint16(22, 1, true); // mono
        v.setUint32(24, outRate, true);
        v.setUint32(28, outRate * 2, true);
        v.setUint16(32, 2, true);
        v.setUint16(34, 16, true);
        str(36, 'data');
        v.setUint32(40, outLen * 2, true);
        for (var i = 0; i < outLen; i++) {
            var s = Math.max(-1, Math.min(1, samples[Math.floor(i * ratio)]));
            v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }
        return new Uint8Array(buf);
    }

    async function recordStart () {
        await devicesChecked;
        if (!micAvailable) {
            return '-1';
        }
        if (rec.soundname) {
            await invoke('file_remove', {name: rec.soundname});
        }
        try {
            rec.stream = await navigator.mediaDevices.getUserMedia({audio: true});
        } catch (e) {
            log('microphone unavailable', e);
            return '-1';
        }
        var ctx = getAudioContext();
        rec.chunks = [];
        rec.level = 0;
        rec.sampleRate = ctx.sampleRate;
        rec.source = ctx.createMediaStreamSource(rec.stream);
        rec.processor = ctx.createScriptProcessor(4096, 1, 1);
        rec.processor.onaudioprocess = function (e) {
            var data = e.inputBuffer.getChannelData(0);
            rec.chunks.push(new Float32Array(data));
            var peak = 0;
            for (var i = 0; i < data.length; i++) {
                peak = Math.max(peak, Math.abs(data[i]));
            }
            // Same smoothing as the iOS meter.
            rec.level = 0.05 * peak + 0.95 * rec.level;
        };
        rec.source.connect(rec.processor);
        rec.processor.connect(ctx.destination); // required for onaudioprocess to fire
        var stamp = await invoke('md5_hex', {s: String(Date.now() / 1000)});
        rec.soundname = 'SND' + stamp + '.wav';
        return rec.soundname;
    }

    function recordStop () {
        if (!rec.processor) {
            return '-1';
        }
        releaseMic();
        var wav = encodeWav(rec.chunks, rec.sampleRate);
        var name = rec.soundname;
        rec.pendingWrite = writeFileBytes(name, wav);
        return rec.pendingWrite.then(function () {
            return '1';
        });
    }

    async function recordStartPlay () {
        await rec.pendingWrite;
        if (!rec.soundname) {
            return '-1';
        }
        var bytes = await readFileBytes(rec.soundname);
        if (!bytes) {
            return '-1';
        }
        var ctx = getAudioContext();
        var buffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
        recordStopPlay();
        rec.player = ctx.createBufferSource();
        rec.player.buffer = buffer;
        rec.player.connect(ctx.destination);
        rec.player.start();
        return String(buffer.duration);
    }

    function recordStopPlay () {
        if (!rec.player) {
            return '-1';
        }
        try {
            rec.player.stop();
        } catch (e) {
            // already finished
        }
        rec.player = null;
        return '1';
    }

    async function recordClose (keep) {
        releaseMic();
        await rec.pendingWrite;
        if (keep === 'NO' && rec.soundname) {
            await invoke('file_remove', {name: rec.soundname});
        }
        rec.soundname = null;
        return '1';
    }

    ///////////////////////////////////////////
    // Camera and picture import (scratchjr_*)
    //
    // The paint editor's camera tool fills a shape with a photo. On desktop the
    // same tool also offers "Choose a picture" to fill the shape from an image
    // file, and works with no camera at all.
    ///////////////////////////////////////////

    var feed = null;

    function coverCrop (source, sw, sh, w, h, mirror) {
        // Draw source (sw x sh) into a w x h PNG, scaled to cover and centred.
        var scale = Math.min(2, 1024 / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * scale));
        var ch = Math.max(1, Math.round(h * scale));
        var cnv = document.createElement('canvas');
        cnv.width = cw;
        cnv.height = ch;
        var ctx = cnv.getContext('2d');
        var k = Math.max(cw / sw, ch / sh);
        var dw = sw * k;
        var dh = sh * k;
        if (mirror) {
            ctx.translate(cw, 0);
            ctx.scale(-1, 1);
        }
        ctx.drawImage(source, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
        return cnv.toDataURL('image/png').split(',')[1];
    }

    function deliverImage (b64) {
        if (window.Camera && window.Camera.processimage) {
            window.Camera.processimage(b64);
        }
    }

    function chooseImageFile () {
        if (!feed) {
            return;
        }
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/png,image/jpeg,image/gif,image/bmp,image/webp';
        input.onchange = function () {
            var file = input.files && input.files[0];
            if (!file || !feed) {
                return;
            }
            var url = URL.createObjectURL(file);
            var img = new Image();
            img.onload = function () {
                var data = feed && feed.data;
                if (data) {
                    deliverImage(coverCrop(img, img.naturalWidth, img.naturalHeight, data.width, data.height, false));
                }
                URL.revokeObjectURL(url);
            };
            img.onerror = function () {
                URL.revokeObjectURL(url);
                log('could not read picture', file.name);
            };
            img.src = url;
        };
        input.click();
    }

    function place (el, x, y, w, h) {
        el.style.position = 'absolute';
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        el.style.width = w + 'px';
        el.style.height = h + 'px';
    }

    async function startVideo (deviceId) {
        if (!feed) {
            return;
        }
        if (feed.stream) {
            feed.stream.getTracks().forEach(function (t) {
                t.stop();
            });
            feed.stream = null;
        }
        try {
            var constraints = {video: deviceId ? {deviceId: {exact: deviceId}} : true, audio: false};
            var stream = await navigator.mediaDevices.getUserMedia(constraints);
            if (!feed) {
                stream.getTracks().forEach(function (t) {
                    t.stop();
                });
                return;
            }
            feed.stream = stream;
            feed.video.srcObject = stream;
            feed.video.style.display = 'block';
            feed.placeholder.style.display = 'none';
        } catch (e) {
            log('camera unavailable', e);
            feed.video.style.display = 'none';
            feed.placeholder.style.display = 'flex';
        }
    }

    function startFeed (str) {
        stopFeed();
        var data = JSON.parse(str);
        // As on iOS, the feed and mask are laid out at their unzoomed size and
        // then scaled by the paint editor's zoom around their centres.
        var zoom = Number(data.scale) || 1;
        var root = document.createElement('div');
        root.id = 'desktopCameraFeed';
        root.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;';

        var video = document.createElement('video');
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        video.style.cssText = 'object-fit:cover;background:#222;display:none;';
        video.style.transform = 'scale(' + (-zoom) + ',' + zoom + ')';
        place(video, data.x, data.y, data.width, data.height);

        // Shown inside the shape when there is no camera.
        var placeholder = document.createElement('div');
        placeholder.style.cssText = 'display:none;align-items:center;justify-content:center;' +
            'background:#d9e4f2;color:#4a5c75;font:bold 48px sans-serif;cursor:pointer;';
        placeholder.textContent = '🖼'; // framed picture
        placeholder.onmousedown = chooseImageFile;
        place(placeholder, data.x, data.y, data.width, data.height);
        placeholder.style.transform = 'scale(' + zoom + ')';

        // The workspace with a transparent hole where the shape is.
        var mask = document.createElement('img');
        mask.src = data.image;
        mask.style.pointerEvents = 'none';
        place(mask, data.mx, data.my, data.mw, data.mh);
        mask.style.transform = 'scale(' + zoom + ')';

        var pick = document.createElement('div');
        pick.id = 'desktopChoosePicture';
        pick.textContent = '📁  Choose a picture';
        pick.style.cssText = 'position:absolute;left:50%;transform:translateX(-50%);bottom:24px;z-index:5;' +
            'padding:14px 28px;border-radius:32px;background:#f8a32d;color:#fff;cursor:pointer;' +
            'font:bold 24px sans-serif;box-shadow:0 3px 8px rgba(0,0,0,.35);user-select:none;';
        pick.onmousedown = function (e) {
            e.preventDefault();
            e.stopPropagation();
            chooseImageFile();
        };

        root.appendChild(video);
        root.appendChild(placeholder);
        root.appendChild(mask);
        root.appendChild(pick);

        // Paint.cameraToolsOn() adds the snapshot/close buttons to #backdrop right
        // after this call; inserting first keeps them on top of the feed.
        var backdrop = document.getElementById('backdrop') || document.body;
        backdrop.insertBefore(root, backdrop.firstChild);

        feed = {data: data, root: root, video: video, placeholder: placeholder, stream: null, cameraIndex: 0};

        devicesChecked.then(function () {
            if (!feed) {
                return;
            }
            if (cameraAvailable) {
                startVideo(null);
            } else {
                placeholder.style.display = 'flex';
                // Hide the shutter and flip buttons: there is nothing to photograph.
                ['capture-container', 'cameraflip'].forEach(function (id) {
                    var el = document.getElementById(id);
                    if (el) {
                        el.style.display = 'none';
                    }
                });
            }
        });
        // With no camera, go straight to the file picker. This runs inside the
        // click that opened the camera tool, so the browser allows the dialog.
        if (!cameraAvailable) {
            chooseImageFile();
        }
        return '1';
    }

    function stopFeed () {
        if (!feed) {
            return '1';
        }
        if (feed.stream) {
            feed.stream.getTracks().forEach(function (t) {
                t.stop();
            });
        }
        if (feed.root.parentNode) {
            feed.root.parentNode.removeChild(feed.root);
        }
        feed = null;
        return '1';
    }

    async function chooseCamera () {
        if (!feed) {
            return '-1';
        }
        var devices = (await navigator.mediaDevices.enumerateDevices()).filter(function (d) {
            return d.kind === 'videoinput';
        });
        if (devices.length < 2) {
            return '-1';
        }
        feed.cameraIndex = (feed.cameraIndex + 1) % devices.length;
        await startVideo(devices[feed.cameraIndex].deviceId);
        return '1';
    }

    function captureImage () {
        if (!feed) {
            return '-1';
        }
        var v = feed.video;
        if (!feed.stream || !v.videoWidth) {
            chooseImageFile();
            return '1';
        }
        deliverImage(coverCrop(v, v.videoWidth, v.videoHeight, feed.data.width, feed.data.height, true));
        return '1';
    }

    ///////////////////////////////////////////
    // .sjr project files (zip): save via share button, open via lobby button
    ///////////////////////////////////////////

    var crcTable = null;
    function crc32 (bytes) {
        if (!crcTable) {
            crcTable = new Uint32Array(256);
            for (var n = 0; n < 256; n++) {
                var c = n;
                for (var k = 0; k < 8; k++) {
                    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
                }
                crcTable[n] = c >>> 0;
            }
        }
        var crc = 0xFFFFFFFF;
        for (var i = 0; i < bytes.length; i++) {
            crc = crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
        }
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    // Minimal zip writer (stored, no compression). entries: [{name, data: Uint8Array}]
    function makeZip (entries) {
        var parts = [];
        var central = [];
        var offset = 0;
        entries.forEach(function (e) {
            var name = utf8Bytes(e.name);
            var crc = crc32(e.data);
            var local = new DataView(new ArrayBuffer(30));
            local.setUint32(0, 0x04034b50, true);
            local.setUint16(4, 20, true);
            local.setUint16(6, 0x0800, true); // UTF-8 names
            local.setUint32(14, crc, true);
            local.setUint32(18, e.data.length, true);
            local.setUint32(22, e.data.length, true);
            local.setUint16(26, name.length, true);
            parts.push(new Uint8Array(local.buffer), name, e.data);

            var cen = new DataView(new ArrayBuffer(46));
            cen.setUint32(0, 0x02014b50, true);
            cen.setUint16(4, 20, true);
            cen.setUint16(6, 20, true);
            cen.setUint16(8, 0x0800, true);
            cen.setUint32(16, crc, true);
            cen.setUint32(20, e.data.length, true);
            cen.setUint32(24, e.data.length, true);
            cen.setUint16(28, name.length, true);
            cen.setUint32(42, offset, true);
            central.push(new Uint8Array(cen.buffer), name);
            offset += 30 + name.length + e.data.length;
        });
        var cenSize = central.reduce(function (n, p) {
            return n + p.length;
        }, 0);
        var end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true);
        end.setUint16(8, entries.length, true);
        end.setUint16(10, entries.length, true);
        end.setUint32(12, cenSize, true);
        end.setUint32(16, offset, true);
        var all = parts.concat(central, [new Uint8Array(end.buffer)]);
        var out = new Uint8Array(offset + cenSize + 22);
        var pos = 0;
        all.forEach(function (p) {
            out.set(p, pos);
            pos += p.length;
        });
        return out;
    }

    // Minimal zip reader (stored + deflate), driven by the central directory.
    async function readZip (bytes) {
        var v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        var eocd = -1;
        for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
            if (v.getUint32(i, true) === 0x06054b50) {
                eocd = i;
                break;
            }
        }
        if (eocd < 0) {
            throw new Error('not a zip file');
        }
        var count = v.getUint16(eocd + 10, true);
        var p = v.getUint32(eocd + 16, true);
        var files = {};
        for (var n = 0; n < count; n++) {
            if (v.getUint32(p, true) !== 0x02014b50) {
                throw new Error('bad zip directory');
            }
            var method = v.getUint16(p + 10, true);
            var csize = v.getUint32(p + 20, true);
            var nlen = v.getUint16(p + 28, true);
            var xlen = v.getUint16(p + 30, true);
            var clen = v.getUint16(p + 32, true);
            var lho = v.getUint32(p + 42, true);
            // Some Windows zip tools write backslash separators.
            var name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nlen)).replace(/\\/g, '/');
            p += 46 + nlen + xlen + clen;
            if (name.endsWith('/')) {
                continue;
            }
            var start = lho + 30 + v.getUint16(lho + 26, true) + v.getUint16(lho + 28, true);
            var raw = bytes.subarray(start, start + csize);
            if (method === 0) {
                files[name] = raw;
            } else if (method === 8) {
                var ds = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
                files[name] = new Uint8Array(await new Response(ds).arrayBuffer());
            }
        }
        return files;
    }

    var builtZips = {};

    async function createZipForProject (projectData, metadata, zipName) {
        if (typeof metadata === 'string') {
            metadata = JSON.parse(metadata);
        }
        var entries = [{name: 'project/data.json', data: utf8Bytes(projectData)}];
        var keys = Object.keys(metadata || {});
        for (var k = 0; k < keys.length; k++) {
            var list = metadata[keys[k]] || [];
            for (var i = 0; i < list.length; i++) {
                var bytes = await readFileBytes(list[i]);
                if (bytes) {
                    entries.push({name: 'project/' + keys[k] + '/' + list[i], data: bytes});
                }
            }
        }
        var fullName = zipName + '.sjr';
        builtZips = {};
        builtZips[fullName] = makeZip(entries);
        return fullName;
    }

    async function saveSjr (fileName) {
        var zip = builtZips[fileName];
        if (!zip) {
            return '-1';
        }
        var safeName = fileName.replace(/[\\/:*?"<>|]/g, '_');
        var saved = await invoke('save_sjr', {fileName: safeName, base64: bytesToBase64(zip)});
        return saved ? '1' : '-1';
    }

    async function dbInsert (table, obj) {
        var keys = Object.keys(obj);
        var json = {
            stmt: 'INSERT INTO ' + table + ' (' + keys.join(',') + ') VALUES (' +
                keys.map(function () {
                    return '?';
                }).join(',') + ')',
            values: keys.map(function (k) {
                return String(obj[k]);
            })
        };
        return invoke('db_stmt', {json: JSON.stringify(json)});
    }

    async function dbHas (table, md5) {
        var res = await invoke('db_query', {json: JSON.stringify({
            stmt: 'SELECT id FROM ' + table + ' WHERE md5 = ?', values: [md5]
        })});
        try {
            return JSON.parse(res).length > 0;
        } catch (e) {
            return true; // on error, don't insert duplicates
        }
    }

    function makeThumb (fileName, w, h) {
        try {
            if (window.ScratchJr && window.ScratchJr.makeThumb) {
                window.ScratchJr.makeThumb(fileName, w, h);
            }
        } catch (e) {
            log('makeThumb failed', fileName, e);
        }
    }

    // Port of IO.receiveProject in ios/ScratchJr/src/IO.m
    async function importSjr (bytes) {
        var files = await readZip(bytes);
        var dataName = Object.keys(files).find(function (n) {
            return /(^|\/)project\/data\.json$/.test(n);
        });
        if (!dataName) {
            throw new Error('This is not a project file.');
        }
        var prefix = dataName.slice(0, dataName.length - 'data.json'.length);
        var data = JSON.parse(new TextDecoder().decode(files[dataName]));
        await dbInsert('projects', {
            isgift: '1',
            deleted: 'NO',
            json: JSON.stringify(data.json),
            thumbnail: JSON.stringify(data.thumbnail),
            version: 'iOSv01',
            name: data.name
        });

        var sprites = {};
        var json = data.json || {};
        (json.pages || []).forEach(function (pageName) {
            var page = json[pageName] || {};
            (page.sprites || []).forEach(function (spriteName) {
                var s = page[spriteName];
                if (s && s.md5) {
                    sprites[s.md5] = s;
                }
            });
        });

        var names = Object.keys(files);
        for (var i = 0; i < names.length; i++) {
            var path = names[i];
            if (!/\.(png|wav|svg)$/i.test(path) || path.indexOf(prefix) !== 0) {
                continue;
            }
            var parts = path.slice(prefix.length).split('/');
            var fileName = parts[parts.length - 1];
            if (!(await invoke('file_read', {name: fileName}))) {
                await writeFileBytes(fileName, files[path]);
            }
            var folder = parts.length > 1 ? parts[0] : '';
            var pngName = fileName.replace('.svg', '.png');
            var ext = fileName.split('.').pop();
            if (folder === 'characters' && sprites[fileName] && !(await dbHas('usershapes', fileName))) {
                var s = sprites[fileName];
                await dbInsert('usershapes', {
                    version: 'iOSv01', altmd5: pngName, md5: fileName, ext: ext, name: s.id,
                    width: String(s.w), height: String(s.h), scale: String(s.scale)
                });
                makeThumb(fileName, s.w, s.h);
            } else if (folder === 'backgrounds' && !(await dbHas('userbkgs', fileName))) {
                await dbInsert('userbkgs', {
                    version: 'iOSv01', altmd5: pngName, md5: fileName, ext: ext, width: '480', height: '360'
                });
                makeThumb(fileName, 480, 360);
            }
        }
        if (window.Lobby && window.Lobby.refresh) {
            window.Lobby.refresh();
        }
    }

    async function openProjectFile () {
        var b64 = await invoke('open_sjr');
        if (!b64) {
            return;
        }
        try {
            await importSjr(base64ToBytes(b64));
        } catch (e) {
            log('import failed', e);
            window.alert('Sorry, that project could not be opened.\n\n' + e.message);
        }
    }

    function decorateLobby () {
        if (window.scratchJrPage !== 'home' || document.getElementById('desktopOpenProject')) {
            return;
        }
        var btn = document.createElement('div');
        btn.id = 'desktopOpenProject';
        btn.title = 'Open a project file (.sjr)';
        btn.textContent = '📂 Open project';
        btn.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9000;padding:10px 18px;' +
            'border-radius:24px;background:#f8a32d;color:#fff;font:bold 18px sans-serif;cursor:pointer;' +
            'box-shadow:0 2px 6px rgba(0,0,0,.3);user-select:none;';
        btn.onclick = openProjectFile;
        document.body.appendChild(btn);
    }

    // The share dialog offers "Email" and "AirDrop". On desktop both become
    // "save the project to a file".
    function relabelShareButtons () {
        var email = document.getElementById('infoboxShareButtonEmail');
        if (email && !email.__desktop) {
            email.__desktop = true;
            email.textContent = 'Save to file';
        }
        var airdrop = document.getElementById('infoboxShareButtonAirdrop');
        if (airdrop && airdrop.style.display !== 'none') {
            airdrop.style.display = 'none';
        }
    }

    ///////////////////////////////////////////
    // Page behaviour
    ///////////////////////////////////////////

    document.addEventListener('DOMContentLoaded', function () {
        new MutationObserver(relabelShareButtons).observe(document.body, {childList: true, subtree: true});
    });
    window.addEventListener('load', decorateLobby);

    // No browser right-click menu, except in text fields.
    document.addEventListener('contextmenu', function (e) {
        var t = e.target;
        if (!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'))) {
            e.preventDefault();
        }
    });

    // Block browser zoom (Ctrl+wheel / Ctrl +/-): the layout is computed once per page.
    window.addEventListener('wheel', function (e) {
        if (e.ctrlKey) {
            e.preventDefault();
        }
    }, {passive: false});
    window.addEventListener('keydown', function (e) {
        if (e.ctrlKey && ['+', '-', '=', '0'].indexOf(e.key) >= 0) {
            e.preventDefault();
        }
    });

    // The block number pad is an on-screen keypad made for touch. Let the
    // physical keyboard drive it: digits, minus, Backspace/Delete, and
    // Enter/Escape to finish editing.
    window.addEventListener('keydown', function (e) {
        var pad = document.querySelector('.picokeyboard.on');
        var active = document.activeElement;
        if (!pad || e.ctrlKey || e.altKey || e.metaKey ||
            (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA'))) {
            return;
        }
        var key = null;
        if (/^[0-9]$/.test(e.key)) {
            key = Array.prototype.find.call(pad.querySelectorAll('.onekey'), function (k) {
                return k.textContent === e.key;
            });
        } else if (e.key === '-') {
            key = pad.querySelector('.onekey.minus');
        } else if (e.key === 'Backspace' || e.key === 'Delete') {
            key = pad.querySelector('.onekey.delete');
        } else if (e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault();
            // Clicking anywhere outside the pad finishes the edit.
            window.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, cancelable: true}));
            return;
        }
        if (key) {
            e.preventDefault();
            key.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, cancelable: true}));
        }
    });

    // ScratchJr sizes everything from the window size when a page loads. If the
    // window is resized on the home screen, reload it; in the editor, keep going
    // (reloading there could lose work).
    var resizeTimer = null;
    window.addEventListener('resize', function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
            var page = window.scratchJrPage;
            if (page === 'index' || page === 'home' || page === 'gettingStarted') {
                window.location.reload();
            }
        }, 400);
    });

    ///////////////////////////////////////////
    // Bridge dispatch
    ///////////////////////////////////////////

    var mediaCache = {};

    var handlers = {
        askForPermission: function () {
            return 'ok';
        },
        hideSplash: function () {
            return '1';
        },
        deviceName: function () {
            return 'this computer';
        },
        // No analytics or telemetry on desktop.
        analyticsEvent: function () {
            return 'ok';
        },
        setAnalyticsPlacePref: function () {
            return 'ok';
        },
        setAnalyticsPref: function () {
            return 'ok';
        },

        database_stmt: function (json) {
            return invoke('db_stmt', {json: json});
        },
        database_query: function (json) {
            return invoke('db_query', {json: json});
        },

        io_getsettings: async function () {
            await devicesChecked;
            // path, debug choice, microphone permission, camera permission.
            // The camera tool is always offered because it also imports pictures.
            return 'desktop,(null),' + (micAvailable ? 'YES' : 'NO') + ',YES';
        },
        io_getmd5: function (str) {
            return invoke('md5_hex', {s: String(str)});
        },
        io_cleanassets: async function (ext) {
            await invoke('clean_assets', {ext: String(ext)});
            return 'ok';
        },
        io_setfile: function (name, b64) {
            return invoke('file_write', {name: name, base64: b64});
        },
        io_getfile: async function (name) {
            var b64 = await invoke('file_read', {name: name});
            return b64 || btoa('archnemesis'); // what iOS returns for a missing file
        },
        io_setmedia: async function (b64, ext) {
            var md5 = await invoke('md5_hex', {s: b64});
            return invoke('file_write', {name: md5 + '.' + ext, base64: b64});
        },
        io_setmedianame: function (b64, key, ext) {
            return invoke('file_write', {name: key + '.' + ext, base64: b64});
        },
        io_getmedia: async function (name) {
            var bytes = await readFileBytes(name);
            return bytes ? new TextDecoder().decode(bytes) : '';
        },
        io_getmedialen: async function (file, key) {
            var b64 = (await invoke('file_read', {name: file})) || '';
            mediaCache[key] = b64;
            return String(b64.length);
        },
        io_getmediadata: function (key, offset, len) {
            return (mediaCache[key] || '').substr(Number(offset), Number(len));
        },
        io_getmediadone: function (key) {
            delete mediaCache[key];
            return '1';
        },
        io_remove: function (name) {
            return invoke('file_remove', {name: name});
        },

        io_registersound: registerSound,
        io_playsound: playSound,
        io_stopsound: stopSound,

        recordsound_recordstart: recordStart,
        recordsound_recordstop: recordStop,
        recordsound_volume: function () {
            return String(Math.min(1, rec.level * 1.5));
        },
        recordsound_startplay: recordStartPlay,
        recordsound_stopplay: recordStopPlay,
        recordsound_recordclose: recordClose,

        scratchjr_cameracheck: function () {
            return '1';
        },
        scratchjr_has_multiple_cameras: function () {
            return 'NO';
        },
        scratchjr_startfeed: startFeed,
        scratchjr_stopfeed: stopFeed,
        scratchjr_choosecamera: chooseCamera,
        scratchjr_captureimage: captureImage,

        createZipForProject: createZipForProject,
        sendSjrUsingShareDialog: saveSjr
    };

    function deliver (id, res) {
        if (typeof res === 'string' && (res.charAt(0) === '[' || res.charAt(0) === '{')) {
            try {
                res = JSON.parse(res);
            } catch (e) {
                // leave as string
            }
        } else if (typeof res === 'number' || typeof res === 'boolean') {
            res = String(res);
        }
        if (window.iOS && window.iOS.resolve) {
            window.iOS.resolve(id, res);
        }
    }

    window.tablet = {
        postMessage: function (msg) {
            var fn = handlers[msg.method];
            if (!fn) {
                log('unsupported native call', msg.method);
                return; // like iOS: unknown methods never call back
            }
            var result;
            try {
                // Called synchronously so that handlers which open a file
                // picker still run inside the user's click.
                result = fn.apply(null, msg.params || []);
            } catch (e) {
                log(msg.method, 'failed', e);
                deliver(msg.id, '-1');
                return;
            }
            Promise.resolve(result).then(function (res) {
                setTimeout(function () {
                    deliver(msg.id, res);
                }, 0);
            }, function (e) {
                log(msg.method, 'failed', e);
                deliver(msg.id, '-1');
            });
        }
    };

    // Exposed for testing in a plain browser.
    window.__sjrDesktop = {importSjr: importSjr, readZip: readZip, makeZip: makeZip, encodeWav: encodeWav};
})();
