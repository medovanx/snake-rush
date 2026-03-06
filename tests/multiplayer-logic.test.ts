import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_FOODS,
  createRoomState,
  fireBullet,
  placeFood,
  seedFoods,
  setDuration,
  setPlayerTarget,
  tickRoom
} from "../lib/multiplayer-logic";
import { joinRoom, registerWsClient, setReady } from "../lib/rooms-store";

function rngFrom(values: number[]) {
  let index = 0;
  return () => {
    const value = values[index] ?? values[values.length - 1] ?? 0.5;
    index += 1;
    return value;
  };
}

test("players advance with continuous movement", () => {
  const state = createRoomState(100, 100, 120, rngFrom([0.1, 0.2, 0.3, 0.4]));
  state.status = "running";
  const next = tickRoom(state, 80, rngFrom([0.5]));
  assert.equal(Number(next.players.p1.snake[0].x.toFixed(2)), 25.92);
  assert.equal(Number(next.players.p2.snake[0].x.toFixed(2)), 74.08);
});

test("pointer target changes movement direction", () => {
  let state = createRoomState(100, 100, 120, rngFrom([0.1, 0.2, 0.3, 0.4]));
  state.status = "running";
  state = setPlayerTarget(state, "p1", 1, -1);
  const next = tickRoom(state, 80, rngFrom([0.5]));
  assert.ok(next.players.p1.snake[0].x > state.players.p1.snake[0].x);
  assert.ok(next.players.p1.snake[0].y < state.players.p1.snake[0].y);
});

test("snake collision still ends the match when enabled", () => {
  const state = createRoomState(100, 100, 120, rngFrom([0.1]));
  state.status = "running";
  state.players.p1.snake = [{ x: 50, y: 50 }, { x: 49, y: 50 }, { x: 48, y: 50 }, { x: 47, y: 50 }];
  state.players.p2.snake = [{ x: 52, y: 50 }, { x: 53, y: 50 }, { x: 54, y: 50 }, { x: 55, y: 50 }];
  state.players.p1.heading = { x: 1, y: 0 };
  state.players.p1.target = { x: 1, y: 0 };
  state.players.p1.length = 10;
  state.players.p2.heading = { x: -1, y: 0 };
  state.players.p2.target = { x: -1, y: 0 };
  state.players.p2.length = 10;
  state.snakeCollisionAllowed = true;
  const next = tickRoom(state, 80, rngFrom([0.5]));
  assert.equal(next.status, "gameOver");
  assert.equal(next.winner, null);
});

test("self collision ends game when enabled", () => {
  const state = createRoomState(100, 100, 120, rngFrom([0.1]));
  state.status = "running";
  state.selfCollisionAllowed = true;
  state.players.p1.snake = [
    { x: 50, y: 50 },
    { x: 49, y: 50 },
    { x: 48, y: 50 },
    { x: 47, y: 50 },
    { x: 47, y: 49 },
    { x: 48, y: 49 },
    { x: 49, y: 49 },
    { x: 50, y: 49 },
    { x: 51, y: 49 },
    { x: 51, y: 50 }
  ];
  state.players.p1.heading = { x: 1, y: 0 };
  state.players.p1.target = { x: 1, y: 0 };
  state.players.p1.length = 16;
  const next = tickRoom(state, 80, rngFrom([0.5]));
  assert.equal(next.status, "gameOver");
  assert.equal(next.winner, "p2");
});

test("player who runs into the other snake loses even with a higher score", () => {
  const state = createRoomState(100, 100, 120, rngFrom([0.1]));
  state.status = "running";
  state.snakeCollisionAllowed = true;
  state.players.p1.snake = [{ x: 68.6, y: 58 }, { x: 67.2, y: 58 }, { x: 65.8, y: 58 }];
  state.players.p1.heading = { x: 1, y: 0 };
  state.players.p1.target = { x: 1, y: 0 };
  state.players.p1.score = 10;
  state.players.p2.snake = [{ x: 70, y: 60 }, { x: 70, y: 59 }, { x: 70, y: 58 }, { x: 70, y: 57 }];
  state.players.p2.heading = { x: 0, y: 1 };
  state.players.p2.target = { x: 0, y: 1 };
  state.players.p2.score = 1;
  const next = tickRoom(state, 80, rngFrom([0.5]));
  assert.equal(next.status, "gameOver");
  assert.equal(next.winner, "p2");
});

