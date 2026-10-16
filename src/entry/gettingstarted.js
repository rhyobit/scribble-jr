import {gn, isiOS, getUrlVars} from '../utils/lib';

let place;

export function gettingStartedMain () {
    gn('closeHelp').onclick = gettingStartedCloseMe;
    gn('closeHelp').ontouchstart = gettingStartedCloseMe;
    var videoObj = gn('myVideo');
    videoObj.poster = 'assets/lobby/poster.png';
    var noVideo = false;
    var image = document.createElement('img');
    image.src = videoObj.poster;
    image.onload = function () {
        if (!noVideo) {
            videoObj.style.display = 'block';
        }
    };
    if (isiOS) {
        // On iOS we can load from server. Scribble Jr ships without the original
        // intro video (it shows ScratchJr's trademarks); if no replacement video
        // is present, point people to the in-app guides instead.
        videoObj.onerror = function () {
            noVideo = true;
            videoObj.style.display = 'none';
            var note = document.createElement('div');
            note.style.cssText = 'color:white;font:bold 28px sans-serif;text-align:center;padding:20vh 10vw;';
            note.textContent = 'A video guide is coming soon. For now, tap the book icon on the home screen ' +
                'to see how the blocks, paint editor and interface work.';
            videoObj.parentNode.appendChild(note);
        };
        videoObj.src = 'assets/lobby/intro.mp4';
    } else {
        // On Android we need to copy to a temporary directory first:
        setTimeout(function () {
            videoObj.type = 'video/mp4';
            videoObj.src = AndroidInterface.scratchjr_getgettingstartedvideopath();
        }, 1000);
    }
    var urlvars = getUrlVars();
    place = urlvars['place'];
    document.ontouchmove = function (e) {
        e.preventDefault();
    };
}


function gettingStartedCloseMe () {
    window.location.href = 'home.html?place=' + place;
}
