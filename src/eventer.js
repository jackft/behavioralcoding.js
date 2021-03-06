import {Framer} from "framewrangler";
import {VidState} from "./vidstate";
import {Timeline} from "./timeline";
import {controllDummyKeyboard, formatTime, frameToTime, StateTracker} from "./utils";
import * as d3 from "d3";

const OPTS = {
    keybindings: [
        {fun: "undo", key: "z", ctrl: true, description: "undo"},
        {fun: "redo", key: "y", ctrl: true, description: "redo"},
        {fun: "backward", key: "arrowleft", description: "previous frame"},
        {fun: "forward", key: "arrowright", description: "next frame"},
        {fun: "superBackward", key: "arrowleft", shift: true, description: "previous frame"},
        {fun: "superForward", key: "arrowright", shift: true, description: "next frame"},
        {fun: "channeldown", key: "arrowdown", description: "change channel down"},
        {fun: "channelup", key: "arrowup", description: "change channel up"},
        {fun: "speedup", key: "+", description: "speedup"},
        {fun: "slowdown", key: "-", description: "slowdown"},
        {fun: "playpause", key: " ", description: "play/pause"},
        {fun: "submit", key: "enter", description: "submit"},
        {fun: "escape", key: "escape", description: "insert"},
        {fun: "delete", key: "delete", description: "delete something"},
        {fun: "changemode", key: "tab", description: "switch mode"},

        {fun: "editBackward", key: "arrowleft", ctrl: true, description: "move instant forward"},
        {fun: "editForward", key: "arrowright", ctrl: true, description: "move instant backward"},
        {fun: "superEditBackward", key: "arrowleft", ctrl: true, shift: true, description: "move instant forward"},
        {fun: "superEditForward", key: "arrowright", ctrl: true, shift: true, description: "move instant backward"},

        {fun: "grabbableShift", key: "shift", description: "grabbable"},
        {fun: "grabbableCtrl", key: "control", description: "grabbable"},
    ]
};

export const stateEnum = {
    IDLE: "idle",
    READY: "ready",
    CONFIRM: "confirm",
    SUBMIT: "submit"
}

export const eventerEnum = {
    INSTANT: "instant",
    INTERVAL: "interval",
};

export class Eventer {
    constructor(config) {
        ////////////////////////////////////////////////////////////////////////
        // State
        ////////////////////////////////////////////////////////////////////////
        this.state = {
            instants: [],
            intervals: [],

            currentChannel: null,
            currentInstant: null,
            currentInterval: null,

            instantIdCounter: 0,
            intervalIdCounter: 0,

            undoStack: [],
            redoStack: [],
            mode: eventerEnum.INSTANT,
            state: stateEnum.IDLE
        };

        this.events = {
            "submitted": [],
            "confirmed": [],
            "navigated": [],
            "selected": [],
            "edited": [],
            "stateChanged": [],
        }
        ////////////////////////////////////////////////////////////////////////
        // Set up
        ////////////////////////////////////////////////////////////////////////
        this.config = config;
        this.element = this.config.element;
        this.framer = this.initFramer(config);
        this.vidstate = this.initVidState(config);
        this.stateTracker = this.initStateTracker(config);
        this.timeline = this.initTimeline(config);
        this.eventtable = this.initEventTable(config);
        this.classMap = this.initClassMap(config);
        this.intervalClassMap = this.initIntervalClassMap(config);
        this.channelIndicator = this.initChannelIndicator(config);

        this.init();

        // for tracking task duration
        this.start  = Date.now();

        this.keybindings = this.config.keybindings || OPTS.keybindings;

        ////////////////////////////////////////////////////////////////////////
        // Events
        ////////////////////////////////////////////////////////////////////////


        this.tieEventsTogether();
        this.bindkeys(this.classMap, this.intervalClassMap, this.keybindings);
        controllDummyKeyboard();
        //
        this.instantIdCounter = 0;
        this.intervalIdCounter = 0;

        // temporary stuff
        this._frame = undefined;
        this._frame_dragged = false;

        this._intervalCreator = undefined;
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
        this.initChannelLabels(timeline);
        return timeline;
    }

    initChannelLabels(timeline) {
        const N = this.config.channels.length;
        timeline.timeline
                .selectAll(".channel")
                .each(function(d, i) {
                    const bcr = this.getBoundingClientRect();
                    d3.select(timeline.element)
                      .append("div")
                      .attr("class", "channellabel")
                      .style("position", "relative")
                      .style("left", "-14.4px")
                      .style("top", `${-50 * (N+1)}px`)
                      .style("width", "14.4px")
                      .style("height", "50px")
                      .text(d.name);
                });
    }

    initEventTable(config) {
        const eventtable = d3.select(this.element)
                             .append("div")
                             .attr("class", "eventtable")
                             .style("position", "absolute");
        eventtable
            .append("datalist")
            .attr("id", "instant-classes")
            .selectAll("option")
            .data(config.classes)
            .join(
                enter => enter.append("option")
                              .attr("value", d=>d.class)
            );

        eventtable
            .append("datalist")
            .attr("id", "interval-classes")
            .selectAll("option")
            .data(config.intervalClasses)
            .join(
                enter => enter.append("option")
                              .attr("value", d=>d.class)
            );
        this.positionEventTable(eventtable);
        return eventtable;
    }