test("fire spawns a continuous bullet and respects cooldown", () => {
  const state = createRoomState(100, 100, 120, rngFrom([0.1]), { fireEnabled: true });
  state.status = "running";
  const fired = fireBullet(state, "p1", 1000);
  assert.equal(fired.bullets.length, 1);
  assert.equal(fired.bullets[0].ownerId, "p1");
  assert.ok(fired.bullets[0].vx > 0);
  const cooledDown = fireBullet(fired, "p1", 1100);
  assert.equal(cooledDown.bullets.length, 1);
  const nextShot = fireBullet(fired, "p1", 1200);
  assert.equal(nextShot.bullets.length, 2);
});

test("bullet hit reduces opponent score", () => {
  const state = createRoomState(100, 100, 120, rngFrom([0.1]), { fireEnabled: true });
  state.status = "running";
  state.players.p1.snake = [{ x: 40, y: 50 }, { x: 39, y: 50 }, { x: 38, y: 50 }];
  state.players.p2.snake = [{ x: 52, y: 50 }, { x: 53, y: 50 }, { x: 54, y: 50 }, { x: 55, y: 50 }, { x: 56, y: 50 }];
  state.players.p1.heading = { x: 1, y: 0 };
  state.players.p1.target = { x: 1, y: 0 };
  state.players.p2.heading = { x: 0, y: 1 };
  state.players.p2.target = { x: 0, y: 1 };
  state.players.p2.score = 3;
  const fired = fireBullet(state, "p1", 1000);
  const next = tickRoom(tickRoom(fired, 80, rngFrom([0.5])), 80, rngFrom([0.4]));
  assert.equal(next.players.p2.score, 2);
  assert.equal(next.bullets.length, 0);
});

test("snake wraps around borders", () => {
  const state = createRoomState(100, 100, 120, rngFrom([0.1]));
  state.status = "running";
  state.players.p1.snake = [{ x: 99.4, y: 40 }, { x: 98.4, y: 40 }, { x: 97.4, y: 40 }];
  state.players.p1.heading = { x: 1, y: 0 };
  state.players.p1.target = { x: 1, y: 0 };
  const next = tickRoom(state, 80, rngFrom([0.5]));
  assert.ok(next.players.p1.snake[0].x < 5);
});

test("food eaten grows snake and increases score", () => {
  const state = createRoomState(100, 100, 120, rngFrom([0.1]));
  state.status = "running";
  state.foods = [{ x: 25.92, y: 50, variant: 2, kind: "normal", points: 1, ttlMs: null }];
  const next = tickRoom(state, 80, rngFrom([0.5]));
  assert.equal(next.players.p1.score, 1);
  assert.ok(next.players.p1.length > state.players.p1.length);
  assert.ok(next.foods.length >= 1);
});

test("special food appears after every five normal foods", () => {
  const state = createRoomState(100, 100, 120, rngFrom([0.1]));
  state.status = "running";
  state.foodsCollected = 4;
  state.nextSpecialFoodAt = 5;
  state.foods = [{ x: 25.92, y: 50, variant: 2, kind: "normal", points: 1, ttlMs: null }];
  const next = tickRoom(state, 80, rngFrom([0.5, 0.4, 0.3, 0.2]));
  assert.equal(next.foods.some((food) => food.kind === "special"), true);
  assert.equal(next.nextSpecialFoodAt, 10);
});

test("special food expires after eight seconds", () => {
  const state = createRoomState(100, 100, 120, rngFrom([0.1]));
  state.status = "running";
  state.foods = [{ x: 80, y: 40, variant: 1, kind: "special", points: 10, ttlMs: 60 }];
  const next = tickRoom(state, 80, rngFrom([0.5]));
  assert.equal(next.foods.some((food) => food.kind === "special"), false);
});

