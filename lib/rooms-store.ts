import type { WebSocket } from "ws";
import { createRoomState, fireBullet, restartRoom, setDuration, setPlayerTarget, tickRoom } from "./multiplayer-logic";

const TICK_MS = 80;
const DEFAULT_COLORS = [
  "#58d27f",
  "#5ab5ff",
  "#ff8d5a",
  "#ffd166",
  "#c77dff",
  "#f72585",
  "#4cc9f0",
  "#90be6d",
  "#f28482",
  "#84a59d"
];

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

function clampPlayers(value, fallback = 2) {
  return Math.max(2, Math.min(10, Math.floor(Number(value) || fallback)));
}

function makePlayerIds(maxPlayers) {
  return Array.from({ length: maxPlayers }, (_, index) => `p${index + 1}`);
}

const globalStore = globalThis as typeof globalThis & { __snakeStore?: ReturnType<typeof initialStore> };
const store = globalStore.__snakeStore ?? initialStore();
globalStore.__snakeStore = store;

function joinedPlayerIds(room) {
  return room.playerIds.filter((playerId) => Boolean(room.seats[playerId]));
}

function readyPlayerIds(room) {
  return joinedPlayerIds(room).filter((playerId) => room.readyState[playerId]);
}

function canRoomStart(room) {
  const joinedIds = joinedPlayerIds(room);
  return joinedIds.length === room.maxPlayers && joinedIds.every((playerId) => room.readyState[playerId]);
}

function rebuildLobbyState(room) {
  room.state = restartRoom(room.state, Math.random, { activePlayerIds: joinedPlayerIds(room) });
}

function startRoomMatch(room) {
  room.state = restartRoom(room.state, Math.random, { activePlayerIds: joinedPlayerIds(room) });
  room.state = {
    ...room.state,
    status: "running",
    winner: null
  };
}

function toPublicState(room, playerId) {
  const joinedIds = joinedPlayerIds(room);
  return {
    type: "state",
    roomId: room.id,
    playerId,
    roomMode: room.mode,
    maxPlayers: room.maxPlayers,
    playersJoined: joinedIds.length,
    playersReady: readyPlayerIds(room).length,
    inviteUrl: `${room.baseUrl}/play?room=${room.id}`,
    profiles: room.profiles,
    slots: room.playerIds.map((slotPlayerId) => ({
      playerId: slotPlayerId,
      joined: Boolean(room.seats[slotPlayerId]),
      ready: Boolean(room.seats[slotPlayerId]) && Boolean(room.readyState[slotPlayerId]),
      name: room.profiles[slotPlayerId].name,
      color: room.profiles[slotPlayerId].color
    })),
    canStart: canRoomStart(room),
    state: room.state
  };
}

function broadcast(room) {
  const payloadByPlayer = Object.fromEntries(
    room.playerIds.map((playerId) => [playerId, JSON.stringify(toPublicState(room, playerId))])
  );

  for (const [clientId, client] of room.wsClients.entries()) {
    try {
      client.socket.send(payloadByPlayer[client.playerId] ?? payloadByPlayer[room.playerIds[0]]);
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
    mode?: string;
    maxPlayers?: number;
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
  const mode = options.mode === "swarm" ? "swarm" : "classic";
  const maxPlayers = mode === "swarm" ? clampPlayers(options.maxPlayers, 4) : 2;
  const playerIds = makePlayerIds(maxPlayers);
  const winCondition = options.winCondition === "score" ? "score" : "time";
  const durationSeconds = Math.max(10, Math.min(900, Math.floor(Number(options.durationSeconds) || 120)));
  const scoreLimit = Math.max(1, Math.min(200, Math.floor(Number(options.scoreLimit) || 5)));
  const selfCollisionAllowed = Boolean(options.selfCollisionAllowed);
  const snakeCollisionAllowed = Boolean(options.snakeCollisionAllowed);
  const fireEnabled = Boolean(options.fireEnabled);
  const profiles = Object.fromEntries(
    playerIds.map((playerId, index) => [
      playerId,
      {
        name: `Player ${index + 1}`,
        color: DEFAULT_COLORS[index % DEFAULT_COLORS.length]
      }
    ])
  );
  const room = {
    id: roomId,
    mode,
    maxPlayers,
    playerIds,
    state: createRoomState(100, 100, durationSeconds, Math.random, {
      playerIds,
      activePlayerIds: [],
      winCondition,
      scoreLimit: winCondition === "score" ? scoreLimit : null,
      selfCollisionAllowed,
      snakeCollisionAllowed,
      fireEnabled
    }),
    seats: Object.fromEntries(playerIds.map((playerId) => [playerId, null])),
    readyState: Object.fromEntries(playerIds.map((playerId) => [playerId, false])),
    profiles,
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
  for (const playerId of room.playerIds) {
    if (room.seats[playerId]) {
      continue;
    }
    room.seats[playerId] = playerName || room.profiles[playerId].name;
    room.readyState[playerId] = false;
    room.profiles[playerId] = {
      name: playerName || room.profiles[playerId].name,
      color: sanitizeColor(playerColor, room.profiles[playerId].color)
    };
    return playerId;
  }
  return null;
}

export function joinRoom(room, playerName, playerColor) {
  const playerId = assignSeat(room, playerName, playerColor);
  if (!playerId) {
    return null;
  }
  if (room.mode === "classic") {
    if (joinedPlayerIds(room).length === room.maxPlayers) {
      startRoomMatch(room);
    } else {
      rebuildLobbyState(room);
    }
  } else {
    rebuildLobbyState(room);
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

export function setReady(room, playerId, ready) {
  if (!room.seats[playerId] || room.mode !== "swarm") {
    return false;
  }
  room.readyState[playerId] = typeof ready === "boolean" ? ready : !room.readyState[playerId];
  if (canRoomStart(room)) {
    startRoomMatch(room);
  } else if (room.state.status !== "running") {
    rebuildLobbyState(room);
  }
  room.lastActiveAt = Date.now();
  broadcast(room);
  return true;
}

export function updateDuration(room, durationSeconds) {
  room.state = setDuration(room.state, durationSeconds);
  room.lastActiveAt = Date.now();
  broadcast(room);
}

export function restartMatch(room) {
  if (room.mode === "swarm") {
    for (const playerId of room.playerIds) {
      if (room.seats[playerId]) {
        room.readyState[playerId] = false;
      }
    }
    rebuildLobbyState(room);
  } else {
    room.state = restartRoom(room.state, Math.random, { activePlayerIds: joinedPlayerIds(room) });
    if (joinedPlayerIds(room).length === room.maxPlayers) {
      room.state = { ...room.state, status: "running", winner: null };
    }
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
    if (!room.seats[playerId] || disconnectedPlayerStillConnected) {
      return;
    }
    if (room.mode === "swarm") {
      if (room.wsClients.size === 0) {
        terminateRoom(room);
      }
      return;
    }
    if (room.seats[playerId]) {
      terminateRoom(room);
    }
  };
}

export function handleWsInput(room, playerId, message: { type?: string; targetX?: number; targetY?: number; ready?: boolean }) {
  if (message.type === "fire") {
    return { fired: fireInput(room, playerId) };
  }
  if (message.type === "restart") {
    restartMatch(room);
    return { ok: true };
  }
  if (message.type === "ready") {
    return { ok: setReady(room, playerId, message.ready) };
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
