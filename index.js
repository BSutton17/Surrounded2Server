const express = require("express");
const app = express();
const http = require("http");
const cors = require("cors");

app.use(cors());

const server = http.createServer(app);
const io = require('socket.io')(server, {
  cors: {
    origin: ['http://localhost:5173', 'https://surroundedtwo.netlify.app'],
    methods: ['GET', 'POST']
  }
});


let rooms = {};
// Track imposters per room
let roomImposters = {};
let playerAnswers = {};
let playerNames = {};
let disconnectTimers = {};
let socketRooms = {};
// Voting state per room (must be global, not per connection)
let roomVotes = {};
let roomVoters = {};
let roomGameStates = {};
let roomPhaseTimers = {};

const BUFFER_SECONDS = 1;
const HOT_SEAT_SECONDS = 1;
const VOTING_SECONDS = 35;
const REVEAL_SECONDS = 10;
const LEADERBOARD_SECONDS = 5;
const TOTAL_ROUNDS = 5;
const DISCONNECT_GRACE_MS = 180000;

function getDisconnectKey(room, playerName) {
  return `${room}::${playerName}`;
}

function clearDisconnectTimer(room, playerName) {
  const key = getDisconnectKey(room, playerName);
  if (disconnectTimers[key]) {
    clearTimeout(disconnectTimers[key]);
    delete disconnectTimers[key];
  }
}

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

function getRoomPlayerOrder(room) {
  if (!rooms[room] || !Array.isArray(rooms[room].players)) {
    return [];
  }
  return rooms[room].players.map((player) => player.name);
}

function getSnakeOrder(baseOrder, roundNumber) {
  if (roundNumber % 2 === 1) {
    return [...baseOrder];
  }
  return [...baseOrder].reverse();
}

function clearRoomPhaseTimer(room) {
  if (roomPhaseTimers[room]) {
    clearTimeout(roomPhaseTimers[room]);
    delete roomPhaseTimers[room];
  }
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
    totalRounds: TOTAL_ROUNDS
  };
}

function emitGameData(room, state) {
  io.to(room).emit("game_data", {
    potentialRules: state.potentialRules,
    playerRules: state.playerRules,
    scores: state.scores || {}
  });
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

function startNewRound(room) {
  const state = roomGameStates[room];
  if (!state) {
    return;
  }

  const baseOrder = getRoomPlayerOrder(room);
  if (!baseOrder.length) {
    clearRoomPhaseTimer(room);
    delete roomGameStates[room];
    return;
  }

  state.roundNumber = (state.roundNumber || 0) + 1;

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
    state.turnsTaken = 0;
    state.potentialRules = roundData.potentialRules;
    state.playerRules = roundData.playerRules;
    state.votesByVoter = {};
    state.revealAssignments = [];

    playerOrder.forEach((name) => {
      if (typeof state.scores[name] !== "number") {
        state.scores[name] = 0;
      }
    });

    emitGameData(room, state);
    startBufferPhase(room);
  } catch (error) {
    io.to(room).emit("game_error", error.message || "Could not start new round.");
  }
}

function finalizeVoting(room) {
  const state = roomGameStates[room];
  if (!state) {
    return;
  }

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
    rule: state.playerRules[playerName] || ""
  }));

  startRevealPhase(room);
}

function startVotingPhase(room) {
  const state = roomGameStates[room];
  if (!state || !state.playerOrder.length) {
    return;
  }

  state.phase = "voting";
  state.votesByVoter = {};
  state.endsAt = Date.now() + VOTING_SECONDS * 1000;
  io.to(room).emit("turn_phase", buildPhasePayload(state));

  clearRoomPhaseTimer(room);
  roomPhaseTimers[room] = setTimeout(() => {
    finalizeVoting(room);
  }, VOTING_SECONDS * 1000);
}

function startRevealPhase(room) {
  const state = roomGameStates[room];
  if (!state) {
    return;
  }

  state.phase = "reveal";
  state.endsAt = Date.now() + REVEAL_SECONDS * 1000;
  io.to(room).emit("turn_phase", buildPhasePayload(state));

  clearRoomPhaseTimer(room);
  roomPhaseTimers[room] = setTimeout(() => {
    startLeaderboardPhase(room);
  }, REVEAL_SECONDS * 1000);
}