test("setDuration updates match timer when not running", () => {
  const state = createRoomState(100, 100, 120, rngFrom([0.1]));
  const next = setDuration(state, 200);
  assert.equal(next.durationSeconds, 200);
  assert.equal(next.remainingMs, 200000);
});

test("food placement avoids snake bodies", () => {
  const state = createRoomState(100, 100, 120, rngFrom([0.1]));
  const food = placeFood(100, 100, state.players, [], rngFrom([0.1, 0.2, 0.3]));
  assert.ok(food);
  assert.equal(
    state.players.p1.snake.some((segment) => Math.hypot(segment.x - food.x, segment.y - food.y) < 6),
    false
  );
});

test("seedFoods spawns up to max foods", () => {
  const state = createRoomState(100, 100, 120, rngFrom([0.1]));
  const foods = seedFoods(100, 100, state.players, MAX_FOODS, rngFrom([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]));
  assert.ok(foods.length > 0 && foods.length <= MAX_FOODS);
  assert.equal(new Set(foods.map((food) => `${food.x.toFixed(2)}:${food.y.toFixed(2)}`)).size, foods.length);
});

test("createRoomState clamps multiplayer lobbies to ten snakes", () => {
  const state = createRoomState(100, 100, 120, rngFrom([0.1]), { playerCount: 99 });
  assert.equal(state.playerIds.length, 10);
  assert.equal(state.activePlayerIds.length, 10);
});

test("swarm lobby starts only after every joined player is ready", () => {
  const playerIds = ["p1", "p2", "p3", "p4"];
  const room = {
    id: "TEST01",
    mode: "swarm",
    maxPlayers: 4,
    playerIds,
    state: createRoomState(100, 100, 120, rngFrom([0.1]), { playerIds, activePlayerIds: [] }),
    seats: { p1: null, p2: null, p3: null, p4: null },
    readyState: { p1: false, p2: false, p3: false, p4: false },
    profiles: {
      p1: { name: "Player 1", color: "#58d27f" },
      p2: { name: "Player 2", color: "#5ab5ff" },
      p3: { name: "Player 3", color: "#ff8d5a" },
      p4: { name: "Player 4", color: "#ffd166" }
    },
    wsClients: new Map(),
    baseUrl: "http://localhost:3000",
    lastActiveAt: Date.now()
  };

  joinRoom(room, "Alpha", "#111111");
  joinRoom(room, "Bravo", "#222222");
  joinRoom(room, "Charlie", "#333333");
  joinRoom(room, "Delta", "#444444");

  assert.equal(room.state.status, "waiting");
  setReady(room, "p1", true);
  setReady(room, "p2", true);
  setReady(room, "p3", true);
  assert.equal(room.state.status, "waiting");

  setReady(room, "p4", true);
  assert.equal(room.state.status, "running");
  assert.deepEqual(room.state.activePlayerIds, playerIds);
});

test("swarm room stays alive when one player disconnects", () => {
  const playerIds = ["p1", "p2", "p3"];
  const room = {
    id: "TEST02",
    mode: "swarm",
    maxPlayers: 3,
    playerIds,
    state: createRoomState(100, 100, 120, rngFrom([0.1]), { playerIds, activePlayerIds: playerIds }),
    seats: { p1: "Alpha", p2: "Bravo", p3: "Charlie" },
    readyState: { p1: true, p2: true, p3: true },
    profiles: {
      p1: { name: "Alpha", color: "#58d27f" },
      p2: { name: "Bravo", color: "#5ab5ff" },
      p3: { name: "Charlie", color: "#ff8d5a" }
    },
    wsClients: new Map(),
    baseUrl: "http://localhost:3000",
    lastActiveAt: Date.now()
  };
  room.state.status = "running";

  const socket = { send() {}, close() {} };
  const disconnectOne = registerWsClient(room, "p1", socket as never);
  registerWsClient(room, "p2", socket as never);

  disconnectOne();

  assert.equal(room.wsClients.size, 1);
  assert.equal(room.state.status, "running");
});
