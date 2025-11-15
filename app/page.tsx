"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import classNames from "classnames";

type DirectionKey = "up" | "down" | "left" | "right";

type Vector = { x: number; y: number };

type Cell = { x: number; y: number };

type Snake = {
  id: "Alpha" | "Bravo";
  body: Cell[];
  direction: DirectionKey;
  color: string;
  score: number;
  stepsSinceFood: number;
};

type Message = { tick: number; from: Snake["id"]; text: string };

type GameState = {
  snakes: Snake[];
  food: Cell;
  tick: number;
  messages: Message[];
};

const BOARD_SIZE = 18;
const TICK_SPEED = 180;
const MAX_MESSAGES = 9;

const DIRECTION_VECTORS: Record<DirectionKey, Vector> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 }
};

const OPPOSITE: Record<DirectionKey, DirectionKey> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left"
};

function posKey(cell: Cell) {
  return `${cell.x}:${cell.y}`;
}

function addVec(a: Cell, dir: DirectionKey): Cell {
  const delta = DIRECTION_VECTORS[dir];
  return { x: a.x + delta.x, y: a.y + delta.y };
}

function manhattan(a: Cell, b: Cell) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function wrapCell(cell: Cell) {
  return cell.x >= 0 && cell.x < BOARD_SIZE && cell.y >= 0 && cell.y < BOARD_SIZE;
}

function getSpawnCandidates(occupied: Set<string>) {
  const cells: Cell[] = [];
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const key = `${x}:${y}`;
      if (!occupied.has(key)) {
        cells.push({ x, y });
      }
    }
  }
  return cells;
}

function spawnFoodFromOccupancy(
  occupancy: Map<string, { occupant: Snake["id"]; isTail: boolean }>
) {
  const occupied = new Set<string>();
  occupancy.forEach((_v, key) => occupied.add(key));
  const candidates = getSpawnCandidates(occupied);
  if (!candidates.length) {
    return { x: 0, y: 0 };
  }
  const idx = Math.floor(Math.random() * candidates.length);
  return candidates[idx];
}

function spawnFood(snakes: Snake[]) {
  const occupied = new Set<string>();
  snakes.forEach((snake) => snake.body.forEach((cell) => occupied.add(posKey(cell))));
  const candidates = getSpawnCandidates(occupied);
  if (!candidates.length) {
    return { x: 0, y: 0 };
  }
  const idx = Math.floor(Math.random() * candidates.length);
  return candidates[idx];
}

function createInitialSnakes(): Snake[] {
  const mid = Math.floor(BOARD_SIZE / 2);
  return [
    {
      id: "Alpha",
      body: [
        { x: mid - 4, y: mid },
        { x: mid - 5, y: mid },
        { x: mid - 6, y: mid }
      ],
      direction: "right",
      color: "#4ade80",
      score: 0,
      stepsSinceFood: 0
    },
    {
      id: "Bravo",
      body: [
        { x: mid + 4, y: mid },
        { x: mid + 5, y: mid },
        { x: mid + 6, y: mid }
      ],
      direction: "left",
      color: "#38bdf8",
      score: 0,
      stepsSinceFood: 0
    }
  ];
}

function buildOccupancy(
  snakes: Snake[]
): Map<string, { occupant: Snake["id"]; isTail: boolean }> {
  const occupied = new Map<string, { occupant: Snake["id"]; isTail: boolean }>();
  snakes.forEach((snake) => {
    snake.body.forEach((segment, idx) => {
      const key = posKey(segment);
      occupied.set(key, { occupant: snake.id, isTail: idx === snake.body.length - 1 });
    });
  });
  return occupied;
}

function safeMoves(
  snake: Snake,
  occupancy: Map<string, { occupant: Snake["id"]; isTail: boolean }>,
  plannedTarget: Cell | null,
  growthIntent: boolean
) {
  const candidates: DirectionKey[] = ["left", "right", "up", "down"];
  const safe: DirectionKey[] = [];

  for (const dir of candidates) {
    if (dir === OPPOSITE[snake.direction]) continue;
    const next = addVec(snake.body[0], dir);
    if (!wrapCell(next)) continue;

    const willEat = plannedTarget && next.x === plannedTarget.x && next.y === plannedTarget.y;
    const occupant = occupancy.get(posKey(next));
    if (!occupant) {
      safe.push(dir);
      continue;
    }

    if (
      occupant.occupant === snake.id &&
      occupant.isTail &&
      (!growthIntent || willEat)
    ) {
      safe.push(dir);
      continue;
    }
  }

  return safe;
}

