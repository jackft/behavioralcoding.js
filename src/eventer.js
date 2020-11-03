import {Framer} from "framewrangler";
import {VidState} from "./vidstate";
import {Timeline} from "./timeline";
import * as d3 from "d3";

const OPTS = {
    keybindings: [
        {fun: "backward", key: "arrowleft", description: "previous frame"},
        {fun: "forward", key: "arrowright", description: "next frame"},
        {fun: "speedup", key: "+", description: "speedup"},
        {fun: "slowdown", key: "-", description: "slowdown"},
        {fun: "playpause", key: " ", description: "play/pause"},
        {fun: "submit", key: "enter", description: "submit"},
        {fun: "toinsert", key: "i", description: "insert"},
        {fun: "tonormal", key: "escape", description: "insert"},
    ]
};

export const classifierEnum = {
    IDLE: "idle",
    SELECTED: "selected",
    CONFIRMED: "confirm",
    SUBMITTED: "submit",
};

const modeEnum = {
    NORMAL: "normal", // like vim's normal mode: navigate & select
    INSERT: "insert", // live vim's insert mode: create & delete
};

export class Eventer {
    constructor(config) {
        this.config = config;
        this.element = this.config.element;
        this.framer = this.initFramer(config);
        this.vidstate = this.initVidState(config);
        this.timeline = this.initTimeline(config);
        //
        this.modeIndicator = config.element.querySelector(".emode");

        this.keybindings = this.config.keybindings || OPTS.keybindings;

        this.events = {
            "submitted": [],
            "confirmed": [],
            "navigated": [],
            "selected": [],
            "edited": [],
        }

        this.state = {
            channels: config.channels || [],
            currentEventIdx: null,
            mode: modeEnum.NORMAL,
            undoStack: [],
            redoStack: []
        };

        this.tieEventsTogether();
        //
        this.changeMode(this.state.mode);
    }

    initFramer(config) {
        return new Framer(config.element.querySelector("video"), config.fps);
    }

    initVidState(config) {
        return new VidState(config.element.querySelector(".vid-state"), this.framer);
    }

    initTimeline(config) {
        const frames = Math.floor(this.framer.video.duration / this.framer.FRAME_DURATION);
        const timeline = new Timeline(config.element.querySelector(".timeline"), frames, {height: "150px"});
        timeline.addChannel("audio", {waveform: config.timeline.waveform});
        this.config.channels.forEach(channel => {
            timeline.addChannel(channel.name).update();
        });
        return timeline;
    }

    init() {
        this.stateChanged({state: this.state.state});
    }

    tieEventsTogether() {
        this.framer.addEventListener("frameupdate", (event) => {
            this.timeline.updateIndex(event.frame);
        });
        this.timeline.addEventListener("dragStart", (event) => {
            console.log("START");
            console.log(event);
            if (event.sourceEvent.shiftKey) {
                this.timeline.pan(event);
            }
            else if (this.framer.getFrame() != event.frame) {
                this.framer.setFrame(event.frame);
                this.timeline.updateIndex(event.frame);
            }
        });
        this.timeline.addEventListener("drag", (event) => {
            if (event.sourceEvent.shiftKey) {
                this.timeline.pan(event);
                return;
            }
            else if (this.framer.getFrame() != event.frame) {
                this.framer.setFrame(event.frame);
                this.timeline.updateIndex(event.frame);
            }
        });
        this.timeline.addEventListener("dragEnd", (event) => {
            this.timeline.dragStoreDragX = undefined;
            if (event.sourceEvent.shiftKey) {
                return;
            }
            else if (this.framer.getFrame() != event.frame) {
                this.framer.setFrame(event.frame);
                this.timeline.updateIndex(event.frame);
            }
        });

        this.timeline.addEventListener("click", (event) => {
            console.log("click", event.mode);
            if (this.state.mode == modeEnum.INSERT) {
                //this.timeline.upd
                console.log("insert");
                console.log(event);
                return;
            }
            else if (this.framer.getFrame() != event.frame) {
            }
        });

        document.addEventListener("keydown", (event) => {
            console.log(event);
            switch(event.key) {
                case "i":
                    this.changeMode(modeEnum.INSERT);
                    break;
                case "Escape":
                    this.changeMode(modeEnum.NORMAL);
                    break;
                default:
                    break;
            }
        });
    }

    changeMode(mode) {
        this.modeIndicator.innerText = mode;
        if (mode == this.state.mode) return;
        this.state.mode = mode;
    }

    //--------------------------------------------------------------------------
    // Classifier Reference
    //--------------------------------------------------------------------------


    //--------------------------------------------------------------------------
    // Events
    //--------------------------------------------------------------------------

    submitted(event) {
        this.events["submitted"].forEach(f => f(event));
    }

    confirmed(event) {
        this.events["confirmed"].forEach(f => f(event));
    }

    selected(event) {
        this.events["selected"].forEach(f => f(event));
    }

    stateChanged(event) {
        this.events["stateChanged"].forEach(f => f(event));
    }

    //--------------------------------------------------------------------------
    // Listeners
    //--------------------------------------------------------------------------

    addEventListener(name, handler) {
        this.events[name].push(handler);
    }

    removeEventListener(name, handler) {
        if (!this.events.hasOwnProperty(name)) return;
        const index = this.events[name].indexOf(handler);
        if (index != -1)
            this.events[name].splice(index, 1);
    }
}
