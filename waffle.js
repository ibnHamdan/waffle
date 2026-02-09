class Game {
    static #MAX_ATTEMPTS = 100;

    #gridSize;
    #swaps;
    #fixed;
    #words;
    #puzzle;

    constructor(gridSize, swaps, dictionary, fixed) {
        check(gridSize % 2 == 1, "Grid size must be an odd integer");

        this.#gridSize = gridSize;
        this.#swaps = swaps;
        this.#fixed = new Set(fixed);
        this.#generate(dictionary);
    }

    // Words are indexed alternately horizontally and vertically, from top to bottom and left to
    // right, so that 0 is the first horizontal word, 1 the first vertical, 2 the second horizontal,
    // etc.  This is probably more annoying than it needed to be.
    get words() {
        const size = this.#words[0].length;
        const horizontal = (wi) => [...Array(size)].map((_, i) => wi * size + i);
        const vertical = (wi) => [...Array(size)].map((_, i) => (wi - 1) + i * size);
        const indices = (wi) => wi % 2 == 0 ? horizontal(wi) : vertical(wi);

        return this.#words.map((word, i) => ({"value": word, "indices": indices(i)}));
    }

    get puzzle() {
        return this.#puzzle;
    }

    reshuffle() {
        this.#puzzle = this.#scramble(this.#words);
    }

    #generate(dictionary) {
        for (let attempts = 0; attempts < Game.#MAX_ATTEMPTS; ++attempts) {
            try {
                this.#generateAttempt(dictionary);
                return;
            } catch {
                continue;
            }
        }

        throw new Error("Cannot find words");
    }

    // Very naive word choice algorithm.  We simply alternate between sampling horizontal and
    // vertical words without replacement that match the existing constraints.  There are better
    // methods to do this which I'll implement later.
    #generateAttempt(dictionary) {
        const nWords = this.#gridSize + 1;

        let candidates = dictionary.filter((w) => w.length === this.#gridSize);
        let words = [takeRandom(candidates)];

        for (let wi = 1; wi < nWords; ++wi) {
            const nConstraints = Math.ceil(wi / 2);
            const constraints = [...Array(nConstraints)].map((_, i) => words[(wi + 1) % 2 + i * 2][wi - wi % 2]);

            words.push(takeRandomWhere(candidates, (w) => constraints.every((c, i) => w[i * 2] == c)));
        }

        this.#words = words;
        this.reshuffle();
    }

    #scramble(words) {
        const row = (i) => Math.floor(i / this.#gridSize);
        const col = (i) => i % this.#gridSize;

        const emptySquare = (i) => (row(i) % 2 == 1) && (col(i) % 2 == 1);
        const useSquare = (i) => !emptySquare(i) && !this.#fixed.has(i);

        const nSquares = this.#gridSize * this.#gridSize;
        const squares = [...Array(nSquares).keys()].filter(useSquare);

        const nCycles = squares.length - this.#swaps;
        check(nCycles > 0, `Not enough letters for ${this.#swaps} swaps`);

        const letters = [...Array(nSquares)].map((_, i) => {
            if (emptySquare(i)) return null;
            if (row(i) % 2 == 0) return words[row(i)][col(i)];
            return words[col(i) + 1][row(i)];
        });

        const grouped = squares.reduce((gs, s) => ((gs[letters[s]] ??= []).push(s), gs), {});
        const groups = shuffle([...Object.values(grouped)]);

        let cycles = [...Array(nCycles)].map(() => []);
        let initialised = 0;

        for (const group of groups) {
            let allowed = [...cycles.keys()];

            for (const square of group) {
                check(allowed.length > 0, "Too many repeated letters");

                const c = initialised < nCycles ? remove(allowed, initialised++) : takeRandom(allowed);
                cycles[c].push(square);
            }
        }

        let puzzle = [...letters];

        for (const cycle of cycles) {
            cycle.reduce(
                (prev, current) => (puzzle[current] = letters[prev], current), cycle.at(-1));
        }

        return puzzle;
    }
}

