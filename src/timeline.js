import WaveformData from 'waveform-data';
import * as d3 from "d3";
import { text } from 'd3';

const OPTS = {
    channelHeight: 50,
    height: 50
};

class WaveformChannelData {
    constructor(data) {

    }
}

export class Timeline {
    constructor(element, frames, opts=OPTS) {
        this.element = element;
        this.selection = d3.select(element);
        this.svg = null;
        this.opts = opts;

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

            "dragInstantStart": [],
            "dragInstant": [],
            "dragInstantEnd": [],

            "dragIntervalLeftStart": [],
            "dragIntervalLeft": [],
            "dragIntervalLeftEnd": [],

            "dragIntervalRightStart": [],
            "dragIntervalRight": [],
            "dragIntervalRightEnd": [],

            "dragIntervalStart": [],
            "dragInterval": [],
            "dragIntervalEnd": [],
        }

        const bcr = this.selection.node().getBoundingClientRect();
        const width = bcr.width;
        this.width = width;

        this.timeline = this.build();

        this.svg.attr("width", "100%")
                .attr("height", opts.height || OPTS.height);
        this.selection.style("height", opts.height || OPTS.height);

        this.x = d3.scaleLinear()
                   .domain([0, frames])
                   .rangeRound([0, width]);
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
            .on("wheel", (event) => {
                this.zoom(event);
                this.update();
                event.preventDefault();
            })
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
                    .filter(()=>true) // defaults disallows ctrl+click
                    .on("start", function(event, d) {
                        _this.xDown = event.sourceEvent.clientX;
                        _this.xDrag = _this.transformation[0];
                        const frame = _this.getFrame(event.x);
                        _this.click({frame: frame, ...event});
                        _this.dragStart({frame: frame, ...event});
                        _this.frameupdate({frame: frame, ...event});
                    })
                    .on("drag", (event, d) => {
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
        const channel= this.timeline
                           .selectAll(".channel")
                           .data(this.state.channels, d=>d.id)
                           .join(
                               enter => this.enterChannel(enter)
                           )
                           .call(d3.drag()
                               .filter(()=>true) // defaults disallows ctrl+click
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
                                   const frame = _this.getFrame(event.x);
                                   _this.dragEnd({frame: frame, elem: this, ...event});
                               })
                           );
        channel
            .selectAll(".channel > .instant")
            .data(d => d.instants, function(d, i){return d.id})
            .join(
                enter => this.enterInstants(enter),
                update => this.updateInstants(update),
                exit => exit.remove()
            )
            .call(d3.drag()
                .filter(()=>true) // defaults disallows ctrl+click
                .on("start", function(event, d) {
                    const frame = _this.getFrame(event.x);
                    _this.dragInstantStart({frame: frame, elem: this, ...event});
                })
                .on("drag", function(event, d) {
                    const frame = _this.getFrame(event.x);
                    _this.dragInstant({frame: frame, elem: this, ...event});
                })
                .on("end", function(event, d) {
                    const frame = _this.getFrame(event.x);
                    _this.dragInstantEnd({frame: frame, elem: this, ...event});
                })
            );

        const interval = channel
            .selectAll(".channel > .interval")
            .each(d => {intervalGroups(d.channel.intervals)})
            .data(d => d.intervals, function(d, i){return d.id})
            .join(
                enter => this.enterIntervals(enter),
                update => this.updateIntervals(update),
                exit => exit.remove()
            );