    positionEventTable(eventtable) {
        const bcr = this.element.getBoundingClientRect();
        const timelineBcr = this.timeline.element.getBoundingClientRect();
        const height = (timelineBcr.top + timelineBcr.height) - bcr.top;
        eventtable.style("top", `${this.element.offsetTop}px`)
                  .style("left", `${this.element.offsetLeft + bcr.width}px`)
                  .style("height", `${height}px`);
    }

    initClassMap(config) {
        const classes = config.classes.filter(clazz => "key" in clazz);
        // sets up the class reference/selction indicator DOM
        const items = d3.select(config.element)
                        .append("div")
                        .attr("class", "class-ref instant-class-ref")
                        .selectAll("div")
                        .data(classes).enter()
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
        // create class map
        const classMap = {};

        classes.forEach(e => {
            classMap[e.key] = {
                class: e.class,
                classRef: document.querySelector(`#class-ref-item-${CSS.escape(e.key)}`)
            };
        });
        return classMap;
    }

    initIntervalClassMap(config) {
        const classes =  config.intervalClasses.filter(clazz => "key" in clazz);
        // sets up the class reference/selction indicator DOM
        const items = d3.select(config.element)
                        .append("div")
                        .attr("class", "class-ref interval-class-ref")
                        .style("display", "none")
                        .selectAll("div")
                        .data(classes).enter()
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
        // create class map
        const classMap = {};

        classes.forEach(e => {
            classMap[e.key] = {
                class: e.class,
                classRef: document.querySelector(`#class-ref-item-${CSS.escape(e.key)}`)
            };
        });
        return classMap;
    }

    initChannelIndicator(config) {
        d3.select(this.element)
          .append("span")
          .attr("class", "channel-pointer")
          .text("👉")
          .style("position", "absolute");

        this.state.currentChannel = this.timeline.state.channels[1];
        this.changeChannel();
    }

    initStateTracker(config) {
        const progress = [
            {description: "annotate", states: new Set([stateEnum.IDLE])},
            {description: "submit (Enter)", states: new Set([stateEnum.READY])},
            {description: "confirm (Enter)", states: new Set([stateEnum.CONFIRM])},
        ]

        const stateTracker = new StateTracker(
            document.querySelector(".progress-steps"),
            progress,
            stateEnum.SUBMIT

        );

        this.addEventListener("stateChanged", (event) => stateTracker.update(event));
        return stateTracker;
    }

    init() {
        //this.stateChanged({state: this.state.state});
        document.querySelector(".emode").innerText = this.state.mode;
    }