class Board {
    #gridSize;
    #cells;
    #words;
    #counter;
    #selected;
    #focused;

    constructor(container, words, initial, counter) {
        const grid = container.querySelector(".grid");

        this.#gridSize = words[0]["value"].length;
        this.#cells = Array.from(grid.children);
        this.#words = words;
        this.#counter = counter;

        grid.onkeydown = (event) => {
            switch (event.key) {
            case "Enter":
            case "ArrowDown":
                this.#focus(this.#focused ? this.#focused : this.#cells[0]);
                event.preventDefault();
            }
        };

        for (const cell of this.#cells) {
            if (!cell.classList.contains("cell")) {
                continue;
            }

            cell.onmouseenter = (event) => this.#focus(event.target);
            cell.onmouseleave = (event) => this.#unfocus(event.target);
            cell.onclick = (event) => this.#select(event.target);
            cell.onkeydown = (event) => this.#cellKeyDown(event);
        }

        this.reset(initial);
    }

    #cellKeyDown(event) {
        event.stopPropagation();

        const moveToChecked = (i) => {
            if (i >= 0 && i < this.#cells.length && this.#cells[i].classList.contains("cell")) {
                this.#focus(this.#cells[i]);
                return true;
            }
            return false;
        };

        const index = parseInt(event.target.getAttribute("data-index"));
        const move = (d) => moveToChecked(index + d) || moveToChecked(index + 2*d);

        switch (event.key) {
        case "ArrowDown":  return !move(this.#gridSize);
        case "ArrowUp":    return !move(-this.#gridSize);
        case "ArrowLeft":  return !move(-1);
        case "ArrowRight": return !move(1);
        }

        return true;
    }

    #focus(cell) {
        if (this.#focused) {
            this.#focused.setAttribute("tabindex", "-1");
        }

        this.#focused = cell;
        cell.setAttribute("tabindex", "0");
        cell.focus();
    }

    #unfocus(cell) {
        cell.blur();
        cell.setAttribute("tabindex", "-1");
        this.#focused = null;
    };

    reset(puzzle) {
        this.#selected = null;
        this.#focused = null;

        this.#cells.forEach((cell, i) => {
            cell.textContent = puzzle[i];
            cell.classList.remove("selected");
            cell.setAttribute("tabindex", "-1");
        });

        this.#update();
    }

    #select(cell) {
        if (!this.#counter.ok() || cell.getAttribute("data-state") === "solved") {
            return false;
        }

        if (!this.#selected) {
            this.#selected = cell;
            cell.classList.add("selected");
        } else if (cell === this.#selected || this.#swap(this.#selected, cell)) {
            this.#selected.classList.remove("selected");
            this.#selected = null;
        }

        return false;
    }

    #swap(a, b) {
        const unsolved = (c) => c.classList.contains("cell") && c.getAttribute("data-state") !== "solved";

        if (!unsolved(a) || !unsolved(b)) {
            return false;
        }

        if (a.parentElement !== b.parentElement || a.textContent === b.textContent) {
            return false;
        }

        [a.textContent, b.textContent] = [b.textContent, a.textContent];
        this.#counter.update();
        this.#update();

        return true;
    }

    #update() {
        this.#cells.forEach((cell) => cell.removeAttribute("data-state"));

        for (const word of this.#words) {
            const squares = word["indices"].map((i) => this.#cells[i]);
            const expected = word["value"];

            squares.forEach((cell, i) => {
                const solved = (cell.textContent == expected[i]);
                if (solved) {
                    cell.setAttribute("data-state", "solved");
                }
                cell.setAttribute("data-active", !solved && this.#counter.ok());
            });

            const missing = expected.split('').filter((c, i) => c != squares[i].textContent);
            squares.forEach((cell, i) => {
                if (cell.textContent !== expected[i] && remove(missing, cell.textContent)) {
                    cell.setAttribute("data-state", "hint");
                }
            });
        }
    }
}