function prioritizeDirection(
  origin: Cell,
  target: Cell,
  options: DirectionKey[]
): DirectionKey[] {
  return options
    .map((dir) => {
      const next = addVec(origin, dir);
      return { dir, score: manhattan(next, target) };
    })
    .sort((a, b) => a.score - b.score)
    .map((entry) => entry.dir);
}

function selectMove(
  snake: Snake,
  options: DirectionKey[],
  fallback: DirectionKey
): DirectionKey {
  if (!options.length) return snake.direction;
  if (options.includes(fallback)) return fallback;
  return options[0];
}

function decidePlan(
  snake: Snake,
  partner: Snake,
  food: Cell,
  occupancy: Map<string, { occupant: Snake["id"]; isTail: boolean }>,
  alphaGoingForFood: boolean,
  isAlpha: boolean
): {
  chosenDirection: DirectionKey;
  willEat: boolean;
  target: Cell | null;
  message: string | null;
} {
  const snakeHead = snake.body[0];
  const partnerHead = partner.body[0];
  const distSelf = manhattan(snakeHead, food);
  const distPartner = manhattan(partnerHead, food);

  const shouldHunt =
    isAlpha
      ? distSelf <= distPartner
      : !alphaGoingForFood && distSelf <= distPartner + 1;

  const target = shouldHunt ? food : snake.body[snake.body.length - 1];
  const anticipatesGrowth = shouldHunt && manhattan(snakeHead, food) === 1;
  const safe = safeMoves(
    snake,
    occupancy,
    shouldHunt ? food : target,
    anticipatesGrowth
  );

  const prioritized = shouldHunt
    ? prioritizeDirection(snakeHead, food, safe)
    : prioritizeDirection(snakeHead, target, safe);

  const chosen = selectMove(snake, prioritized, snake.direction);
  const nextHead = addVec(snakeHead, chosen);
  const willEat = shouldHunt && nextHead.x === food.x && nextHead.y === food.y;

  let message: string | null = null;
  if (shouldHunt && isAlpha) {
    message = `Moving for food (${food.x},${food.y}) in ${distSelf} steps`;
  } else if (!shouldHunt && isAlpha) {
    message = `Skipping food; optimizing coil`;
  } else if (shouldHunt && !alphaGoingForFood) {
    message = `Food is open; intercepting in ${distSelf} steps`;
  } else if (!shouldHunt && !isAlpha && alphaGoingForFood) {
    message = `Alpha on food; condensing tail`;
  }

  return { chosenDirection: chosen, willEat, target: shouldHunt ? food : target, message };
}

function moveSnake(
  snake: Snake,
  direction: DirectionKey,
  grow: boolean
): Snake {
  const nextHead = addVec(snake.body[0], direction);
  const newBody = [nextHead, ...snake.body.slice(0, grow ? undefined : -1)];
  return {
    ...snake,
    body: newBody,
    direction,
    score: snake.score + (grow ? 1 : 0),
    stepsSinceFood: grow ? 0 : snake.stepsSinceFood + 1
  };
}

function resetState(): GameState {
  const snakes = createInitialSnakes();
  const food = spawnFood(snakes);
  return {
    snakes,
    food,
    tick: 0,
    messages: []
  };
}