        interval.selectAll("line.left")
                .call(d3.drag()
                    .filter(()=>true)
                    .on("start", function(event, d) {
                        const frame = _this.getFrame(event.x);
                        _this.dragIntervalLeftStart({frame: frame, elem: this, ...event});
                    })
                    .on("drag", function(event, d) {
                        const frame = _this.getFrame(event.x);
                        _this.dragIntervalLeft({frame: frame, elem: this, ...event});
                    })
                    .on("end", function(event, d) {
                        const frame = _this.getFrame(event.x);
                        _this.dragIntervalLeftEnd({frame: frame, elem: this, ...event});
                    })
                );
        interval.selectAll("line.right")
                .call(d3.drag()
                    .filter(()=>true)
                    .on("start", function(event, d) {
                        const frame = _this.getFrame(event.x);
                        _this.dragIntervalRightStart({frame: frame, elem: this, ...event});
                    })
                    .on("drag", function(event, d) {
                        const frame = _this.getFrame(event.x);
                        _this.dragIntervalRight({frame: frame, elem: this, ...event});
                    })
                    .on("end", function(event, d) {
                        const frame = _this.getFrame(event.x);
                        _this.dragIntervalRightEnd({frame: frame, elem: this, ...event});
                    })
                );
        interval.selectAll("rect")
                .call(d3.drag()
                    .filter(()=>true)
                    .on("start", function(event, d) {
                        const frame = _this.getFrame(event.x);
                        _this.dragIntervalStart({frame: frame, elem: this, ...event});
                    })
                    .on("drag", function(event, d) {
                        const frame = _this.getFrame(event.x);
                        _this.dragInterval({frame: frame, elem: this, ...event});
                    })
                    .on("end", function(event, d) {
                        const frame = _this.getFrame(event.x);
                        _this.dragIntervalEnd({frame: frame, elem: this, ...event});
                    })
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

    updateChannel(update) {

    }

    enterChannel(enter) {
        const channel = enter.append("g")
                             .attr("class", "channel")
                             .attr("transform", (d,i) => `translate(0, ${this.opts.channelHeight*i})`);
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
               .attr("width", this.width)
               .attr("height", this.opts.channelHeight)
               .attr("class", "seperator");
    }

    enterInstants(enter) {
        const event = enter.append("g")
                           .attr("class", "instant");
        // for event firing
        event.append("line")
             .attr("class", "buffer")
             .attr("x1", d=>this.x(d.frame))
             .attr("x2", d=>this.x(d.frame))
             .attr("y1", 5)
             .attr("y2", 45);

        event.append("line")
              .attr("x1", d=>this.x(d.frame))
              .attr("x2", d=>this.x(d.frame))
              .attr("y1", 5)
              .attr("y2", 45);

        event.append("path")
             .attr("class", "scale-invariant top-arrow")
             .attr("d", d=>d3.line()(toparrow(this.x(d.frame), 2, 5, 5)));
        event.append("path")
             .attr("class", "scale-invariant bottom-arrow")
             .attr("d", d=>d3.line()(bottomarrow(this.x(d.frame), 48, 5, 5)));

        event.append("title")
             .text(d => d.clazz);

        return event;
    }

    updateInstants(update) {
        update.selectAll(".scale-invariant.top-arrow")
             .attr("d", d=>d3.line()(toparrow(this.x(d.frame), 2, 5/(this.zoomCoef**this.zoomFactor), 5)));
        update.selectAll(".scale-invariant.bottom-arrow")
             .attr("d", d=>d3.line()(bottomarrow(this.x(d.frame), 48, 5/(this.zoomCoef**this.zoomFactor), 5)));

        update.selectAll("line")
              .attr("x1", d=>this.x(d.frame))
              .attr("x2", d=>this.x(d.frame))
              .attr("y1", 5)
              .attr("y2", 45);

        update.selectAll("title")
              .text(d => d.clazz);

        return update;
    }

    enterIntervals(enter) {
        const interval = enter.append("g")
                              .attr("class", "interval");

        const h = 44;
        const m = 3;
        const textHeight = 14;
        interval.append("rect")
                .attr("x", d=>this.x(d.start))
                .attr("y", d=>or0((h/d.groupSize)*(d.groupIndex)) + m)
                .attr("height", d=>or0((h/d.groupSize) - (d.groupIndex + 1 == d.groupSize ? 0 : m)))
                .attr("width", d=>isNaN(d.end - d.start) || (d.end - d.start) < 0 ? 0 : this.x(d.end - d.start));

        // for event firings
        interval.append("line")
                .attr("class", "buffer left")
                .attr("x1", d=>this.x(d.start))
                .attr("x2", d=>this.x(d.start))
                .attr("y1", d=>or0((h/d.groupSize)*(d.groupIndex)) + m)
                .attr("y2", d=>or0((h/d.groupSize)*(d.groupIndex + 1)) + (d.groupIndex + 1 == d.groupSize ? m : 0));

        interval.append("line")
                .attr("class", "buffer right")
                .attr("x1", d=>this.x(d.end))
                .attr("x2", d=>this.x(d.end))
                .attr("y1", d=>or0((h/d.groupSize)*(d.groupIndex)) + m)
                .attr("y2", d=>or0((h/d.groupSize)*(d.groupIndex + 1)) + (d.groupIndex + 1 == d.groupSize ? m : 0));

        interval.append("line")
                .attr("class", "left")
                .attr("x1", d=>this.x(d.start))
                .attr("x2", d=>this.x(d.start))
                .attr("y1", d=>or0((h/d.groupSize)*(d.groupIndex)) + m)
                .attr("y2", d=>or0((h/d.groupSize)*(d.groupIndex + 1)) + (d.groupIndex + 1 == d.groupSize ? m : 0));
                
        interval.append("line")
                .attr("class", "right")
                .attr("x1", d=>this.x(d.end))
                .attr("x2", d=>this.x(d.end))
                .attr("y1", d=>or0((h/d.groupSize)*(d.groupIndex)) + m)
                .attr("y2", d=>or0((h/d.groupSize)*(d.groupIndex + 1)) + (d.groupIndex + 1 == d.groupSize ? m : 0));

        interval.append("text")
                .attr("x", d=> (this.x(d.end) + this.x(d.start)) /2 )
                .attr("x", d=> (this.x(d.end) + this.x(d.start)) /2 )
                .attr("y", d=> or0(((h/d.groupSize)*(d.groupIndex)) + ((h/d.groupSize)*(d.groupIndex + 1) + (d.groupIndex + 1 == d.groupSize ? m : 0)) + textHeight)/2);
        interval.append("title")
                .text(d => d.clazz);
        return interval;
    }

    updateIntervals(update) {
        const h = 44;
        const m = 3;
        const textHeight = 14;
        update.selectAll("rect")
              .attr("x", d=>this.x(d.start))
              .attr("y", d=>((h/d.groupSize)*(d.groupIndex)) + m)
              .attr("height", d=>(h/d.groupSize) - (d.groupIndex + 1 == d.groupSize ? 0 : m))
              .attr("width", d=>isNaN(d.end - d.start) || (d.end - d.start) < 0 ? 0 : this.x(d.end - d.start));

        update.selectAll("line.left")
              .attr("x1", d=>this.x(d.start))
              .attr("x2", d=>this.x(d.start))
              .attr("y1", d=>or0((h/d.groupSize)*(d.groupIndex)) + m)
              .attr("y2", d=>or0((h/d.groupSize)*(d.groupIndex + 1)) + (d.groupIndex + 1 == d.groupSize ? m : 0));
        
        update.selectAll("line.right")
              .attr("x1", d=>this.x(d.end))
              .attr("x2", d=>this.x(d.end))
              .attr("y1", d=>or0((h/d.groupSize)*(d.groupIndex)) + m)
              .attr("y2", d=>or0((h/d.groupSize)*(d.groupIndex + 1)) + (d.groupIndex + 1 == d.groupSize ? m : 0));

        const _this = this;
        update.selectAll("text")
              .attr("x", d=> (this.x(d.end) + this.x(d.start)) /2 )
              .text(function(d){
                  this.textContent = d.clazz;
                  const boxHeight = (h/d.groupSize);
                  if (this.getBoundingClientRect().height + 2 > boxHeight)
                    return "-";
                  const width = _this.x(d.end) - _this.x(d.start);
                  while (this.textContent.length > 0 && this.getComputedTextLength() > width) {
                        this.textContent = this.textContent.substr(0, this.textContent.length - 1);
                  }
                  return this.textContent;
                })
              .attr("y", function(d) {
                const top = ((h/d.groupSize)*(d.groupIndex));
                const bottom = (h/d.groupSize)*(d.groupIndex + 1);
                const margin = (d.groupIndex + 1 == d.groupSize ? m : 0);
                const textHeight = this.getBoundingClientRect().height;
                return  or0((top + bottom + margin + textHeight)/2);
              });

        update.selectAll("title")
              .text(d => d.clazz);

        return update;
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
        this.state.channels.push({id: this.channelCntr++,
                                  name: name,
                                  waveform: waveform,
                                  instants: data.instants || [],
                                  intervals: data.intervals || []
                                });
        this.update();
        return this;
    }

    eventToChannel(event) {
        return this.state.channels[event.subject.id];
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


    dragInstantStart(event) {
        this.events["dragInstantStart"].forEach(f => f(event))
    }

    dragInstant(event) {
        this.events["dragInstant"].forEach(f => f(event))
    }

    dragInstantEnd(event) {
        this.events["dragInstantEnd"].forEach(f => f(event))
    }

    dragIntervalStart(event) {
        this.events["dragIntervalStart"].forEach(f => f(event))
    }

    dragInterval(event) {
        this.events["dragInterval"].forEach(f => f(event))
    }

    dragIntervalEnd(event) {
        this.events["dragIntervalEnd"].forEach(f => f(event))
    }

    dragIntervalLeftStart(event) {
        this.events["dragIntervalLeftStart"].forEach(f => f(event))
    }

    dragIntervalLeft(event) {
        this.events["dragIntervalLeft"].forEach(f => f(event))
    }

    dragIntervalLeftEnd(event) {
        this.events["dragIntervalLeftEnd"].forEach(f => f(event))
    }

    dragIntervalRightStart(event) {
        this.events["dragIntervalRightStart"].forEach(f => f(event))
    }

    dragIntervalRight(event) {
        this.events["dragIntervalRight"].forEach(f => f(event))
    }

    dragIntervalRightEnd(event) {
        this.events["dragIntervalRightEnd"].forEach(f => f(event))
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
        if (event.deltaY == 0) return this.transformation;
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

function bottomarrow(x, y, w=5, h=5) {
    return [[x-w, y], [x+w, y], [x, y-h]];
}

function toparrow(x, y, w=5, h=5) {
    return [[x-w, y], [x+w, y], [x, y+h]];
};

function intervalGroups(intervals) {
    const _intervals = intervals.sort((a, b) => a.start - b.start);
    const groups = [];
    let group = []
    let interval = null;
    for (let i=0; i < _intervals.length; ++i) {
        // by default first interval forms a group
        if (interval == null) {
            interval = _intervals[i];
            group.push(interval);
        }
        // if current interval starts before previous ends, they are in same group
        else if (_intervals[i].start <= interval.end) {
            group.push(_intervals[i]);
            if (_intervals[i].end > interval.end) {
                interval = _intervals[i];
            }
        }
        else {
            groups.push(group);
            interval = _intervals[i];
            group = [interval];
        }
    }
    if (group.length > 0) {
        groups.push(group);
    }
    for (let j=0; j < groups.length; ++j) {
        groups[j]
        .sort((a, b) => a.id - b.id)
        .forEach((interval, i) => {
            interval.groupIndex = i;
            interval.groupSize = groups[j].length;
        });
    }
}

function or0(x) {
    return isNaN(x) ? 0 : x;
}
