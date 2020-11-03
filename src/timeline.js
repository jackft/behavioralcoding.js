import WaveformData from 'waveform-data';
import * as d3 from "d3";

const OPTS = {
}

class WaveformChannelData {
    constructor(data) {

    }
}

export class Timeline {
    constructor(element, frames, opts=OPTS) {
        this.element = element;
        this.selection = d3.select(element);
        this.svg = null;

        this.channelCntr = 0;
        this.state = {
            indexes: [{type: "index", frame: 0}],
            channels: []
        };
        this.events = {
            "frameupdate": [],
            "click": [],
            "dragStart": [],
            "drag": [],
            "dragEnd": [],
        }

        this.timeline = this.build();

        this.svg.attr("width", "100%")
                .attr("height", opts.height || "50px");
        this.selection.style("height", opts.height || "50px");

        this.x = d3.scaleLinear()
                   .domain([0, frames])
                   .rangeRound([0, 800]);
        this.y = d3.scaleLinear()
                   .domain([0, 1])
                   .rangeRound([0, this.selection.style("height").slice(0, -2)]);

        // for zooming and panning
        this.xDown = undefined;
        this.xDrag = undefined;
        this.zoomCoef = 1.05;
        this.zoomFactor = 0;

        const z = this.zoomCoef**this.zoomFactor
        this.transformation = [0, z]; // we do not touch Y
    }

    build() {
        this.svg = this.selection.append("svg");
        const timeline = this.svg
                             .append("g")
                             .attr("class", "tl-main");

        const _this = this;
        // interactive stuff
        timeline
            .attr("pointer-events", "all")
            .on("wheel", (event) => {this.zoom(event); event.preventDefault();})
            .on("mousemove", (event, d) => {
                const frame = this.getFrame(d3.pointer(event)[0]);
                this.updateCursor(frame);
            })
            .on("mouseover", (event, d) => {
                const frame = this.getFrame(d3.pointer(event)[0]);
                this.updateCursor(frame);
            })
            .on("mouseleave", (event, d) => {
                const i = this.state.indexes.findIndex(x=>x.type == "cursor");
                this.state.indexes.splice(i, 1);
                this.update();
            })
            .call(d3.drag()
                    .on("start", function(event, d) {
                        _this.xDown = event.sourceEvent.clientX;
                        _this.xDrag = _this.transformation[0];
                        const frame = _this.getFrame(event.x);
                        _this.click({frame: frame, ...event});
                        _this.dragStart({frame: frame, ...event});
                        _this.frameupdate({frame: frame, ...event});
                    })
                    .on("drag", (event, d) => {
                        console.log("drag");
                        const frame = this.getFrame(event.x);
                        this.drag({frame: frame, ...event});
                        this.frameupdate({frame: frame, ...event});
                    })
                    .on("end", (event, d) => {
                        this.xDown = undefined;
                        const frame = this.getFrame(event.x);
                        this.dragEnd({frame: frame, ...event});
                        this.frameupdate({frame: frame, ...event});
                    })
            );
                        
        return timeline;
    }

    getFrame(x) {
        return Math.round(this.x.invert(x));
    }

    update() {
        const _this = this;
        this.timeline
            .selectAll(".channel")
            .data(this.state.channels, d=>d.id)
            .join(
                enter => this.enterChannel(enter)
            )
            .call(d3.drag()
                .on("start", function(event, d) {
                    _this.xDown = event.sourceEvent.clientX;
                    _this.xDrag = _this.transformation[0];
                    const frame = _this.getFrame(event.x);
                    _this.click({frame: frame, ...event});
                    _this.dragStart({frame: frame, elem: this, ...event});
                    _this.frameupdate({frame: frame, elem: this, ...event});
                })
                .on("drag", function(event, d) {
                    const frame = _this.getFrame(event.x);
                    _this.drag({frame: frame, elem: this, ...event});
                    _this.frameupdate({frame: frame, elem: this, ...event});
                })
                .on("end", function(event, d) {
                    _this.xDown = undefined;
                })
            )
            .selectAll(".channel > .event")
            .data(d => d.events, function(d, i){return i})
            .join(
                enter => this.enterEvents(enter)
            );

        this.timeline
            .selectAll(".tl-main > line")
            .data(this.state.indexes, function(d, i){return d.type})
            .join(
                enter => enter.append("line")
                              .attr("class", d => d.type)
                              .attr("y1", this.y(0))
                              .attr("y2", this.y(1))
            )
            .attr("x1", d => this.x(d.frame))
            .attr("x2", d => this.x(d.frame))
            .attr("pointer-events", "none")
            .raise();

        return this;
    }

    drawWaveForm(d, i) {
        const min = d.waveform.channel(0).min_array();
        const max = d.waveform.channel(0).max_array();
        const x = d3.scaleLinear()
                    .domain([0, d.waveform.length])
                    .rangeRound([0, 800]);
        const y = d3.scaleLinear()
                    .domain([d3.min(min), d3.max(max)])
                    .rangeRound([0, 50]);
        return d3.area()
                 .x((d, i) => x(i))
                 .y0((d, i) => y(min[i]))
                 .y1((d, i) => y(d))(max);
    }