function startLeaderboardPhase(room) {
  const state = roomGameStates[room];
  if (!state) {
    return;
  }

  state.phase = "leaderboard";
  state.endsAt = Date.now() + LEADERBOARD_SECONDS * 1000;
  io.to(room).emit("turn_phase", buildPhasePayload(state));

  clearRoomPhaseTimer(room);
  roomPhaseTimers[room] = setTimeout(() => {
    if ((state.roundNumber || 0) >= TOTAL_ROUNDS) {
      startPodiumPhase(room);
      return;
    }
    startNewRound(room);
  }, LEADERBOARD_SECONDS * 1000);
}

function startPodiumPhase(room) {
  const state = roomGameStates[room];
  if (!state) {
    return;
  }

  state.phase = "podium";
  state.endsAt = 0;
  io.to(room).emit("turn_phase", buildPhasePayload(state));
  clearRoomPhaseTimer(room);
}

function startHotSeatPhase(room) {
  const state = roomGameStates[room];
  if (!state || !state.playerOrder.length) {
    return;
  }

  state.phase = "hotseat";
  state.endsAt = Date.now() + HOT_SEAT_SECONDS * 1000;
  io.to(room).emit("turn_phase", buildPhasePayload(state));

  clearRoomPhaseTimer(room);
  roomPhaseTimers[room] = setTimeout(() => {
    const latest = roomGameStates[room];
    if (!latest || !latest.playerOrder.length) {
      return;
    }
    latest.turnsTaken += 1;

    if (latest.turnsTaken >= latest.playerOrder.length) {
      startVotingPhase(room);
      return;
    }

    latest.currentTurnIndex += 1;
    startBufferPhase(room);
  }, HOT_SEAT_SECONDS * 1000);
}

function startBufferPhase(room) {
  const state = roomGameStates[room];
  if (!state || !state.playerOrder.length) {
    return;
  }

  state.phase = "buffer";
  state.endsAt = Date.now() + BUFFER_SECONDS * 1000;
  io.to(room).emit("turn_phase", buildPhasePayload(state));

  clearRoomPhaseTimer(room);
  roomPhaseTimers[room] = setTimeout(() => {
    startHotSeatPhase(room);
  }, BUFFER_SECONDS * 1000);
}

function removePlayerFromRoom(room, playerName) {
  if (!rooms[room] || !Array.isArray(rooms[room].players)) {
    return;
  }

  const stillPresent = rooms[room].players.some((player) => player.name === playerName);
  if (!stillPresent) {
    return;
  }

  rooms[room].players = rooms[room].players.filter((player) => player.name !== playerName);
  io.to(room).emit("updatePlayerList", rooms[room].players);

  const gameState = roomGameStates[room];
  if (gameState) {
    gameState.playerOrder = gameState.playerOrder.filter((name) => name !== playerName);
    delete gameState.playerRules[playerName];
    delete gameState.scores[playerName];
    delete gameState.votesByVoter[playerName];

    if (gameState.playerOrder.length === 0) {
      clearRoomPhaseTimer(room);
      delete roomGameStates[room];
    } else {
      if (gameState.currentTurnIndex >= gameState.playerOrder.length) {
        gameState.currentTurnIndex = gameState.playerOrder.length - 1;
      }
      if (gameState.turnsTaken >= gameState.playerOrder.length) {
        gameState.turnsTaken = gameState.playerOrder.length - 1;
      }
      io.to(room).emit("turn_phase", buildPhasePayload(gameState));
    }
  }
}