    tieEventsTogether() {
        ////////////////////////////////////////////////////////////////////////
        //
        ////////////////////////////////////////////////////////////////////////
        this.framer.addEventListener("frameupdate", (event) => {
            this.timeline.updateIndex(event.frame);
        });
        ////////////////////////////////////////////////////////////////////////
        //
        ////////////////////////////////////////////////////////////////////////
        this.timeline.addEventListener("dragStart", (event) => {
            if (event.elem.classList.contains("channel") && event.subject.id != 0) {
                const channel = event.subject;
                this.selectChannel(channel);
            }
            if (event.sourceEvent.shiftKey) {
                this.timeline.timeline.style("cursor", "grabbing");
                this.timeline.pan(event);
            }
            else if (event.sourceEvent.ctrlKey) {
                if (this.state.mode == eventerEnum.INSTANT) {
                    const frame = event.frame;
                    const channel = event.subject;
                    const instant = this.createInstant(frame, channel);
                    this.selectInstant(instant);
                    this.timeline.update();
                    this.updateEventTable();
                    orderElements(this.state.mode);
                }
                else if (this.state.mode == eventerEnum.INTERVAL) {
                    const frame = event.frame;
                    const channel = event.subject;
                    const interval = this.createInterval(frame, channel);
                    this.selectInterval(interval);
                    this.timeline.update();
                    this.updateEventTable();
                    orderElements(this.state.mode);
                }
            }
        });
        this.timeline.addEventListener("drag", (event) => {
            if (event.sourceEvent.shiftKey) {
                this.timeline.pan(event);
            }
            else if (event.sourceEvent.ctrlKey) {
                if (this.state.mode == eventerEnum.INSTANT) {
                    if (this.state.currentInstant !== null) {
                        // not supposed to be permanent
                        const frame = event.frame;
                        this.state.currentInstant.frame = frame;
                        this.framer.setFrame(event.frame);
                        this.timeline.update();
                        this.updateEventTable();
                    }
                }
                else if (this.state.mode == eventerEnum.INTERVAL) {
                    if (this.state.currentInterval != null) {
                        const interval = this.state.currentInterval;
                        interval.dragged = true;
                        if (event.frame > interval.down) {
                            interval.start = interval.down;
                            interval.end = event.frame;
                        }
                        else {
                            interval.end = interval.down;
                            interval.start = event.frame;
                        }
                        this.framer.setFrame(event.frame);
                        this.timeline.update();
                        this.updateEventTable();
                    }
                }
            }
            else if (this.framer.getFrame() != event.frame) {
                this.framer.setFrame(event.frame);
                this.timeline.updateIndex(event.frame);
            }
        });
        this.timeline.addEventListener("dragEnd", (event) => {
            if (event.sourceEvent.shiftKey) {
                this.timeline.timeline.style("cursor", "grab");
            }
            else if (event.sourceEvent.ctrlKey) {
            }
            else if (this.framer.getFrame() != event.frame) {
                this.framer.setFrame(event.frame);
                this.timeline.updateIndex(event.frame);
            }
            // clean up from dragging a newly created instant or interval
            if (this.state.currentInstant != null) {
                if (this.state.currentInstant.down != null) {
                    if (this.state.currentInstant.down != this.state.currentInstant.frame) {
                        this.editInstant(this.state.currentInstant, event.frame);
                        this.timeline.updateIndex(event.frame);
                        this.updateEventTable();
                    }
                    this.state.currentInstant.down = null;
                    this.selectInstant(this.state.currentInstant);
                }
            }
            if (this.state.currentInterval != null) {
                const interval = this.state.currentInterval;
                if (interval.down != null && interval.dragged) {
                    const start = Math.min(event.frame, interval.down);
                    const end = Math.max(event.frame, interval.down);
                    this.editInterval(interval, start, end);
                    this.timeline.updateIndex(event.frame);
                    this.updateEventTable();
                }
                else {
                    const start = Math.min(event.frame, interval.down);
                    const end = Math.max(event.frame, interval.down);
                    if (end - start < 2) {
                        this.deleteInterval(interval);
                        this.deselectInterval();
                        return;
                    }
                }
                interval.down = null;
                interval.dragged = false;
                this.selectInterval(this.state.currentInterval);
            }
        });
        ////////////////////////////////////////////////////////////////////////
        //
        ////////////////////////////////////////////////////////////////////////
        this.timeline.addEventListener("dragInstantStart", (event) => {
            if (event.sourceEvent.ctrlKey) {
                this.selectInstant(event.subject).style("cursor", "move");
                const instant = event.subject;
                const frame = event.frame;
                instant.down = frame;
                instant.dragged = false;
            }
            else if (this.framer.getFrame() != event.frame) {
                this.framer.setFrame(event.frame);
                this.timeline.updateIndex(event.frame);
            }
        });
        this.timeline.addEventListener("dragInstant", (event) => {
            if (event.sourceEvent.ctrlKey) {
                const instant = event.subject;
                const frame = event.frame;
                instant.frame = frame;
                instant.dragged = true;
                this.framer.setFrame(event.frame);
                this.timeline.update();
                this.updateEventTable();
            }
        });
        this.timeline.addEventListener("dragInstantEnd", (event) => {
            const instant = event.subject;
            d3.select(event.elem)
              .style("cursor", "pointer");
            if (instant.down != instant.frame && instant.dragged) {
                this.editInstant(instant, event.frame);
                this.timeline.updateIndex(event.frame);
                this.updateEventTable();
            }
            instant.down = null;
            instant.dragged = false;
        });
        ////////////////////////////////////////////////////////////////////////
        //
        ////////////////////////////////////////////////////////////////////////

        this.timeline.addEventListener("dragIntervalStart", (event) => {
            if (event.sourceEvent.ctrlKey) {
                if (this.state.mode == eventerEnum.INSTANT) {
                    const frame = event.frame;
                    const channel = event.subject.channel;
                    const instant = this.createInstant(frame, channel);
                    this.selectInstant(instant);
                    this.timeline.update();
                    this.updateEventTable();
                    orderElements(this.state.mode);
                }
                if (this.state.mode == eventerEnum.INTERVAL) {
                    d3.select(event.elem).style("cursor", "move");
                    const interval = event.subject;
                    interval.down = event.frame;                
                    interval.downstart = interval.start;
                    interval.downend = interval.end;
                    this.selectInterval(interval);
                }
            }
            else {
                const channel = event.subject.channel;
                this.selectChannel(channel);
                this.framer.setFrame(event.frame);
                this.timeline.updateIndex(event.frame);
            }
        });
        this.timeline.addEventListener("dragInterval", (event) => {
            if (event.sourceEvent.ctrlKey) {
                if (this.state.mode == eventerEnum.INSTANT) {
                    if (this.state.currentInstant !== null) {
                        // not supposed to be permanent
                        const frame = event.frame;
                        this.state.currentInstant.frame = frame;
                        this.framer.setFrame(event.frame);
                        this.timeline.update();
                        this.updateEventTable();
                    }
                }
                else if (this.state.mode == eventerEnum.INTERVAL) {
                    if (this.state.currentInterval != null) {
                        this.state.currentInterval.dragged = true;
                        const diff = event.frame - this.state.currentInterval.down;
                        this.state.currentInterval.start = this.state.currentInterval.downstart + diff;
                        this.state.currentInterval.end = this.state.currentInterval.downend + diff;
                        this.timeline.update();
                        this.updateEventTable();
                    }
                }
            }
        });
        this.timeline.addEventListener("dragIntervalEnd", (event) => {
            d3.select(event.elem)
              .style("cursor", "pointer");
            if (this.state.currentInterval != null && this.state.currentInterval.dragged) {
                const start = this.state.currentInterval.start;
                const end = this.state.currentInterval.end;
                this.editInterval(this.state.currentInterval, start, end);
                this.state.currentInterval.dragged = false;
                this.state.currentInterval.down = undefined;                
                this.state.currentInterval.downstart = undefined;
                this.state.currentInterval.downend = undefined;
                this.timeline.update();
                this.updateEventTable();
            }

            // clean up from dragging a newly created instant or interval
            if (this.state.currentInstant != null) {
                if (this.state.currentInstant.down != null) {
                    if (this.state.currentInstant.down != this.state.currentInstant.frame) {
                        this.editInstant(this.state.currentInstant, event.frame);
                        this.timeline.updateIndex(event.frame);
                        this.updateEventTable();
                    }
                    this.state.currentInstant.down = null;
                    this.selectInstant(this.state.currentInstant);
                }
            }
        });

        this.timeline.addEventListener("dragIntervalLeftStart", (event) => {
            d3.select(event.elem)
              .style("cursor", "ew-resize");
            if (event.sourceEvent.ctrlKey) {
                const interval = event.subject;
                interval.down = event.frame;
                interval.downstart = interval.start;
                interval.downend = interval.end;
                this.selectInterval(interval);
            }
        });
        this.timeline.addEventListener("dragIntervalLeft", (event) => {
            if (event.sourceEvent.ctrlKey) {
                if (this.state.currentInterval != null) {
                    this.state.currentInterval.dragged = true;
                    this.state.currentInterval.start = event.frame;
                    this.framer.setFrame(event.frame);
                    this.timeline.update();
                    this.updateEventTable();
                }
            }
        });
        this.timeline.addEventListener("dragIntervalLeftEnd", (event) => {
            d3.select(event.elem)
              .style("cursor", "pointer");
            if (this.state.currentInterval != null && this.state.currentInterval.dragged) {
                const interval = this.state.currentInterval;
                this.editInterval(this.state.currentInterval, interval.start, interval.end);
                interval.dragged = false;
                interval.down = undefined;                
                interval.downstart = undefined;
                interval.downend = undefined;
            }
        });


        this.timeline.addEventListener("dragIntervalRightStart", (event) => {
            d3.select(event.elem)
              .style("cursor", "ew-resize");
            if (event.sourceEvent.ctrlKey) {
                const interval = event.subject;
                interval.down = event.frame;
                interval.downstart = interval.start;
                interval.downend = interval.end;
                this.selectInterval(interval);
            }
        });
        this.timeline.addEventListener("dragIntervalRight", (event) => {
            if (event.sourceEvent.ctrlKey) {
                if (this.state.currentInterval != null) {
                    this.state.currentInterval.dragged = true;
                    this.state.currentInterval.end = event.frame;
                    this.framer.setFrame(event.frame);
                    this.timeline.update();
                    this.updateEventTable();
                }
            }
        });
        this.timeline.addEventListener("dragIntervalRightEnd", (event) => {
            d3.select(event.elem)
              .style("cursor", "pointer");
            if (this.state.currentInterval != null && this.state.currentInterval.dragged) {
                const interval = this.state.currentInterval;
                this.editInterval(this.state.currentInterval, interval.start, interval.end);
                interval.dragged = false;
                interval.down = undefined;                
                interval.downstart = undefined;
                interval.downend = undefined;
            }
        });
        ////////////////////////////////////////////////////////////////////////
        //
        ////////////////////////////////////////////////////////////////////////

        window.addEventListener("resize", () => {
            this.positionEventTable(this.eventtable);
            this.changeChannel();
        });
    }