    updateChannel(enter) {

    }

    enterChannel(enter) {
        const channel = enter.append("g")
                             .attr("class", "channel")
                             .attr("transform", (d,i) => `translate(0, ${50*i})`);
        // draw waveform
        channel.filter(d=>d.waveform != null)
               .datum(d=>d).join()
               .append("path")
                 .attr("class", "waveform")
                 .attr("d", this.drawWaveForm);


        // draw border
        channel.append("rect")
               .attr("x", 0)
               .attr("y", 0)
               .attr("width", 800)
               .attr("height", 50)
               .attr("class", "seperator");
    }

    enterEvents(enter) {
        const event = enter.append("g")
                           .attr("class", "event");
        event.append("line")
              .attr("x1", d=>this.x(d.frame))
              .attr("x2", d=>this.x(d.frame))
              .attr("y1", 5)
              .attr("y2", 45);
        event.append("line")
             .attr("x1", d=>this.x(d.frame))
             .attr("x2", d=>this.x(d.frame) + 20)
             .attr("y1", 25)
             .attr("y2", 25);
             
    }

    updateIndex(frame) {
        const i = this.state.indexes.findIndex(x=>x.type == "index");
        if (i == -1) 
            this.state.indexes.push({type: "index", frame: frame});
        else
            this.state.indexes[i].frame = frame;
        this.update();
    }

    updateCursor(frame) {
        const i = this.state.indexes.findIndex(x=>x.type == "cursor");
        if (i == -1) 
            this.state.indexes.push({type: "cursor", frame: frame});
        else
            this.state.indexes[i].frame = frame;
        this.update();
    }

    addChannel(name, data={}) {
        let waveform = data.waveform || null;
        if (waveform != null) {
            waveform =new WaveformData.create(waveform);
        }
        const events = data.events || []
        this.state.channels.push({id: this.channelCntr++,
                                  name: name,
                                  waveform: waveform,
                                  events: events});
        this.update();
        return this;
    }

    //--------------------------------------------------------------------------
    // Events
    //--------------------------------------------------------------------------
    frameupdate(event) {
        this.events["frameupdate"].forEach(f => f(event))
    }

    click(event) {
        this.events["click"].forEach(f => f(event))
    }

    dragStart(event) {
        this.events["dragStart"].forEach(f => f(event))
    }

    drag(event) {
        this.events["drag"].forEach(f => f(event))
    }

    dragEnd(event) {
        this.events["dragEnd"].forEach(f => f(event))
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

    //--------------------------------------------------------------------------
    // Panning & Zooming b/c native d3 isn't working as expected
    //--------------------------------------------------------------------------

    pan(event) {
        this.transformation = this.panHelper(event);
        this.setTransformation(...this.transformation);
    }

    panHelper(event) {
        const xOld = this.transformation[0];
        const zOld = this.transformation[1];
        const xDelta = event.sourceEvent.clientX - this.xDown;
        let xNew = this.xDrag + xDelta;
        xNew = this._keepInBounds(xNew, zOld);
        return [xNew, zOld];
    }

    zoom(event) {
        this.transformation = this.zoomHelper(event);
        this.setTransformation(...this.transformation);
    }

    zoomHelper(event) {
        // if somehow wheel fires with no delta, do nothing
        if (event.deltaY == 0) return;
        const [xOld, zOld] = this.transformation;
        // update the zoom factor
        const direction = event.deltaY < 0
                        ? 1
                        : -1;
        this.zoomFactor += direction;

        let zNew = this.zoomCoef**this.zoomFactor;
        // don't zoom out beyond original scale
        if (zNew < 1) {
            this.zoomFactor = 0;
            zNew = this.zoomCoef**this.zoomFactor;
        };
        // mouse coordinates
        const xMouse = this._clientPosToRelPos(event);
        // old zoom coordinates
        const xOldZ = (xMouse - xOld) / zOld;
        // new zoom coordinates
        const xNewZ = xOldZ * zNew;
        // update
        let xNew = xMouse - xNewZ;
        // keep in bounds
        xNew = this._keepInBounds(xNew, zNew);
        return [xNew, zNew];
    }

    _clientPosToRelPos(event) {
        const xScroll = window.pageXOffset ||
                document.documentElement.scrollLeft;
        const xOffset = this.svg.node().getBoundingClientRect().left;
        return event.clientX - xOffset + xScroll;
    }

    _keepInBounds(x, z) {
        const w = this.svg.node().clientWidth;
        if (x > 0) {
            x = 0;
        } else if (x + w*z < w) {
            x = w*(1-z);
        }
        return x;
    }

    setTransformation(x, z) {
        this.timeline.attr("transform", `translate(${x}, 0) scale(${z}, 1)`);
    }

}