export default function CooperativeSnake() {
  const [state, setState] = useState<GameState>(() => resetState());
  const [isRunning, setIsRunning] = useState(true);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);

  const reset = useCallback(() => {
    setState(resetState());
  }, []);

  const tick = useCallback(() => {
    setState((prev) => {
      const occupancy = buildOccupancy(prev.snakes);
      const nextMessages = [...prev.messages];
      const updatedSnakes: Snake[] = [];
      let alphaIntentFood = false;
      let food = prev.food;

      for (let i = 0; i < prev.snakes.length; i += 1) {
        const current = i === 0 ? prev.snakes[0] : updatedSnakes[1] ?? prev.snakes[1];
        const partner =
          i === 0 ? prev.snakes[1] : updatedSnakes[0] ?? prev.snakes[0];

        const isAlpha = current.id === "Alpha";
        const plan = decidePlan(
          current,
          partner,
          food,
          occupancy,
          alphaIntentFood,
          isAlpha
        );

        if (plan.message) {
          nextMessages.push({ tick: prev.tick + 1, from: current.id, text: plan.message });
        }

        if (
          isAlpha &&
          plan.target &&
          plan.target.x === food.x &&
          plan.target.y === food.y
        ) {
          alphaIntentFood = true;
        }

        const nextHead = addVec(current.body[0], plan.chosenDirection);
        if (!wrapCell(nextHead)) {
          return resetState();
        }

        const nextKey = posKey(nextHead);
        const occupant = occupancy.get(nextKey);
        const colliding =
          occupant &&
          (occupant.occupant !== current.id ||
            !occupant.isTail ||
            plan.willEat);

        if (colliding) {
          return resetState();
        }

        const tail = current.body[current.body.length - 1];
        if (!plan.willEat) {
          occupancy.delete(posKey(tail));
        }
        occupancy.set(nextKey, { occupant: current.id, isTail: false });

        const grownSnake = moveSnake(current, plan.chosenDirection, plan.willEat);
        updatedSnakes[i] = grownSnake;

        if (plan.willEat) {
          occupancy.set(posKey(nextHead), { occupant: current.id, isTail: false });
          const tailKey = posKey(
            grownSnake.body[grownSnake.body.length - 1]
          );
          occupancy.set(tailKey, {
            occupant: current.id,
            isTail: true
          });

          food = spawnFoodFromOccupancy(occupancy);
        } else {
          const newTailKey = posKey(
            grownSnake.body[grownSnake.body.length - 1]
          );
          occupancy.set(newTailKey, {
            occupant: current.id,
            isTail: true
          });
        }
      }

      while (nextMessages.length > MAX_MESSAGES) {
        nextMessages.shift();
      }

      return {
        snakes: updatedSnakes,
        food,
        tick: prev.tick + 1,
        messages: nextMessages
      };
    });
  }, []);

  useEffect(() => {
    if (!isRunning) return;

    const loop = (now: number) => {
      if (!lastTickRef.current) {
        lastTickRef.current = now;
      }
      if (now - lastTickRef.current >= TICK_SPEED) {
        lastTickRef.current = now;
        tick();
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [isRunning, tick]);

  const toggleRunning = useCallback(() => {
    setIsRunning((prev) => !prev);
    lastTickRef.current = 0;
  }, []);

  const boardCells = useMemo(() => {
    const grid = Array.from({ length: BOARD_SIZE }, (_, y) =>
      Array.from({ length: BOARD_SIZE }, (_, x) => ({
        x,
        y,
        snake: null as Snake["id"] | null,
        isHead: false,
        isTail: false
      }))
    );

    state.snakes.forEach((snake) => {
      snake.body.forEach((segment, idx) => {
        const cell = grid[segment.y]?.[segment.x];
        if (!cell) return;
        cell.snake = snake.id;
        cell.isHead = idx === 0;
        cell.isTail = idx === snake.body.length - 1;
      });
    });
    return grid;
  }, [state.snakes]);

  return (
    <main className="game-shell">
      <section className="hud">
        <h1>Cooperative Dual Snake</h1>
        <div className="controls">
          <button onClick={toggleRunning}>{isRunning ? "Pause" : "Resume"}</button>
          <button onClick={reset}>Reset</button>
        </div>
        <div className="scores">
          {state.snakes.map((snake) => (
            <div key={snake.id} className="score-card">
              <div className="marker" style={{ background: snake.color }} />
              <div>
                <strong>{snake.id}</strong>
                <span>Score {snake.score}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="log">
          <h2>Comms</h2>
          {state.messages.slice().reverse().map((msg) => (
            <p key={`${msg.tick}-${msg.from}-${msg.text}`}>
              <span>{msg.tick.toString().padStart(4, "0")}</span>
              <em>{msg.from}</em>
              <span>{msg.text}</span>
            </p>
          ))}
        </div>
      </section>

      <section className="board">
        <div className="grid">
          {boardCells.map((row, rowIdx) => (
            <div className="row" key={rowIdx}>
              {row.map((cell) => {
                const classes = classNames("cell", {
                  snake: Boolean(cell.snake),
                  [`snake-${cell.snake?.toLowerCase()}`]: Boolean(cell.snake),
                  head: cell.isHead,
                  tail: cell.isTail,
                  food:
                    state.food.x === cell.x &&
                    state.food.y === cell.y
                });
                const color =
                  cell.snake &&
                  state.snakes.find((snake) => snake.id === cell.snake)?.color;
                return (
                  <div
                    key={`${cell.x}-${cell.y}`}
                    className={classes}
                    style={
                      cell.snake && color
                        ? {
                            background: cell.isHead
                              ? color
                              : `color-mix(in srgb, ${color} 80%, #020617)`
                          }
                        : undefined
                    }
                  />
                );
              })}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
