import {Framer} from "framewrangler";
import {VidState} from "./vidstate";
import {Timeline} from "./timeline";
import {controllDummyKeyboard, formatTime, frameToTime} from "./utils";
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

        {fun: "grabbable", key: "shift", description: "grabbable"},
        {fun: "pointable", key: "control", description: "grabbable"},
    ]
};


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
            channels: config.channels || [],
            instants: [],
            intervals: [],

            currentChannel: null,
            currentInstant: null,
            currentInterval: null,

            instantIdCounter: 0,
            intervalIdCounter: 0,

            currentEventIdx: null,
            currentInvervalIdx: null,
            currentChannelIdx: 1,

            undoStack: [],
            redoStack: [],
            mode: eventerEnum.INSTANT
        };
        if (this.state.channels.length == 0)
            this.state.currentChannel = null;
        else if (this.state.channels.length == 1)
            this.state.currentChannel = this.state.channels[0];
        else
            this.state.currentChannel = this.state.channels[1];
        ////////////////////////////////////////////////////////////////////////
        // Set up
        ////////////////////////////////////////////////////////////////////////
        this.config = config;
        this.element = this.config.element;
        this.framer = this.initFramer(config);
        this.vidstate = this.initVidState(config);
        this.timeline = this.initTimeline(config);
        this.eventtable = this.initEventTable(config);
        this.classMap = this.initClassMap(config);
        this.channelIndicator = this.initChannelIndicator(config);
        this.init();

        this.keybindings = this.config.keybindings || OPTS.keybindings;

        ////////////////////////////////////////////////////////////////////////
        // Events
        ////////////////////////////////////////////////////////////////////////
        this.events = {
            "submitted": [],
            "confirmed": [],
            "navigated": [],
            "selected": [],
            "edited": [],
        }


        this.tieEventsTogether();
        this.bindkeys(this.classMap, this.keybindings);
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
        return new Framer(config.element.querySelector("video"), config.fps);
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
        this.positionEventTable(eventtable);
        return eventtable;
    }

    positionEventTable(eventtable) {
        const bcr = this.element.getBoundingClientRect();
        const timelineBcr = this.timeline.element.getBoundingClientRect();
        const height = (timelineBcr.top + timelineBcr.height) - bcr.top;
        eventtable.style("top", `${bcr.top}px`)
                  .style("left", `${bcr.right}px`)
                  .style("height", `${height}px`);
    }

    initClassMap(config) {
        // sets up the class reference/selction indicator DOM
        const items = d3.select(config.element)
                        .append("div")
                        .attr("class", "class-ref")
                        .selectAll("div")
                        .data(config.classes).enter()
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
        config.classes.forEach(e => {
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
        this.changeChannel();
    }

    init() {
        //this.stateChanged({state: this.state.state});
        document.querySelector(".emode").innerText = this.state.mode;
    }

    tieEventsTogether() {
        this.framer.addEventListener("frameupdate", (event) => {
            this.timeline.updateIndex(event.frame);
        });
        this.timeline.addEventListener("dragStart", (event) => {
            if (event.sourceEvent.shiftKey) {
                this.timeline.pan(event);
                this.timeline.timeline.classed("grabbing", true);
            }
            else if (event.sourceEvent.ctrlKey) {
                if (this.state.mode == eventerEnum.INSTANT) {
                    this.createEvent(event);
                    this.state.currentEventIdx = this.instantIdCounter;
                    this._frame = event.frame;
                    this.timeline.update();
                    this.updateEventTable();
                }
                else if (this.state.mode == eventerEnum.INTERVAL) {
                    this._intervalCreator = {
                        id: ++this.intervalIdCounter,
                        channel: event.subject.id,
                        down: event.frame,
                        created: false,
                        start: event.frame,
                        end: undefined
                    };
                    this.createInterval(this._intervalCreator);
                    this.timeline.update();
                }
            }
            else if (event.elem.classList.contains("channel") && event.subject.id != 0) {
                this.state.currentChannelIdx = event.subject.id;
                this.changeChannel();
            }
        });
        this.timeline.addEventListener("drag", (event) => {
            if (event.sourceEvent.shiftKey) {
                this.timeline.pan(event);
            }
            else if (event.sourceEvent.ctrlKey) {
                if (this.state.mode == eventerEnum.INSTANT) {
                    if (this.state.currentEventIdx !== null && this._frame === undefined) {
                        console.log("HI");
                        console.log(this._frame);
                        const instant = this.state.instants[this.state.instants.findIndex(x => x.id == this.state.currentEventIdx)];
                        this.editInstantFrame(instant, this._frame, event.frame);
                        this.timeline.update();
                        this.updateEventTable();
                    }
                }
                else if (this.state.mode == eventerEnum.INTERVAL) {
                    if (event.frame > this._intervalCreator.down) {
                        this._intervalCreator.start = this._intervalCreator.down;
                        this._intervalCreator.end = event.frame;
                    }
                    else {
                        this._intervalCreator.end = this._intervalCreator.down;
                        this._intervalCreator.start = event.frame;
                    }
                    this.editIntervalFrame(this._intervalCreator);
                    this.timeline.update();
                }
            }
            else if (this.framer.getFrame() != event.frame) {
                this.framer.setFrame(event.frame);
                this.timeline.updateIndex(event.frame);
            }
        });
        this.timeline.addEventListener("dragEnd", (event) => {
            if (event.sourceEvent.shiftKey) {
                this.timeline.timeline.classed("grabbing", false);
            }
            else if (this.framer.getFrame() != event.frame) {
                this.framer.setFrame(event.frame);
                this.timeline.updateIndex(event.frame);
            }
            this._frame = null;
        });

        this.timeline.addEventListener("dragInstantStart", (event) => {
            if (event.sourceEvent.ctrlKey) {
                this._frame = event.subject.frame;
                console.log(event, this._frame)
                d3.selectAll(".eventcell")
                  .classed("selected", false)
                  .filter(function(d) {return d.id == event.subject.id;})
                  .classed("selected", true);
                d3.selectAll(".event")
                 .classed("selected", false);
                d3.select(event.elem)
                  .classed("selected", true)
                  .style("cursor", "grabbing");
                this.state.currentEventIdx = event.subject.id;
            }
            else if (this.framer.getFrame() != event.frame) {
                this.framer.setFrame(event.frame);
                this.timeline.updateIndex(event.frame);
            }
        });
        this.timeline.addEventListener("dragInstant", (event) => {
            if (event.sourceEvent.ctrlKey) {
                console.log(event, this._frame)
                event.subject.frame = event.frame;
                this.timeline.update();
                this.updateEventTable();
                this.framer.setFrame(event.frame);
                this.timeline.updateIndex(event.frame);
                this._frame_dragged = true;
            }
        });
        this.timeline.addEventListener("dragInstantEnd", (event) => {
            if (this._frame !== undefined && this._frame_dragged) {
                console.log(event, this._frame, event.frame)
                this.editInstantFrame(event.subject, this._frame, event.frame);
                this.framer.setFrame(event.frame);
                this.timeline.updateIndex(event.frame);
            }
            d3.select(event.elem)
              .style("cursor", undefined);
            this._frame = undefined;
            this._frame_dragged = false;
        });


        this.timeline.addEventListener("click", (event) => {
            if (event.sourceEvent.shiftKey) {
            }
            else if (this.framer.getFrame() != event.frame) {
                this.framer.setFrame(event.frame);
                this.timeline.updateIndex(event.frame);
            }
        });


        window.addEventListener("resize", () => {
            this.positionEventTable(this.eventtable);
            this.changeChannel();
        });
    }

    bindkeys(classMap, keybindings) {
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
            const fun = keymap[CSS.escape(event.key.toLowerCase()) + event.shiftKey + event.ctrlKey] || "";
            console.log(event.key);
            switch(fun) {
                case "forward":
                    this.framer.stepForward();
                    break;
                case "superForward":
                    this.framer.stepForward(10);
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
                                class: this.state.class,
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
                case "grabbable":
                    this.timeline.timeline.classed("grab", true);
                    break;
                case "pointable":
                    d3.selectAll(".event").classed("point", true);
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
                    }
                    else if (this.state.mode == eventerEnum.INTERVAL) {
                        this.state.mode = eventerEnum.INSTANT;
                    }
                    document.querySelector(".emode").innerText = this.state.mode;
                    break;

                case "delete":
                    if (this.state.currentEventIdx !== null) {
                        const instantIdx = this.state.instants.findIndex(
                            e => e.id == this.state.currentEventIdx
                        );
                        this.state.instants[instantIdx].channelId = this.state.instants[instantIdx].channel;
                        this.deleteInstant(this.state.instants[instantIdx]);
                        this.timeline.update();
                        this.updateEventTable();
                    }
                    else if (this.state.currentInvervalIdx !== null) {
                        this.timeline.update();
                        this.updateEventTable();
                    }
                    this.state.currentEventIdx = null;
                    this.state.currentIntervalIdx = null;
                    break;
                default:
                    break;
            }
        });


        document.addEventListener("keyup", (event) => {
            const fun = keymap[CSS.escape(event.key.toLowerCase()) + event.shiftKey + event.ctrlKey] || "";
            switch(fun) {
                case "grabbable":
                    this.timeline.timeline.classed("grab", false);
                    this.timeline.timeline.classed("grabbing", false);
                    break;
                case "pointable":
                    d3.selectAll(".event").classed("point", false);
                    break;
                default:
                    break;
            }
        });

        document.addEventListener("keydown", (event) => {
            if (this.state.mode == eventerEnum.INSTANT) {
                // animate key references
                const ekey = CSS.escape(event.key.toLowerCase());
                const key = document.querySelectorAll(`.key-${ekey}`);
                // maybe update class selection, and if so reset selection indicator
                const cls = classMap[ekey];
                if (cls === undefined) return;
                const _class = cls.class;
                const frame = this.framer.getFrame();
                this.createKeyEvent({
                    frame: frame,
                    channel: this.state.currentChannelIdx,
                    id: ++this.eventIdCounter,
                    class: _class
                });
                this.state.currentEventIdx = this.eventIdCounter;
                this.timeline.update();
                this.updateEventTable();
            }
            else if (this.state.mode == eventerEnum.INTERVAL) {
                // animate key references
                const ekey = CSS.escape(event.key.toLowerCase());
                const key = document.querySelectorAll(`.key-${ekey}`);
                // maybe update class selection, and if so reset selection indicator
                const cls = classMap[ekey];
                if (cls === undefined) return;
                const _class = cls.class;
                const frame = this.framer.getFrame();

                this.createKeyInterval({
                    frame: frame,
                    channel: this.state.currentChannelIdx,
                    id: ++this.eventIdCounter,
                    class: _class
                });
                this.timeline.update();
                this.updateEventTable();
            }
        });
        return this;
    }

    //--------------------------------------------------------------------------
    // Classifier Reference
    //--------------------------------------------------------------------------

    channelUp() {
        this.state.currentChannelIdx = Math.max(
            1,
            this.state.currentChannelIdx - 1
        );
        this.changeChannel();
    }

    channelDown() {
        this.state.currentChannelIdx = Math.min(
            this.state.currentChannelIdx + 1,
            this.state.channels.length
        );
        this.changeChannel();
    }

    changeChannel() {
        const bcr = document
                  .querySelector(`.channel:nth-child(${this.state.currentChannelIdx + 1})`)
                  .getBoundingClientRect();
        const height = document.querySelector(".channel-pointer").getBoundingClientRect().height;

        const mainBcr = document.querySelector("svg").getBoundingClientRect();
        d3.select(".channel-pointer")
          .style("top", `${bcr.top+(bcr.height/2)-(height/2)}`)
          .style("left", `${mainBcr.x - 30}`);

    }

    //--------------------------------------------------------------------------
    // Stack Tracked Actions
    //--------------------------------------------------------------------------
    createEvent(event) {
        const channelId = event.subject.id;
        const e = {frame: event.frame, channelId: channelId, channel: this.timeline.state.channels[channelId].name, id: ++this.eventIdCounter}
        const action = {type: "create", channel: channelId, event: e};
        this.do(action);
    }

    createKeyEvent(event) {
        const action = {type: "create", channel: event.channel, event: event};
        this.do(action);
    }

    createInterval(interval) {
        console.log("create interval");
        const action = {type: "createInterval",
                        channel: interval.channel,
                        interval: interval};
        this.do(action);
    }

    createKeyInterval(event) {

    }

    editInstantFrame(event, fromFrame, toFrame) {
        const action = {type: "editFrame",
                        event: event,
                        fromFrame: fromFrame,
                        toFrame: toFrame,};
        this.do(action);
    }

    editIntervalFrame(interval) {
        const action = {type: "editIntervalFrame",
                        channel: interval.channel,
                        interval: interval};
        this.do(action);
    }

    deleteInstant(event) {
        const action = {type: "delete",
                        channel: event.channelId,
                        event: event}
        this.do(action);
    }

    forwardAction(action) {
        switch (action.type) {
            case "create":
                // timeline
                this.timeline
                    .state
                    .channels[action.channel]
                    .instants
                    .push(action.event);
                // table
                this.state.instants.push(action.event);
                break;
            case "editFrame":
                //timeline & table
                action.event.frame = action.toFrame;
                break;
            case "delete":
                console.log(this.timeline.state.channels, action);
                // timeline
                const channel = this.timeline
                                    .state
                                    .channels[action.channel];
                let instantIdx = channel.instants.findIndex(
                    e => e.id == action.event.id
                );
                channel.instants.splice(instantIdx, 1);
                // table
                instantIdx = this.state.instants.findIndex(
                    e => e.id == action.event.id
                );
                this.state.instants.splice(instantIdx, 1);

            case "createInterval":
                console.log(action);
                this.timeline
                    .state
                    .channels[action.channel]
                    .intervals
                    .push(action.interval);
                break;
            case "editIntervalFrame":
                //
                break;

            default:
                break;
        }
    }

    reverseAction(action) {
        switch (action.type) {
            case "create":
                // timeline
                const channel = this.timeline
                                    .state
                                    .channels[action.channel];
                let eventIdx = channel.instants.findIndex(
                    e => e.id == action.event.id
                );
                channel.instants.splice(eventIdx, 1);
                // table
                eventIdx = this.state.instants.findIndex(
                    e => e.id == action.event.id
                );
                this.state.instants.splice(eventIdx, 1);
                break;
            case "editFrame":
                //timeline & table
                action.event.frame = action.fromFrame;
            case "delete":
                // timeline
                this.timeline
                    .state
                    .channels[action.channel]
                    .instants
                    .push(action.event);
                // table
                this.state.instants.push(action.event);
                break;
            default:
                break;
        }
    }

    do(action) {
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
            .selectAll(".eventcell")
            .sort(function(a, b){return a.frame > b.frame;})
            .on("click", function(event){
                d3.selectAll(".eventcell").classed("selected", false);
                d3.select(this).classed("selected", true);
                d3.selectAll(".event")
                  .classed("selected", false)
                  .filter((d) => {return d.id == this.__data__.id;})
                  .classed("selected", true);

                _this.framer.setFrame(this.__data__.frame);
                _this.timeline.updateIndex(this.__data__.frame);
            });
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
            .text(d => d.channel);
        cell.append("div")
            .attr("class", "eclass")
            .text("class: ")
            .append("span")
            .text(d => d.class);
        cell.each(function() {
            d3.selectAll(".eventcell").classed("selected", false);
            d3.select(this).classed("selected", true);
            _this.framer.setFrame(this.__data__.frame);
            _this.timeline.updateIndex(this.__data__.frame);
        });
        if (cell.node() != null) {
            d3.selectAll(".event")
              .classed("selected", false)
              .filter(function(d){return cell.node().__data__.id == d.id;})
              .classed("selected", true);
        }
    }

    updateEvent(update) {
        update.selectAll(".eventcell .eframe span")
              .text(d => d.frame);
        update.selectAll(".eventcell .etime span")
              .text(d => formatTime(frameToTime(this.framer, d.frame)));
        update.selectAll(".eventcell .eclass span")
              .text(d => d.class);
        update.selectAll(".eventcell .echannel span")
              .text(d => d.channel);
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



