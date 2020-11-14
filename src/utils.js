import * as d3 from "d3";
export class StateTracker {
    constructor(element, states, laststate) {
        // states like {description: str, states: Set[...]}
        this.element = element;
        this.selection = d3.select(this.element);
        this.states = states;
        this.laststate = laststate;
        this.selections = this.build();
        console.log(this.selections);
        console.log(this.states);
    }

    build() {
        return this.selection
                   .selectAll("div")
                   .data(this.states).enter()
                   .append("div")
                       .text(function(d){return d.description});
    }

    update(event) {
        // event like {state: ...}
        console.log(event);
        const idx = this.states.findIndex(x => x.states.has(event.state));
        this.selections
            .classed("current", (_, i) => {
                return i == idx
            })
            .classed("done", (_, i) => {
                return i < idx || event.state == this.laststate;
            });
    }
}

export function controllDummyKeyboard() {
    // these will have the class ".key-{key}"
    window.addEventListener("keydown", function(event) {
        const elems = document.querySelectorAll(keyEventToClass(event));
        if (elems !== null) {
            elems.forEach(e => e.classList.add("pressed"));
        }
    });

    window.addEventListener("keyup", function(event) {
        const elems = document.querySelectorAll(keyEventToClass(event));
        if (elems !== null) {
            elems.forEach(e => e.classList.remove("pressed"));
        }
    });
}

function keyEventToClass(event) {
    const ekey = CSS.escape(event.key.toLowerCase());
    return `.key-${ekey}`;
}

export function frameToTime(framer, frame) {
    return framer.FRAME_DURATION * frame + framer.offset;
}

export function formatTime(time) {
    return new Date(time * 1000).toISOString().substr(11, 11);
}