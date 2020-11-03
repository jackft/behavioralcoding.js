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
        this.vtime.innerHTML = new Date(event.time * 1000).toISOString().substr(11, 11);
    }

    updatePlaybackSpeed(event) {
        this.vspeed.innerHTML = `${event.speed.toFixed(2)}x`;
    }
}