    bindkeys(classMap, intervalClassMap, keybindings) {
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
                keymap[key+false+true] = fun;
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
            if (textinpt()) {
                if (event.key == "Enter") {
                    document.activeElement.blur();
                }
                return;
            }
            const fun = keymap[CSS.escape(event.key.toLowerCase()) + event.shiftKey + event.ctrlKey] || "";
            switch(fun) {
                case "forward":
                    this.framer.stepForward();
                    break;
                case "superForward":
                    this.framer.stepForward(10);
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
                case "superBackward":
                    this.framer.stepBackward(10);
                    break;
                case "undo":
                    this.undo();
                    this.timeline.update();
                    this.updateEventTable();
                    break;
                case "redo":
                    this.redo();
                    this.timeline.update();
                    this.updateEventTable();
                    break;
                case "grabbableShift":
                    this.timeline.timeline.style("cursor", "grab");
                    break;
                case "grabbableCtrl":
                    d3.selectAll(".instant")
                      .style("cursor", "pointer");
                    d3.selectAll(".interval")
                      .style("cursor", "pointer");
                    break;
                case "channeldown":
                    this.channelDown();
                    break;
                case "channelup":
                    this.channelUp();
                    break;
                case "editForward":
                    const selEditForward = d3.select(".event.selected").node();
                    if (selEditForward !== null) {
                        this.framer.setFrame(selEditForward.__data__.frame + 1)
                        this.timeline.updateIndex(selEditForward.__data__.frame + 1);
                        this.editInstantFrame(selEditForward.__data__, 
                                              selEditForward.__data__.frame,
                                              selEditForward.__data__.frame + 1)
                        this.updateEventTable();
                        this.timeline.update();
                    }
                    break;
                case "editBackward":
                    const selEditBackward = d3.select(".event.selected").node();
                    if (selEditBackward !== null) {
                        this.framer.setFrame(selEditBackward.__data__.frame - 1)
                        this.timeline.updateIndex(selEditBackward.__data__.frame - 1);
                        this.editInstantFrame(selEditBackward.__data__, 
                                              selEditBackward.__data__.frame,
                                              selEditBackward.__data__.frame - 1)
                        this.updateEventTable();
                        this.timeline.update();
                    }
                    break;
                case "superEditForward":
                    const selSuperEditForward = d3.select(".event.selected").node();
                    if (selSuperEditForward !== null) {
                        this.framer.setFrame(selSuperEditForward.__data__.frame + 10)
                        this.timeline.updateIndex(selSuperEditForward.__data__.frame + 10);
                        this.editInstantFrame(selSuperEditForward.__data__, 
                                              selSuperEditForward.__data__.frame,
                                              selSuperEditForward.__data__.frame + 10)
                        this.updateEventTable();
                        this.timeline.update();
                    }
                    break;
                case "superEditBackward":
                    const selSuperEditBackward = d3.select(".event.selected").node();
                    if (selSuperEditBackward !== null) {
                        this.framer.setFrame(selSuperEditBackward.__data__.frame - 10)
                        this.timeline.updateIndex(selSuperEditBackward.__data__.frame - 10);
                        this.editInstantFrame(selSuperEditBackward.__data__, 
                                              selSuperEditBackward.__data__.frame,
                                              selSuperEditBackward.__data__.frame - 10)
                        this.updateEventTable();
                        this.timeline.update();
                    }
                    break;
                case "playpause":
                    if (this.framer.video.paused) {
                        this.framer.video.play();
                    }
                    else {
                        this.framer.video.pause();
                    }
                    break;
                case "escape":
                    d3.selectAll(".selected")
                      .classed("selected", false);
                    this.currentEventIdx = null;
                    this.currentInvervalIdx = null;
                    break;
                case "changemode":
                    event.preventDefault();
                    if (this.state.mode == eventerEnum.INSTANT) {
                        this.state.mode = eventerEnum.INTERVAL;
                        d3.select(".instant-class-ref")
                          .style("display", "none");
                        d3.select(".interval-class-ref")
                          .style("display", undefined);
                    }
                    else if (this.state.mode == eventerEnum.INTERVAL) {
                        this.state.mode = eventerEnum.INSTANT;
                        d3.select(".instant-class-ref")
                          .style("display", undefined);
                        d3.select(".interval-class-ref")
                          .style("display", "none");
                    }
                    orderElements(this.state.mode);
                    document.querySelector(".emode").innerText = this.state.mode;
                    break;

                case "delete":
                    if (this.state.currentInstant !== null) {
                        this.deleteInstant(this.state.currentInstant);
                        this.deselectInstant();
                        this.timeline.update();
                        this.updateEventTable();
                    }
                    else if (this.state.currentInterval !== null) {
                        this.deleteInterval(this.state.currentInterval);
                        this.deselectInterval();
                        this.timeline.update();
                        this.updateEventTable();
                    }
                    this.state.currentEventIdx = null;
                    this.state.currentIntervalIdx = null;
                    break;

                case "submit":
                    if (this.state.state == stateEnum.READY || this.state.state == stateEnum.IDLE) {
                        this.state.state = stateEnum.CONFIRM;
                        this.stateChanged({state: this.state.state});
                        this.confirmed();
                    }
                    else if (this.state.state == stateEnum.CONFIRM) {
                        this.state.state = stateEnum.SUBMIT;
                        this.stateChanged({state: this.state.state});
                        const end = Date.now();
                        const state = prepareOutput(this.state);
                        this.submitted({
                            data: {
                                instants: state.instants,
                                intervals: state.intervals,
                                timestamp: end,
                                workingTime: end - this.start,
                                maxFrame: this.maxFrame,
                            },
                            state: state
                        });
                    }
                    break;

                default:
                    break;
            }
        });


        document.addEventListener("keyup", (event) => {
            if (textinpt()) {
                return;
            }
            const fun = keymap[CSS.escape(event.key.toLowerCase()) + event.shiftKey + event.ctrlKey] || "";
            switch(fun) {
                case "grabbableShift":
                    this.timeline.timeline.style("cursor", null);
                    break;
                case "grabbableCtrl":
                    d3.selectAll(".instant")
                      .style("cursor", null);
                    d3.selectAll(".interval")
                      .style("cursor", null);
                    break;
                case "pointable":
                    d3.selectAll(".event").classed("point", false);
                    break;
                default:
                    break;
            }
        });

        document.addEventListener("keydown", (event) => {
            if (textinpt()) {
                return;
            }
            if (this.state.mode == eventerEnum.INSTANT) {
                // animate key references
                const ekey = CSS.escape(event.key.toLowerCase());
                const key = document.querySelectorAll(`.key-${ekey}`);
                // maybe update class selection, and if so reset selection indicator
                const cls = classMap[ekey];
                if (cls === undefined) return;
                const frame = this.framer.getFrame();
                const channel = this.state.currentChannel;
                const clazz = cls.class;
                const interval = this.createInstant(frame, channel, clazz);
                this.selectInterval(interval);
                this.timeline.update();
                this.updateEventTable();
                orderElements(this.state.mode);
            }
            else if (this.state.mode == eventerEnum.INTERVAL && this.state.currentInterval !== undefined) {
                // animate key references
                const ekey = CSS.escape(event.key.toLowerCase());
                const key = document.querySelectorAll(`.key-${ekey}`);
                // maybe update class selection, and if so reset selection indicator
                const cls = intervalClassMap[ekey];
                if (cls === undefined) return;
                this.state.currentInterval.clazz = cls.class;
                this.timeline.update();
                this.updateEventTable();
                orderElements(this.state.mode);
            }
        });
        return this;
    }

    //--------------------------------------------------------------------------
    // Classifier Reference
    //--------------------------------------------------------------------------

    channelUp() {
        const i = Math.max(1, this.state.currentChannel.id - 1);
        this.state.currentChannel = this.timeline.state.channels[i];
        this.changeChannel();
    }

    channelDown() {
        const i = Math.min(this.timeline.state.channels.length -1, this.state.currentChannel.id + 1);
        this.state.currentChannel = this.timeline.state.channels[i];
        this.changeChannel();
    }

    changeChannel() {
        const elem = document
                  .querySelector(`.channellabel:nth-child(${this.state.currentChannel.id + 2})`);
        const bcr = document
                  .querySelector(`.channellabel:nth-child(${this.state.currentChannel.id + 2})`)
                  .getBoundingClientRect();
        const height = document.querySelector(".channel-pointer").getBoundingClientRect().height;

        const mainBcr = document.querySelector("svg").getBoundingClientRect();
        d3.select(".channel-pointer")
          .style("top", `${elem.offsetTop+(bcr.height/2)-(height/2)}`)
          .style("left", `${mainBcr.x - 30}`);

    }

    ////////////////////////////////////////////////////////////////////////////
    //
    ////////////////////////////////////////////////////////////////////////////
    deselectInstant() {
        this.state.currentInstant = null;
        d3.selectAll(".eventcell")
          .classed("selected", false);

        d3.selectAll(".instant")
          .classed("selected", false);
    }

    deselectInterval() {
        this.state.currentInterval = null;
        d3.selectAll(".intervalcell")
          .classed("selected", false);

        d3.selectAll(".interval")
          .classed("selected", false);
    }

    selectInstant(instant) {
        this.deselectInterval();

        this.state.currentInstant = instant;
        d3.selectAll(".eventcell ")
          .classed("selected", false)
          .filter((d) => d == this.state.currentInstant)
          .classed("selected", true);

        d3.selectAll(".instant input")
          .each(function(){this.readOnly = true});
        return d3.selectAll(".instant")
          .classed("selected", false)
          .filter(function(d) {return d.id == instant.id;})
          .classed("selected", true);
    }

    selectInterval(interval) {
        this.deselectInstant();
        this.state.currentInterval = interval;

        d3.selectAll(".intervalcell ")
          .classed("selected", false)
          .filter((d) => d == this.state.currentInterval)
          .classed("selected", true);

        return d3.selectAll(".interval")
          .classed("selected", false)
          .filter(function(d) {return d.id == interval.id;})
          .classed("selected", true);
    }

    selectChannel(channel) {
        this.state.currentChannel = channel;
        this.changeChannel(channel);
    }

    //--------------------------------------------------------------------------

    createInstant(frame, channel, clazz) {
        const instant = {id: ++this.instantIdCounter,
                         down: frame,
                         frame: frame,
                         channel: channel,
                         clazz: clazz,
                         note: null,
                         metadata: null
                        };
        const action = {type: "createInstant", instant: instant};
        this.do(action);
        return instant;
    }

    createInterval(frame, channel, clazz) {
        const interval = {id: ++this.intervalIdCounter,
                          down: frame,
                          start: frame,
                          end: null,
                          channel: channel,
                          clazz: clazz,
                          note: null,
                          metadata: null
                        }
        const action = {type: "createInterval", interval: interval};
        this.do(action);
        return interval;
    }

    //--------------------------------------------------------------------------

    editInstant(instant, frame) {
        const action = {
            type: "editInstant",
            instant: instant,
            from: instant.down,
            to: frame
        };
        this.do(action)
        return instant;
    }

    editInterval(interval, start, end) {
        const action = {
            type: "editInterval",
            interval: interval,
            startfrom: interval.downstart,
            startto: start,
            endfrom: interval.downend,
            endto: end
        };
        this.do(action)
        return interval;
    }

    //--------------------------------------------------------------------------

    deleteInstant(instant) {
        const action = {type: "deleteInstant",
                        instant: instant};
        this.do(action);
    }

    deleteInterval(interval) {
        const action = {type: "deleteInterval",
                        interval: interval};
        this.do(action);
    }

    //--------------------------------------------------------------------------
    // Stack Tracked Actions
    //--------------------------------------------------------------------------

    forwardAction(action) {
        switch (action.type) {
            case "createInstant":
                this.timeline.state
                    .channels[action.instant.channel.id]
                    .instants.push(action.instant);
                this.state.instants.push(action.instant);
                break;
            case "createInterval":
                this.timeline.state
                    .channels[action.interval.channel.id]
                    .intervals.push(action.interval);
                this.state.intervals.push(action.interval);
                break;
            case "editInstant":
                action.instant.frame = action.to;
                break;
            case "editInterval":
                action.interval.start = action.startto;
                action.interval.end = action.endto;
                break;
            case "deleteInstant": {
                let channel = this.timeline.state.channels[action.instant.channel.id];
                let idx = channel.instants.findIndex(
                    instant => instant.id == action.instant.id
                );
                channel.instants.splice(idx, 1);
                //
                idx = this.state.instants.findIndex(
                    instant => instant.id == action.instant.id
                );
                this.state.instants.splice(idx, 1);
                break;
            }
            case "deleteInterval": {
                let channel = this.timeline.state.channels[action.interval.channel.id];
                let idx = channel.intervals.findIndex(
                    interval => interval.id == action.interval.id
                );
                channel.intervals.splice(idx, 1);
                //
                idx = this.state.intervals.findIndex(
                    interval => interval.id == action.interval.id
                );
                this.state.intervals.splice(idx, 1);
                break;
            }
            default:
                break;
        }
    }

    reverseAction(action) {
        switch (action.type) {
            case "createInstant": {
                let channel = this.timeline.state.channels[action.instant.channel.id];
                let idx = channel.instants.findIndex(
                    instant => instant.id == action.instant.id
                );
                channel.instants.splice(idx, 1);
                //
                idx = this.state.instants.findIndex(
                    instant => instant.id == action.instant.id
                );
                this.state.instants.splice(idx, 1);
                break;
            }
            case "createInterval": {
                let channel = this.timeline.state.channels[action.interval.channel.id];
                let idx = channel.intervals.findIndex(
                    interval => interval.id == action.interval.id
                );
                channel.intervals.splice(idx, 1);
                //
                idx = this.state.intervals.findIndex(
                    interval => interval.id == action.interval.id
                );
                this.state.intervals.splice(idx, 1);
                break;
            }
            case "editInstant":
                action.instant.frame = action.from;
                break;
            case "editInterval":
                action.interval.start = action.startfrom;
                action.interval.end = action.endfrom;
                break;
            case "deleteInstant": {
                this.timeline.state
                    .channels[action.instant.channel.id]
                    .instants.push(action.instant);
                this.state.instants.push(action.instant);
                break;
            }
            case "deleteInterval": {
                this.timeline.state
                    .channels[action.interval.channel.id]
                    .intervals.push(action.interval);
                this.state.intervals.push(action.interval);
                break;
            }
            default:
                break;
        }
    }

    do(action) {
        this.state.state = stateEnum.READY;
        this.stateChanged({state: this.state.state});
        if (this.state.redoStack.length > 0) {
            this.state.redoStack = [];
        }
        this.forwardAction(action);
        this.state.undoStack.push(action);
    }

    undo() {
        if (this.state.undoStack.length > 0) {
            const action = this.state.undoStack.pop();
            this.reverseAction(action);
            this.state.redoStack.push(action);
        }
    }

    redo() {
        if (this.state.redoStack.length > 0) {
            const action = this.state.redoStack.pop();
            this.forwardAction(action);
            this.state.undoStack.push(action);
        }
    }

    updateEventTable() {
        const _this = this;
        this.eventtable
            .selectAll(".eventcell")
            .data(this.state.instants, d=>d.id)
            .join(enter => this.enterEvent(enter),
                  update => this.updateEvent(update));
        this.eventtable
            .selectAll(".intervalcell")
            .data(this.state.intervals, d=>d.id)
            .join(enter => this.enterInterval(enter),
                  update => this.updateInterval(update))
        this.eventtable
            .selectAll(".eventcell, .intervalcell")
            .sort(function(a, b){return (a.frame || a.start) > (b.frame || b.start);})
            .on("click", function(event){
                console.log("clicked cell");
                d3.selectAll(".eventcell, .intervalcell").classed("selected", false);
                d3.select(this).classed("selected", true);
                d3.selectAll(".event, .interval")
                  .classed("selected", false)
                  .filter((d) => {return d == this.__data__;})
                  .classed("selected", true);
                let cellFrame = "frame" in this.__data__ ? this.__data__.frame : this.__data__.start;
                _this.framer.setFrame(cellFrame);
                _this.timeline.updateIndex(cellFrame);
                console.log("done clicked cell");
            })
    }

    enterEvent(enter) {
        const _this = this;
        const cell = enter.append("div")
                          .attr("class", "eventcell clickable");
        cell.append("div")
            .attr("class", "eframe")
            .text("frame: ")
            .append("span")
            .text(d => d.frame);
        cell.append("div")
            .attr("class", "etime")
            .text("time: ")
            .append("span")
            .text(d => formatTime(frameToTime(this.framer, d.frame)));
        cell.append("div")
            .attr("class", "echannel")
            .text("channel: ")
            .append("span")
            .text(d => d.channel.name);
        cell.append("div")
            .attr("class", "eclass")
            .text("class: ")
            .append("input")
            .attr("list", "instant-classes")
            .each(function(d) {
                this.value = d.clazz === undefined ? "" : d.clazz;
            })
            .on("input", function() {
                d3.select(this).node().__data__.clazz = this.value
                _this.timeline.update();
            });
        cell.each(function() {
            d3.selectAll(".eventcell").classed("selected", false);
            d3.select(this).classed("selected", true);
        });
        if (cell.node() != null) {
            d3.selectAll(".event")
              .classed("selected", false)
              .filter(function(d){return cell.node().__data__.id == d.id;})
              .classed("selected", true);
        }
        return cell;
    }

    updateEvent(update) {
        update.selectAll(".eventcell .eframe span")
              .text(d => d.frame);
        update.selectAll(".eventcell .etime span")
              .text(d => formatTime(frameToTime(this.framer, d.frame)));
        update.selectAll(".eventcell .eclass span")
              .each(function(d) {
                  this.value = d.clazz === undefined ? "" : d.class;
              });

        update.selectAll(".eventcell .echannel span")
              .text(d => d.channel.name);
    }

    enterInterval(enter) {
        const cell = enter.append("div")
                          .attr("class", "intervalcell clickable");
        const _this = this;
        cell.append("div")
            .attr("class", "estart")
            .text("s.frame: ")
            .append("span")
            .text(d => d.start);
        cell.append("div")
            .attr("class", "eend")
            .text("e.frame: ")
            .append("span")
            .text(d => d.end);
        cell.append("div")
            .attr("class", "estartt")
            .text("s.time: ")
            .append("span")
            .text(d => formatTime(frameToTime(this.framer, d.start)));
        cell.append("div")
            .attr("class", "eendt")
            .text("e.time: ")
            .append("span")
            .text(d => formatTime(frameToTime(this.framer, d.end)));
        cell.append("div")
            .attr("class", "echannel")
            .text("channel: ")
            .append("span")
            .text(d => d.channel.name);
        cell.append("div")
            .attr("class", "eclass")
            .text("class: ")
            .append("input")
            .attr("list", "interval-classes")
            .each(function(d) {
                this.value = d.clazz === undefined ? "" : d.clazz;
            })
            .on("input", function() {
                d3.select(this).node().__data__.clazz = this.value
                _this.timeline.update();
            });

        cell.each(function() {
            d3.selectAll(".intervalcell").classed("selected", false);
            d3.select(this).classed("selected", true);
        });
        if (cell.node() != null) {
            d3.selectAll(".interval")
              .classed("selected", false)
              .filter(function(d){return cell.node().__data__.id == d.id;})
              .classed("selected", true);
            return cell;
        }
    }

    updateInterval(update) {
        update.selectAll(".intervalcell .estart span")
              .text(d => d.start);
        update.selectAll(".intervalcell .estartt span")
              .text(d => {
                  if (d.start !== undefined)
                    formatTime(frameToTime(this.framer, d.start));
               });
        update.selectAll(".intervalcell .eend span")
              .text(d => d.end);
        update.selectAll(".intervalcell .eendt span")
              .text(d => {
                  if (d.end !== undefined)
                    formatTime(frameToTime(this.framer, d.end))
                });
        update.selectAll(".intervalcell .eclass span")
              .each(function(d) {
                  this.value = d.class === undefined ? "" : d.class;
              });
        update.selectAll(".intervalcell .echannel span")
              .text(d => d.channel.name);

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


function orderElements(mode) {
    const reversed = mode == eventerEnum.INTERVAL;
    document.querySelectorAll(".channel")
            .forEach(channel => {
                [...channel.children]
                .filter(elem => {return elem.classList.contains("instant") ||
                                        elem.classList.contains("interval");
                })
                .sort(reversed
                     ? (a, b) => a.classList.contains("instant") <= b.classList.contains("instant")
                     : (a, b) => a.classList.contains("instant") > b.classList.contains("instant")
                )
                .forEach(elem => channel.appendChild(elem));
            })
    d3.selectAll(".instant")
      .classed("offmode", mode !== eventerEnum.INSTANT);
    d3.selectAll(".interval")
      .classed("offmode", mode !== eventerEnum.INTERVAL);
}

function textinpt() {
    const active = document.activeElement;
    return [...document.querySelectorAll("input")].some(e => e === active);
}

function prepareOutput(state) {
    state.instants.forEach((instant, i) => {
        state.instants[i] = {
            id: instant.id,
            frame: instant.frame,
            channel: instant.channel.name,
            channelid: instant.channel.id,
            "label": instant.clazz
        }
    });
    state.intervals.forEach((interval, i) => {
        state.intervals[i] = {
            id: interval.id,
            start: interval.start,
            end: interval.end,
            channel: interval.channel.name,
            channelid: interval.channel.id,
            "label": interval.clazz
        }
    });
    return state;
}