io.on("connection", (socket) => {
  console.log(`User Connected: ${socket.id}`);

  socket.on("startGame", (room) => {
    const roomData = rooms[room];
    if (!roomData || !Array.isArray(roomData.players) || roomData.players.length === 0) {
      return;
    }

    roomGameStates[room] = {
      playerOrder: getRoomPlayerOrder(room),
      currentTurnIndex: 0,
      turnsTaken: 0,
      roundNumber: 0,
      phase: "buffer",
      potentialRules: [],
      playerRules: {},
      votesByVoter: {},
      revealAssignments: [],
      scores: {},
      endsAt: 0
    };

    roomGameStates[room].playerOrder.forEach((playerName) => {
      roomGameStates[room].scores[playerName] = 0;
    });

    io.to(room).emit("gameStarted");
    startNewRound(room);
    
    console.log(`Game started in room: ${room}`);
  });

  socket.on("question_answered", (room) => {
    const state = roomGameStates[room];
    if (!state || state.phase !== "hotseat") {
      return;
    }

    const hotSeatPlayer = state.playerOrder[state.currentTurnIndex];
    if (!hotSeatPlayer) {
      return;
    }

    state.scores[hotSeatPlayer] = (state.scores[hotSeatPlayer] || 0) + 0.5;
    io.to(room).emit("turn_phase", buildPhasePayload(state));
  });

  socket.on("submit_votes", (room, rawAssignments) => {
    const state = roomGameStates[room];
    const voterName = playerNames[socket.id];
    if (!state || state.phase !== "voting" || !voterName) {
      return;
    }

    state.votesByVoter[voterName] = sanitizeVotes(state, voterName, rawAssignments);
  });

  
  socket.on("reset_game", (room) => {
    playerAnswers = {};
    clearRoomPhaseTimer(room);
    delete roomGameStates[room];
    io.to(room).emit("reset_game");
  });

  socket.on("join_room", (room, name, ack) => {
    socket.join(room);
    socketRooms[socket.id] = room;
  
    if (!rooms[room]) {
      rooms[room] = { players: [] };
    }

    const existingPlayer = rooms[room].players.find((p) => p.name === name);
    // Allow seamless refresh by re-binding an active player name to the new socket.
    if (existingPlayer && existingPlayer.connected && existingPlayer.socketId && existingPlayer.socketId !== socket.id) {
      const previousSocketId = existingPlayer.socketId;
      existingPlayer.socketId = socket.id;
      delete playerNames[previousSocketId];
      delete socketRooms[previousSocketId];
      const previousSocket = io.sockets.sockets.get(previousSocketId);
      if (previousSocket) {
        previousSocket.disconnect(true);
      }
    }
  
    // Check if player already exists by name (reconnect case)
    let playerObj = existingPlayer;
    if (!playerObj) {
      playerObj = { name, voteCount: 0, connected: true, lastSeenAt: Date.now(), socketId: socket.id };
      rooms[room].players.push(playerObj);
    } else {
      playerObj.connected = true;
      playerObj.lastSeenAt = Date.now();
      playerObj.socketId = socket.id;
      clearDisconnectTimer(room, name);
    }
    playerNames[socket.id] = name;

    if (roomGameStates[room]) {
      if (typeof roomGameStates[room].scores[name] !== "number") {
        roomGameStates[room].scores[name] = 0;
      }
      io.to(socket.id).emit("turn_phase", buildPhasePayload(roomGameStates[room]));
      emitGameData(room, roomGameStates[room]);
    }
    
    console.log(`Player ${name} joined room ${room}`);
  
    io.to(room).emit("updatePlayerList", rooms[room].players);
    if (typeof ack === "function") {
      ack({ ok: true, players: rooms[room].players });
    }
  });
  

  socket.on("disconnect", () => {
    const playerName = playerNames[socket.id];
    const room = socketRooms[socket.id];
    console.log(`User Disconnected: ${playerName} (${socket.id})`);
  
    if (!playerName || !room || !rooms[room]) {
      delete playerNames[socket.id];
      delete socketRooms[socket.id];
      return;
    }

    const playerObj = rooms[room].players.find((player) => player.name === playerName);
    if (playerObj && playerObj.socketId === socket.id) {
      playerObj.connected = false;
      playerObj.lastSeenAt = Date.now();
      playerObj.socketId = null;
    } else {
      delete playerNames[socket.id];
      delete socketRooms[socket.id];
      return;
    }

    clearDisconnectTimer(room, playerName);
    const key = getDisconnectKey(room, playerName);
    disconnectTimers[key] = setTimeout(() => {
      removePlayerFromRoom(room, playerName);
      delete disconnectTimers[key];
    }, DISCONNECT_GRACE_MS);
  
    // Clean up playerNames and disconnectTimers
    delete playerNames[socket.id];
    delete socketRooms[socket.id];
  });
  
});

server.listen(process.env.PORT || 3001, () => {
  console.log("SERVER RUNNING");
});
