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
    ],
    mutuallyExclusive: true
};

export const classifierEnum = {
    IDLE: "idle",
    SELECTED: "selected",
    CONFIRMED: "confirm",
    SUBMITTED: "submit",
};

export class Classifier {
    constructor(config) {
        this.config = config;
        this.element = this.config.element;
        this.classes = this.config.classes;
        this.framer = this.initFramer(config);
        this.vidstate = this.initVidState(config);
        this.timeline = this.initTimeline(config);
        this.keybindings = this.config["opts"] || OPTS.keybindings;
        this.mutuallyExclusive = this.config["mutuallyExclusive"] || false;

        this.events = {
            "submitted": [],
            "confirmed": [],
            "selected": [],
            "stateChanged": [],
        }

        this.state = {
            state: classifierEnum.IDLE,
            classes: {},
        };

        // some annotation metadata
        this.start = Date.now();
        this.maxFrame = 0;
        this.numClassChanges = 0;

        this.buildReference();
        this.classMap = this._buildClassMap();
        this.bindkeys();

        this.init();
    }

    init() {
        this.stateChanged({state: this.state.state});
    }


    initFramer(config) {
        const framer = new Framer(config.element.querySelector("video"), config.fps);
        this.maxFrame = 0;
        framer.addEventListener("frameupdate", (event) => {
            this.maxFrame = Math.max(this.maxFrame, event.frame);
        });
        return framer
    }


    initVidState(config) {
        return new VidState(config.element.querySelector(".vid-state"), this.framer);
    }


    initTimeline(config) {
        const frames = Math.floor(this.framer.video.duration / this.framer.FRAME_DURATION);
        const timeline = new Timeline(config.element.querySelector(".timeline"),
                                      frames,
                                      {height: (config.channels.length + 1)  * 50,
                                       channelHeight: 50});
        timeline.addChannel("audio", {waveform: config.timeline.waveform});
        this.config.channels.forEach(channel => {
            timeline.addChannel(channel.name).update();
        });

        this.framer.addEventListener("frameupdate", (event) => {
            timeline.updateIndex(event.frame);
        });
        timeline.addEventListener("frameupdate", (event) => {
            this.framer.setFrame(event.frame)
        });
        return timeline;
    }

    //--------------------------------------------------------------------------
    // Classifier Reference
    //--------------------------------------------------------------------------

    _buildClassMap() {
        const classMap = {};
        this.classes.forEach(e => {
            console.log();
            classMap[e.key] = {
                class: e.class,
                classRef: document.querySelector(`#class-ref-item-${CSS.escape(e.key)}`)
            };
        });
        return classMap;
    }

    buildReference() {
        // sets up the class reference/selction indicator DOM
        const items = d3.select(this.element)
                        .select(".class-ref")
                        .selectAll("div")
                        .data(this.classes).enter()
                        .append("div")
                          .attr("class", "class-ref-item")
                          .attr("id", function(d){
                              return CSS.escape(`class-ref-item-${d.key}`);
                           });
        items.append("div")
             .attr("class", "class-label")
             .text(function(d){return d.class});
        items.append("div")
             .attr("class", function(d){return "key" + " " + CSS.escape(`key-${d.key}`)})
             .append("div")
                 .attr("class", "keycap")
                 .text(function(d){return d.key});
    }

    bindkeys() {
        this._bindkeys(this.keybindings || this.OPTS.keybindings);
        return this;
    }

    _bindkeys(keybindings) {
        let keymap = {};
        keybindings.forEach(entry => {
            const key = CSS.escape(entry.key.toLowerCase());
            const shift = entry.shift || undefined;
            const ctrl = entry.ctrl || undefined;
            const fun = entry.fun;
            if (shift === undefined && ctrl === undefined) {
                keymap[key+true+true] = fun;
                keymap[key+false+false] = fun;
                keymap[key+true+false] = fun;
                keymap[key+false+false] = fun;
            }
            else if (shift !== undefined && ctrl === undefined) {
                keymap[key+shift+true] = fun;
                keymap[key+shift+false] = fun;
            }
            else if (shift === undefined && ctrl !== undefined) {
                keymap[key+true+ctrl] = fun;
                keymap[key+false+ctrl] = fun;
            }
            else {
                keymap[key+shift+ctrl] = fun;
                keymap[key+shift+ctrl] = fun;
            }
        });

        document.addEventListener("keydown", (event) => {
            const fun = keymap[CSS.escape(event.key.toLowerCase()) + event.shiftKey + event.ctrlKey] || "";
            switch(fun) {
                case "forward":
                    this.framer.stepForward();
                    break;
                case "submit":
                    if (this.state.state == classifierEnum.SELECTED) {
                        this.state.state = classifierEnum.CONFIRMED;
                        this.stateChanged({state: this.state.state});
                        this.confirmed();
                    }
                    else if (this.state.state == classifierEnum.CONFIRMED) {
                        this.state.state = classifierEnum.SUBMITTED;
                        this.stateChanged({state: this.state.state});
                        const end = Date.now();
                        this.submitted({data:
                            {
                                frame: this.framer.getFrame(),
                                classes: Object.keys(this.state.classes),
                                timestamp: end,
                                workingTime: end - this.start,
                                maxFrame: this.maxFrame,
                                numClassChanges: this.numClassChanges
                            }});
                    }
                    break;
                case "speedup":
                    this.framer.speedUp();
                    break;
                case "slowdown":
                    this.framer.slowDown();
                    break;
                case "backward":
                    this.framer.stepBackward();
                    break;
                case "playpause":
                    if (this.framer.video.paused) {
                        this.framer.video.play();
                    }
                    else {
                        this.framer.video.pause();
                    }
                    break;
                default:
                    break;
            }
        });

        document.addEventListener("keydown", (event) => {
            // animate key references
            const ekey = CSS.escape(event.key.toLowerCase());
            const key = document.querySelectorAll(`.key-${ekey}`);
            // maybe update class selection, and if so reset selection indicator
            if (this.state.state == classifierEnum.IDLE ||
                this.state.state == classifierEnum.SELECTED ||
                this.state.state == classifierEnum.CONFIRMED) {
                const cls = this.classMap[ekey];
                if (cls !== undefined) {
                    // update classifier state
                    if (cls.class in this.state.classes) {
                        this.state.classes[cls.class].classList.remove("selected");
                        delete this.state.classes[cls.class];
                        if (Object.keys(this.state.classes).length == 0) {
                            this.state.state = classifierEnum.IDLE;
                        }
                    }
                    else {
                        this.state.classes[cls.class] = cls.classRef;
                        cls.classRef.classList.add("selected");
                        this.state.state = classifierEnum.SELECTED;
                    }
                    this.stateChanged({state: this.state.state});
                    this.numClassChanges++;
                }
            }
        });
        return this;
    }

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
