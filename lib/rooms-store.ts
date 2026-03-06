import type { WebSocket } from "ws";
import { createRoomState, fireBullet, restartRoom, setDuration, setPlayerTarget, tickRoom } from "./multiplayer-logic";

const TICK_MS = 80;

function randomRoomId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let roomId = "";
  for (let i = 0; i < 6; i += 1) {
    roomId += chars[Math.floor(Math.random() * chars.length)];
  }
  return roomId;
}

export function safeRoomId(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

function initialStore() {
  return {
    rooms: new Map(),
    tickerStarted: false
  };
}

function sanitizeColor(value, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || "")) ? String(value) : fallback;
}

const globalStore = globalThis as typeof globalThis & { __snakeStore?: ReturnType<typeof initialStore> };
const store = globalStore.__snakeStore ?? initialStore();
globalStore.__snakeStore = store;

function toPublicState(room, playerId) {
  return {
    type: "state",
    roomId: room.id,
    playerId,
    playersJoined: room.playersJoined,
    inviteUrl: `${room.baseUrl}/play?room=${room.id}`,
    profiles: room.profiles,
    state: room.state
  };
}

function broadcast(room) {
  const payloadByPlayer = {
    p1: JSON.stringify(toPublicState(room, "p1")),
    p2: JSON.stringify(toPublicState(room, "p2"))
  };

  for (const [clientId, client] of room.wsClients.entries()) {
    const playerId = client.playerId;
    try {
      client.socket.send(payloadByPlayer[playerId] ?? payloadByPlayer.p1);
    } catch {
      room.wsClients.delete(clientId);
    }
  }
}

function terminateRoom(room) {
  for (const client of room.wsClients.values()) {
    try {
      client.socket.close();
    } catch {}
  }
  room.wsClients.clear();
  store.rooms.delete(room.id);
}

export function startTicker() {
  if (store.tickerStarted) {
    return;
  }
  store.tickerStarted = true;

  setInterval(() => {
    const now = Date.now();
    for (const room of store.rooms.values()) {
      if (room.state.status === "running") {
        room.state = tickRoom(room.state, TICK_MS);
        room.lastActiveAt = now;
        broadcast(room);
      }

      if (now - room.lastActiveAt > 1000 * 60 * 30) {
        terminateRoom(room);
      }
    }
  }, TICK_MS);
}

export function createRoom(
  baseUrl,
  options: {
    winCondition?: string;
    durationSeconds?: number;
    scoreLimit?: number;
    selfCollisionAllowed?: boolean;
    snakeCollisionAllowed?: boolean;
    fireEnabled?: boolean;
  } = {}
) {
  startTicker();
  let roomId = randomRoomId();
  while (store.rooms.has(roomId)) {
    roomId = randomRoomId();
  }
  const winCondition = options.winCondition === "score" ? "score" : "time";
  const durationSeconds = Math.max(10, Math.min(900, Math.floor(Number(options.durationSeconds) || 120)));
  const scoreLimit = Math.max(1, Math.min(200, Math.floor(Number(options.scoreLimit) || 5)));
  const selfCollisionAllowed = Boolean(options.selfCollisionAllowed);
  const snakeCollisionAllowed = Boolean(options.snakeCollisionAllowed);
  const fireEnabled = Boolean(options.fireEnabled);
  const room = {
    id: roomId,
    state: createRoomState(100, 100, durationSeconds, Math.random, {
      winCondition,
      scoreLimit: winCondition === "score" ? scoreLimit : null,
      selfCollisionAllowed,
      snakeCollisionAllowed,
      fireEnabled
    }),
    playersJoined: 0,
    seats: { p1: null, p2: null },
    profiles: {
      p1: { name: "Player 1", color: "#58d27f" },
      p2: { name: "Player 2", color: "#5ab5ff" }
    },
    wsClients: new Map(),
    baseUrl,
    lastActiveAt: Date.now()
  };
  store.rooms.set(roomId, room);
  return room;
}

export function getRoom(roomId) {
  startTicker();
  return store.rooms.get(safeRoomId(roomId)) || null;
}

export function assignSeat(room, playerName, playerColor) {
  if (!room.seats.p1) {
    room.seats.p1 = playerName || "Player 1";
    room.profiles.p1 = {
      name: playerName || "Player 1",
      color: sanitizeColor(playerColor, "#58d27f")
    };
    room.playersJoined = Math.max(room.playersJoined, 1);
    return "p1";
  }
  if (!room.seats.p2) {
    room.seats.p2 = playerName || "Player 2";
    room.profiles.p2 = {
      name: playerName || "Player 2",
      color: sanitizeColor(playerColor, "#5ab5ff")
    };
    room.playersJoined = 2;
    room.state = {
      ...room.state,
      status: "running",
      winner: null,
      remainingMs: room.state.winCondition === "time" ? room.state.durationSeconds * 1000 : room.state.remainingMs
    };
    return "p2";
  }
  return null;
}

export function joinRoom(room, playerName, playerColor) {
  const playerId = assignSeat(room, playerName, playerColor);
  if (!playerId) {
    return null;
  }
  room.lastActiveAt = Date.now();
  broadcast(room);
  return toPublicState(room, playerId);
}

export function setInput(room, playerId, targetX, targetY) {
  room.state = setPlayerTarget(room.state, playerId, targetX, targetY);
  room.lastActiveAt = Date.now();
}

export function fireInput(room, playerId) {
  const previousCount = room.state.bullets.length;
  room.state = fireBullet(room.state, playerId, Date.now());
  room.lastActiveAt = Date.now();
  broadcast(room);
  return room.state.bullets.length > previousCount;
}

export function updateDuration(room, durationSeconds) {
  room.state = setDuration(room.state, durationSeconds);
  room.lastActiveAt = Date.now();
  broadcast(room);
}

export function restartMatch(room) {
  room.state = restartRoom(room.state);
  if (room.playersJoined === 2) {
    room.state = { ...room.state, status: "running" };
  }
  room.lastActiveAt = Date.now();
  broadcast(room);
}

export function registerWsClient(room, playerId, socket: WebSocket) {
  const clientId = `${playerId}:${Math.random().toString(36).slice(2)}`;
  room.wsClients.set(clientId, { playerId, socket });
  room.lastActiveAt = Date.now();
  socket.send(JSON.stringify(toPublicState(room, playerId)));
  return () => {
    room.wsClients.delete(clientId);
    const disconnectedPlayerStillConnected = Array.from(room.wsClients.values()).some(
      (client: { playerId: string }) => client.playerId === playerId
    );
    if (room.playersJoined === 2 && !disconnectedPlayerStillConnected) {
      terminateRoom(room);
    }
  };
}

export function handleWsInput(room, playerId, message: { type?: string; targetX?: number; targetY?: number }) {
  if (message.type === "fire") {
    return { fired: fireInput(room, playerId) };
  }
  if (message.type === "restart") {
    restartMatch(room);
    return { ok: true };
  }
  if (message.type === "input" && Number.isFinite(message.targetX) && Number.isFinite(message.targetY)) {
    setInput(room, playerId, Number(message.targetX), Number(message.targetY));
    return { ok: true };
  }
  return { ok: false };
}

export function publicRoomState(room, playerId) {
  return toPublicState(room, playerId);
}
