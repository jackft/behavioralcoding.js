import {formatTime} from "./utils";

export class VidState {
    constructor(element, framer) {
        this.element = element;
        this.vframe = element.querySelector(".vframe");
        this.vtime = element.querySelector(".vtime");
        this.vspeed = element.querySelector(".vspeed");
        this.framer = framer;
        this.framer.addEventListener("frameupdate", (event) => {
            this.updateFrameAndTime(event);
        });
        this.framer.addEventListener("playbackSpeedChange", (event) => {
            this.updatePlaybackSpeed(event);
        });
        this.updateFrameAndTime({frame: framer.getFrame(), time: framer.getTime()});
        this.updatePlaybackSpeed({speed: framer.video.playbackRate});
    }

    updateFrameAndTime(event) {
        this.vframe.innerHTML = event.frame;
        this.vtime.innerHTML = formatTime(event.time);
    }

    updatePlaybackSpeed(event) {
        this.vspeed.innerHTML = `${event.speed.toFixed(2)}x`;
    }
}