class SwapCounter {
    #counter;
    #noun;
    #count;

    constructor(container, initial) {
        this.#counter = container.querySelector(".swapCounter");
        this.#noun = container.querySelector(".swapNoun");

        this.reset(initial);
    }

    ok() {
        return this.#count != 0;
    }

    reset(value) {
        this.#count = value;
        this.#counter.textContent = value;
        this.#noun.textContent = value != 1 ? "swaps" : "swap";
    }

    update() {
        check(this.#count > 0, "Counter is zeroed")
        this.reset(this.#count - 1);
    }
}

function check(cond, message) {
    if (!cond) {
        throw new Error(message);
    }
}

function shuffle(xs) {
    return xs
        .map((x) => ({x, weight: Math.random()}))
        .sort((x, y) => x.weight - y.weight)
        .map(({x}) => x);
}

function remove(xs, x) {
    const i = xs.indexOf(x);
    if (i === -1) {
        return undefined;
    }

    xs.splice(i, 1);
    return x;
}

function takeRandomWhere(xs, cond) {
    const filtered = [...xs.keys()].filter((i) => cond(xs[i]));
    check(filtered.length > 0, "Not enough elements to draw from matching condition");

    const i = filtered[Math.floor(Math.random() * filtered.length)];
    const val = xs[i];
    xs.splice(i, 1);
    return val;
}

function takeRandom(xs) {
    check(xs.length > 0, "Not enough elements to draw from");

    const i = Math.floor(Math.random() * xs.length);
    const val = xs[i];
    xs.splice(i, 1);
    return val;
}

class GameEnvironment {
    static #GRID_SIZE = 5;
    static #MAX_SWAPS = 15;
    static #MIN_SWAPS = 10;
    static #FIXED = [0, 4, 12, 20, 24];

    #container;
    #game;
    #counter;
    #board;

    constructor(container) {
        this.#container = container;
        this.#createGrid();

        this.newGame();

        container.querySelector(".reset").onclick = () => this.reset();
        container.querySelector(".reshuffle").onclick = () => this.reshuffle();
        container.querySelector(".newGame").onclick = () => this.newGame();
    }

    #createGrid() {
        const grid = this.#container.querySelector(".grid");

        for (let i = 0; i < GameEnvironment.#GRID_SIZE * GameEnvironment.#GRID_SIZE; ++i) {
            const useSpacer = (Math.floor(i / GameEnvironment.#GRID_SIZE) % 2 == 1) && (i % 2 == 0);
            const cell = document.createElement(useSpacer ? "div" : "button");

            if (!useSpacer) {
                cell.className = "cell";
                cell.id = `${this.#container.id}-cell${i}`;
                cell.setAttribute("data-index", `${i}`);
            }

            grid.appendChild(cell);
        }
    }

    reset() {
        this.#counter.reset(GameEnvironment.#MAX_SWAPS);
        this.#board.reset(this.#game.puzzle);

        const warning = this.#container.querySelector(".warning-overlay");
        warning.style.visibility = "hidden";
    }

    reshuffle() {
        this.#game.reshuffle();
        this.reset();
    }

    newGame() {
        const warning = this.#container.querySelector(".warning-overlay");

        try {
            this.#game = new Game(
                DICTIONARY[0].length,
                GameEnvironment.#MIN_SWAPS,
                DICTIONARY,
                GameEnvironment.#FIXED);
        } catch {
            warning.style.visibility = "visible";
            return;
        }

        this.#counter = new SwapCounter(this.#container, GameEnvironment.#MAX_SWAPS);
        this.#board = new Board(
            this.#container,
            this.#game.words,
            this.#game.puzzle,
            this.#counter);

        warning.style.visibility = "hidden";
    }
}

new GameEnvironment(document.getElementById("game"));
