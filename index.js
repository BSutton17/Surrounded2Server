const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors());

// Heroku eco dynos sleep after 30 minutes without an HTTP request, and an open
// socket does not count. The client hits this every few minutes mid-game.
app.get("/ping", (_req, res) => {
  res.set("Cache-Control", "no-store").send("pong");
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5173", "https://surroundedtwo.netlify.app"],
    methods: ["GET", "POST"],
  },
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

const BUFFER_SECONDS = 12;
const HOT_SEAT_SECONDS = 60;
const VOTING_SECONDS = 60;
const REVEAL_SECONDS = 15;
const LEADERBOARD_SECONDS = 10;
const TOTAL_ROUNDS = 5;
// How long a dropped player keeps their seat, rule and score.
const DISCONNECT_GRACE_MS = 3 * 60 * 1000;
const MAX_NAME_LENGTH = 20;
const MAX_ROOM_CODE_LENGTH = 12;

const RULE_POOL = [
  // Difficulty 1: obvious keyword/format constraints (easy to spot)
  { rule: "Always mention an animal in your response", difficulty: 1 },
  { rule: "Your answer must always contain a color", difficulty: 1 },
  { rule: "Your answer must contain a number", difficulty: 1 },
  { rule: "Use exactly five words in every answer", difficulty: 1 },
  { rule: "Say 'uhh' or 'umm' before you answer", difficulty: 1 },
  { rule: "Your answer must include a type of food", difficulty: 1 },
  { rule: "Mention a city in your answer", difficulty: 1 },
  { rule: "Mention a sport in your answer", difficulty: 1 },
  { rule: "Say the name of a flower in your answer", difficulty: 1 },
  { rule: "Say chat at any point during your answer", difficulty: 1 },
  { rule: "Say a type of rock or gem in your answer", difficulty: 1 },
  { rule: "Mention something space related in your answer", difficulty: 1 },
  { rule: "Your answer must contain the word idk", difficulty: 1 },
  { rule: "Say the name of a pokemon in your answer", difficulty: 1 },
  { rule: "Mention the name of a fast food restaurant in your answer", difficulty: 1 },
  { rule: "Your answer must include a reference to the weather", difficulty: 1 },
  { rule: "Say the word \"honestly\" at least once per answer", difficulty: 1 },
  { rule: "Include the name of a day of the week in your answer", difficulty: 1 },
  { rule: "Say the word \"literally\" at least once per answer", difficulty: 1 },
  { rule: "Mention a body part in your answer", difficulty: 1 },
  { rule: "Mention a fruit in every answer.", difficulty: 1 },
  { rule: "Mention a vegetable in every answer.", difficulty: 1 },
  { rule: "Include the word \"maybe\" in every answer.", difficulty: 2 },
  { rule: "Mention a holiday in your answer.", difficulty: 1 },
  { rule: "Include a household item in your answer", difficulty: 3 },

  // Difficulty 2: conversational/language style constraints (moderate)
  { rule: "Give the opposite of your real answer", difficulty: 2 },
  { rule: "Answer the question how the person asking it would answer", difficulty: 2 },
  { rule: "Subtly work the word school into your answer", difficulty: 2 },
  { rule: "Repeat part of the question before answering", difficulty: 2 },
  { rule: "Always reference something that happened yesterday", difficulty: 2 },
  { rule: "Use the name of a famous person somewhere in your answer", difficulty: 2 },
  { rule: "Your answer must always contain the word technically", difficulty: 2 },
  { rule: "Include the name of a country in your response", difficulty: 2 },
  { rule: "Your answer must contain a famous movie title", difficulty: 2 },
  { rule: "Mention how tall or short something is in your answer", difficulty: 2 },
  { rule: "Use a rhyme in your answer", difficulty: 2 },
  { rule: "Use only single-syllable words in your answer", difficulty: 2 },
  { rule: "Reference something you are wearing in your answer", difficulty: 2 },
  { rule: "Act like you are unsure of your answer, even if it is obvious", difficulty: 2 },
  { rule: "Answer as if you are offended", difficulty: 2 },
  { rule: "Act like you really do not want to answer before giving your answer", difficulty: 2 },
  { rule: "Incorporate the phrase \"what do you mean\" into your answer", difficulty: 2 },
  { rule: "Answer in one sentence", difficulty: 2 },
  { rule: "Answer as if you are giving advice", difficulty: 2 },
  { rule: "Use the past tense in your answer", difficulty: 2 },
  { rule: "Mention a controversal topic in each of your answers", difficulty: 2 },

  // Difficulty 3: physical/subtle behavior constraints (hard)
  { rule: "At any point, touch your head or face while you answer", difficulty: 3 },
  { rule: "Look at the ceiling when answering", difficulty: 3 },
  { rule: "Look at the floor while answering", difficulty: 3 },
  { rule: "Do not look at the person while you are answering", difficulty: 3 },
  { rule: "At any point, point to someone while you answer", difficulty: 3 },
  { rule: "Clap your hands before or after answering", difficulty: 3 },
  { rule: "At some point, stretch while you answer", difficulty: 3 },
  { rule: "At some point, stutter", difficulty: 3 },
  { rule: "Only speak while tapping your foot", difficulty: 3 },
  { rule: "Nod or shake your head after every sentence", difficulty: 3 },
  { rule: "Squint while answering", difficulty: 3 },
  { rule: "Compliment the person during your answer", difficulty: 3 },
  { rule: "Mention something related to gambling in your answer", difficulty: 3 },
  { rule: "Answer in the form of a metaphor", difficulty: 3 },
  { rule: "Pause for two seconds before every answer", difficulty: 3 },
  { rule: "Close your eyes while answering (no, blinking doesn't count)", difficulty: 3 },
  { rule: "Use exaggerated hand gestures while you answer", difficulty: 3 },
  { rule: "Lightly tap the table before each sentence", difficulty: 3 },
  { rule: "Turn your head briefly to one side before finishing", difficulty: 3 },
  { rule: "Sigh during or at the end of your answer", difficulty: 3 }
];

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function getRoundDifficulty(roundNumber) {
  if (roundNumber <= 2) return 1;
  if (roundNumber <= 4) return 2;
  return 3;
}

function buildSharedRules(targetCount, difficulty) {
  const rulesForDifficulty = RULE_POOL
    .filter((entry) => entry.difficulty === difficulty)
    .map((entry) => entry.rule);

  if (rulesForDifficulty.length === 0) {
    throw new Error(`No rules available for difficulty ${difficulty}.`);
  }

  const sharedRules = [];
  while (sharedRules.length < targetCount) {
    const shuffled = shuffle(rulesForDifficulty);
    for (const rule of shuffled) {
      sharedRules.push(rule);
      if (sharedRules.length >= targetCount) {
        break;
      }
    }
  }
  return sharedRules;
}

function buildRoundData(playerOrder, difficulty) {
  const potentialRules = buildSharedRules(Math.max(10, playerOrder.length * 2), difficulty);
  const uniqueRules = [...new Set(potentialRules)];

  if (uniqueRules.length < playerOrder.length) {
    throw new Error("Not enough unique potential rules to assign each player a unique rule.");
  }

  const shuffledUniqueRules = shuffle(uniqueRules);
  const playerRules = {};
  playerOrder.forEach((playerName, index) => {
    playerRules[playerName] = shuffledUniqueRules[index];
  });

  return { potentialRules, playerRules };
}

function sanitizeVotes(state, voterName, rawAssignments) {
  if (!rawAssignments || typeof rawAssignments !== "object") {
    return {};
  }

  const validRules = new Set(state.potentialRules);
  const validPlayers = new Set(state.playerOrder);
  const assignments = {};
  const usedPlayers = new Set();

  // Accept legacy shape { rule: player } and normalize to { player: rule }.
  for (const [key, value] of Object.entries(rawAssignments)) {
    let guessedPlayer = null;
    let guessedRule = null;

    if (validRules.has(key) && validPlayers.has(value)) {
      guessedRule = key;
      guessedPlayer = value;
    } else if (validPlayers.has(key) && validRules.has(value)) {
      guessedPlayer = key;
      guessedRule = value;
    }

    if (!guessedPlayer || !guessedRule) continue;
    if (guessedPlayer === voterName) continue;
    if (usedPlayers.has(guessedPlayer)) continue;

    assignments[guessedPlayer] = guessedRule;
    usedPlayers.add(guessedPlayer);
  }

  return assignments;
}

// ---------------------------------------------------------------------------
// Rooms
//
// Everything about a room lives on one object - its players, host, game and
// timers - so tearing a room down is one delete instead of chasing eight maps.
// ---------------------------------------------------------------------------

const rooms = new Map();

function createRoom(code) {
  const room = {
    code,
    players: [], // { name, socketId, connected, lastSeenAt }
    ownerName: null, // who opened the room - host comes back to them on return
    hostName: null,
    game: null,
    timers: { phase: null, grace: {} },
  };
  rooms.set(code, room);
  return room;
}

function destroyRoom(room) {
  clearTimeout(room.timers.phase);
  Object.values(room.timers.grace).forEach(clearTimeout);
  rooms.delete(room.code);
  console.log(`Room ${room.code} closed`);
}

const findPlayer = (room, name) => room.players.find((player) => player.name === name);
const connectedPlayers = (room) => room.players.filter((player) => player.connected);

// Never send socket ids to the browser - nobody needs them.
const publicPlayers = (room) =>
  room.players.map(({ name, connected }) => ({ name, connected, isHost: name === room.hostName }));

// The host is the owner while they are online, otherwise the first connected
// player - so a locked phone never leaves the room without controls.
function reassignHost(room) {
  const owner = findPlayer(room, room.ownerName);
  if (owner && owner.connected) {
    room.hostName = owner.name;
    return;
  }
  const host = findPlayer(room, room.hostName);
  if (host && host.connected) return;
  const next = connectedPlayers(room)[0];
  room.hostName = next ? next.name : null;
}

function emitPlayers(room) {
  io.to(room.code).emit("updatePlayerList", publicPlayers(room));
  io.to(room.code).emit("host_update", room.hostName);
}

function clearGraceTimer(room, name) {
  clearTimeout(room.timers.grace[name]);
  delete room.timers.grace[name];
}

// ---------------------------------------------------------------------------
// Game flow: buffer -> hotseat (per player) -> voting -> reveal -> leaderboard
// -> next round ... -> podium. Every phase is driven by one timer per room.
// ---------------------------------------------------------------------------

function getSnakeOrder(baseOrder, roundNumber) {
  if (roundNumber % 2 === 1) {
    return [...baseOrder];
  }
  return [...baseOrder].reverse();
}

function setPhaseTimer(room, seconds, next) {
  clearTimeout(room.timers.phase);
  room.timers.phase = setTimeout(() => {
    room.timers.phase = null;
    // The game may have been reset or the room closed while we waited.
    if (rooms.get(room.code) === room && room.game) next();
  }, seconds * 1000);
}

function enterPhase(room, phase, seconds) {
  room.game.phase = phase;
  room.game.endsAt = seconds ? Date.now() + seconds * 1000 : 0;
  io.to(room.code).emit("turn_phase", buildPhasePayload(room.game));
}

function buildPhasePayload(state) {
  return {
    phase: state.phase,
    hotSeat: state.playerOrder[state.currentTurnIndex] || null,
    potentialRules: state.potentialRules,
    endsAt: state.endsAt,
    revealAssignments: state.revealAssignments || [],
    scores: state.scores || {},
    roundNumber: state.roundNumber || 0,
    totalRounds: TOTAL_ROUNDS,
  };
}

// Each player only ever receives their OWN rule. Broadcasting every rule to
// the whole room let anyone read the answers out of devtools.
function sendGameData(room, player) {
  const state = room.game;
  if (!state || !player.socketId) return;
  const rule = state.playerRules[player.name];
  io.to(player.socketId).emit("game_data", {
    potentialRules: state.potentialRules,
    playerRules: rule ? { [player.name]: rule } : {},
    scores: state.scores || {},
  });
}

function emitGameData(room) {
  room.players.forEach((player) => sendGameData(room, player));
}

function startNewRound(room) {
  const state = room.game;
  const baseOrder = room.players.map((player) => player.name);
  if (!baseOrder.length) {
    clearTimeout(room.timers.phase);
    room.game = null;
    return;
  }

  state.roundNumber += 1;
  if (state.roundNumber > TOTAL_ROUNDS) {
    startPodiumPhase(room);
    return;
  }

  const playerOrder = getSnakeOrder(baseOrder, state.roundNumber);
  const difficulty = getRoundDifficulty(state.roundNumber);

  try {
    const roundData = buildRoundData(playerOrder, difficulty);
    state.playerOrder = playerOrder;
    state.currentTurnIndex = 0;
    state.potentialRules = roundData.potentialRules;
    state.playerRules = roundData.playerRules;
    state.votesByVoter = {};
    state.revealAssignments = [];

    playerOrder.forEach((name) => {
      if (typeof state.scores[name] !== "number") {
        state.scores[name] = 0;
      }
    });

    emitGameData(room);
    startBufferPhase(room);
  } catch (error) {
    io.to(room.code).emit("game_error", error.message || "Could not start new round.");
  }
}

function startBufferPhase(room) {
  enterPhase(room, "buffer", BUFFER_SECONDS);
  setPhaseTimer(room, BUFFER_SECONDS, () => startHotSeatPhase(room));
}

function startHotSeatPhase(room) {
  enterPhase(room, "hotseat", HOT_SEAT_SECONDS);
  setPhaseTimer(room, HOT_SEAT_SECONDS, () => advanceTurn(room));
}

function advanceTurn(room) {
  const state = room.game;
  state.currentTurnIndex += 1;
  if (state.currentTurnIndex >= state.playerOrder.length) {
    startVotingPhase(room);
    return;
  }
  startBufferPhase(room);
}

function startVotingPhase(room) {
  room.game.votesByVoter = {};
  enterPhase(room, "voting", VOTING_SECONDS);
  setPhaseTimer(room, VOTING_SECONDS, () => finalizeVoting(room));
}

function finalizeVoting(room) {
  const state = room.game;

  for (const [voterName, assignments] of Object.entries(state.votesByVoter || {})) {
    let points = 0;
    for (const [guessedPlayer, guessedRule] of Object.entries(assignments)) {
      if (state.playerRules[guessedPlayer] === guessedRule) {
        points += 2;
      }
    }
    if (points > 0) {
      state.scores[voterName] = (state.scores[voterName] || 0) + points;
    }
  }

  state.revealAssignments = state.playerOrder.map((playerName) => ({
    player: playerName,
    rule: state.playerRules[playerName] || "",
  }));

  enterPhase(room, "reveal", REVEAL_SECONDS);
  setPhaseTimer(room, REVEAL_SECONDS, () => startLeaderboardPhase(room));
}

function startLeaderboardPhase(room) {
  enterPhase(room, "leaderboard", LEADERBOARD_SECONDS);
  setPhaseTimer(room, LEADERBOARD_SECONDS, () => {
    if (room.game.roundNumber >= TOTAL_ROUNDS) {
      startPodiumPhase(room);
      return;
    }
    startNewRound(room);
  });
}

function startPodiumPhase(room) {
  clearTimeout(room.timers.phase);
  room.timers.phase = null;
  enterPhase(room, "podium", 0);
}

// A player is gone for good (left, or never came back): take them out of the
// game without skipping or repeating anybody's turn.
function removePlayer(room, playerName) {
  if (!findPlayer(room, playerName)) return;

  clearGraceTimer(room, playerName);
  room.players = room.players.filter((player) => player.name !== playerName);

  if (room.players.length === 0) {
    destroyRoom(room);
    return;
  }

  if (room.ownerName === playerName) {
    room.ownerName = (connectedPlayers(room)[0] || room.players[0]).name;
  }
  reassignHost(room);
  emitPlayers(room);

  const state = room.game;
  if (!state) return;

  const index = state.playerOrder.indexOf(playerName);
  delete state.playerRules[playerName];
  delete state.scores[playerName];
  delete state.votesByVoter[playerName];
  if (index === -1) return;

  state.playerOrder.splice(index, 1);
  const turnPhase = state.phase === "buffer" || state.phase === "hotseat";

  if (index < state.currentTurnIndex) {
    // Their turn already happened; keep pointing at the same next player.
    state.currentTurnIndex -= 1;
    io.to(room.code).emit("turn_phase", buildPhasePayload(state));
  } else if (index === state.currentTurnIndex && turnPhase) {
    // It was their turn: hand it straight to whoever is next.
    if (state.currentTurnIndex >= state.playerOrder.length) {
      startVotingPhase(room);
    } else {
      startBufferPhase(room);
    }
  } else {
    io.to(room.code).emit("turn_phase", buildPhasePayload(state));
  }
}

// ---------------------------------------------------------------------------
// Sockets
// ---------------------------------------------------------------------------

// Trimmed string (numbers allowed, since room codes arrive as either), or ""
// when missing or too long.
const cleanString = (value, maxLength) => {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const trimmed = String(value).trim();
  return trimmed.length <= maxLength ? trimmed : "";
};

// One bad packet must never crash the process - every room lives in memory.
const safely = (event, handler) => (...args) => {
  try {
    handler(...args);
  } catch (error) {
    console.error(`Error handling "${event}":`, error);
  }
};

io.on("connection", (socket) => {
  console.log(`User Connected: ${socket.id}`);
  const on = (event, handler) => socket.on(event, safely(event, handler));

  // The room and seat this socket currently owns. A socket whose seat was
  // taken over by a newer connection (a refresh) owns nothing.
  const currentSeat = () => {
    const room = rooms.get(socket.data.room);
    const player = room && findPlayer(room, socket.data.name);
    return player && player.socketId === socket.id ? { room, player } : {};
  };

  const isHost = () => {
    const { room, player } = currentSeat();
    return Boolean(room && player && room.hostName === player.name);
  };

  on("join_room", (roomArg, nameArg, ack) => {
    const reply = typeof ack === "function" ? ack : () => {};
    const code = cleanString(roomArg, MAX_ROOM_CODE_LENGTH);
    const name = cleanString(nameArg, MAX_NAME_LENGTH);
    if (!code || !name) {
      reply({ ok: false, message: "Enter a name (up to 20 characters) and a room code." });
      return;
    }

    // Moving to a different room on the same socket frees the old seat.
    const previous = currentSeat();
    if (previous.room && previous.room.code !== code) {
      socket.leave(previous.room.code);
      removePlayer(previous.room, previous.player.name);
    }

    const room = rooms.get(code) || createRoom(code);
    let player = findPlayer(room, name);

    if (player) {
      // Same name again: a refresh or a reconnect. Hand the seat to the new
      // socket and drop the stale one if it is somehow still open.
      if (player.socketId && player.socketId !== socket.id) {
        const stale = io.sockets.sockets.get(player.socketId);
        if (stale) {
          stale.data.room = null;
          stale.disconnect(true);
        }
      }
      clearGraceTimer(room, name);
      player.socketId = socket.id;
      player.connected = true;
      player.lastSeenAt = Date.now();
    } else {
      player = { name, socketId: socket.id, connected: true, lastSeenAt: Date.now() };
      room.players.push(player);
    }

    if (!room.ownerName) room.ownerName = name;
    socket.join(code);
    socket.data.room = code;
    socket.data.name = name;
    reassignHost(room);

    // Catch a (re)joining player up on the game in progress.
    if (room.game) {
      if (typeof room.game.scores[name] !== "number") {
        room.game.scores[name] = 0;
      }
      socket.emit("turn_phase", buildPhasePayload(room.game));
      sendGameData(room, player);
    }

    console.log(`Player ${name} joined room ${code}`);
    emitPlayers(room);
    reply({ ok: true, players: publicPlayers(room), hostName: room.hostName });
  });

  // The room argument is ignored on the events below: a socket can only act
  // on the room it actually joined.

  on("startGame", () => {
    const { room } = currentSeat();
    if (!room || !isHost() || room.players.length === 0) return;

    clearTimeout(room.timers.phase);
    room.game = {
      playerOrder: [],
      currentTurnIndex: 0,
      roundNumber: 0,
      phase: "buffer",
      potentialRules: [],
      playerRules: {},
      votesByVoter: {},
      revealAssignments: [],
      scores: Object.fromEntries(room.players.map((player) => [player.name, 0])),
      endsAt: 0,
    };

    io.to(room.code).emit("gameStarted");
    startNewRound(room);
    console.log(`Game started in room: ${room.code}`);
  });

  on("question_answered", () => {
    const { room } = currentSeat();
    const state = room && room.game;
    if (!state || !isHost() || state.phase !== "hotseat") return;

    const hotSeatPlayer = state.playerOrder[state.currentTurnIndex];
    if (!hotSeatPlayer) return;

    state.scores[hotSeatPlayer] = (state.scores[hotSeatPlayer] || 0) + 0.5;
    io.to(room.code).emit("turn_phase", buildPhasePayload(state));
  });

  on("submit_votes", (_room, rawAssignments) => {
    const { room, player } = currentSeat();
    const state = room && room.game;
    if (!state || state.phase !== "voting") return;

    state.votesByVoter[player.name] = sanitizeVotes(state, player.name, rawAssignments);
  });

  on("reset_game", () => {
    const { room } = currentSeat();
    if (!room || !isHost()) return;

    clearTimeout(room.timers.phase);
    room.timers.phase = null;
    room.game = null;
    io.to(room.code).emit("reset_game");
  });

  on("leave_room", () => {
    const { room, player } = currentSeat();
    socket.data.room = null;
    if (!room) return;

    socket.leave(room.code);
    console.log(`${player.name} left room ${room.code}`);
    removePlayer(room, player.name);
  });

  on("disconnect", (reason) => {
    const { room, player } = currentSeat();
    console.log(`User Disconnected: ${socket.data.name || "-"} (${socket.id}, ${reason})`);
    if (!room) return;

    // Hold the seat: the game keeps running on its timers, and the player
    // drops straight back in where the room is when they reconnect.
    player.connected = false;
    player.lastSeenAt = Date.now();
    player.socketId = null;
    reassignHost(room);
    emitPlayers(room);

    clearGraceTimer(room, player.name);
    room.timers.grace[player.name] = setTimeout(() => {
      const stillGone = findPlayer(room, player.name);
      if (rooms.get(room.code) === room && stillGone && !stillGone.connected) {
        console.log(`${player.name} did not return to ${room.code} - removing`);
        removePlayer(room, player.name);
      }
    }, DISCONNECT_GRACE_MS);
  });
});

server.listen(process.env.PORT || 3001, () => {
  console.log("SERVER RUNNING");
});

// Heroku sends SIGTERM when it restarts or sleeps the dyno. Close sockets
// cleanly so every client starts reconnecting straight away.
process.on("SIGTERM", () => {
  console.log("SIGTERM received - shutting down");
  io.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
});
