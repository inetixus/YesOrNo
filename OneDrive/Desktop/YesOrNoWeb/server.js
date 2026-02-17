const path = require('path');
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static(path.join(__dirname, 'public')));

// ── CONFIG ──────────────────────────────────────────────
const GAME = {
    ROUND_TIME: 18,
    REVEAL_TIME: 4,
    BETWEEN_TIME: 5,
    LOBBY_TIME: 10,
    MIN_PLAYERS: 1,
    TICK_RATE: 50,
    TIMER_INTERVAL: 1000
};

// ── QUESTIONS ───────────────────────────────────────────
const QUESTIONS = [
    { q: "Is the sky blue?", a: true },
    { q: "Is fire cold?", a: false },
    { q: "Is Roblox free to play?", a: true },
    { q: "Do fish swim?", a: true },
    { q: "Is 1 + 1 = 3?", a: false },
    { q: "Is the Earth flat?", a: false },
    { q: "Does water boil at 100°C?", a: true },
    { q: "Is the sun a planet?", a: false },
    { q: "Can penguins fly?", a: false },
    { q: "Is Python a programming language?", a: true },
    { q: "Is the moon made of cheese?", a: false },
    { q: "Do humans need oxygen?", a: true },
    { q: "Is lava cold?", a: false },
    { q: "Is 10 > 5?", a: true },
    { q: "Do cats bark?", a: false },
    { q: "Is JavaScript the same as Java?", a: false },
    { q: "Is the speed of light faster than sound?", a: true },
    { q: "Is a tomato a fruit?", a: true },
    { q: "Do spiders have 6 legs?", a: false },
    { q: "Is Antarctica a continent?", a: true },
    { q: "Is Mars the closest planet to the sun?", a: false },
    { q: "Can birds fly backwards?", a: true },
    { q: "Is gold heavier than silver?", a: true },
    { q: "Do snakes have legs?", a: false },
    { q: "Is the Great Wall of China visible from space?", a: false },
    { q: "Is the ocean salty?", a: true },
    { q: "Does the moon produce its own light?", a: false },
    { q: "Is lightning hotter than the sun's surface?", a: true },
    { q: "Are diamonds made of carbon?", a: true },
    { q: "Can cows walk downstairs?", a: false }
];

// ── PLATFORM GEOMETRY (must match client) ───────────────
const ZONES = {
    yes:   { xMin: -55, xMax: -15, zMin: -25, zMax: 25 },
    no:    { xMin:  15, xMax:  55, zMin: -25, zMax: 25 },
    lobby: { xMin: -15, xMax:  15, zMin:  35, zMax: 65 }
};

function inZone(p, zone) {
    return p.x >= zone.xMin && p.x <= zone.xMax &&
           p.z >= zone.zMin && p.z <= zone.zMax;
}

// ── STATE ───────────────────────────────────────────────
let gameState = {
    phase: 'LOBBY',
    timer: GAME.LOBBY_TIME,
    question: 'Waiting for players...',
    answer: true,
    correctAnswer: null,
    round: 0,
    match: 0,
    winner: null,
    winnerColor: null,
    winnerName: null
};

let players = {};
let lastQuestion = -1;
let usedQuestions = [];

// ── PLAYER HELPERS ──────────────────────────────────────
function activePlayers() {
    return Object.values(players).filter(p => p.inGame && p.hp > 0);
}

function playerCount() {
    return Object.keys(players).length;
}

function pickQuestion() {
    if (usedQuestions.length >= QUESTIONS.length) usedQuestions = [];
    let idx;
    do {
        idx = Math.floor(Math.random() * QUESTIONS.length);
    } while (usedQuestions.includes(idx) && usedQuestions.length < QUESTIONS.length);
    usedQuestions.push(idx);
    lastQuestion = idx;
    return QUESTIONS[idx];
}

function spawnOnLobby(p) {
    p.x = (Math.random() - 0.5) * 20;
    p.y = 2;
    p.z = 50 + (Math.random() - 0.5) * 20;
}

function spawnOnArena(p) {
    p.x = (Math.random() - 0.5) * 6;
    p.y = 2;
    p.z = (Math.random() - 0.5) * 20;
}

// ── GAME LOOP ───────────────────────────────────────────
setInterval(() => {
    if (gameState.timer > 0) {
        gameState.timer--;
    } else {
        handleStateChange();
    }
}, GAME.TIMER_INTERVAL);

setInterval(() => {
    const ap = activePlayers();

    io.emit('update', {
        players,
        gameState: {
            phase: gameState.phase,
            timer: gameState.timer,
            question: gameState.question,
            correctAnswer: gameState.correctAnswer,
            round: gameState.round,
            match: gameState.match,
            winner: gameState.winner,
            winnerColor: gameState.winnerColor,
            winnerName: gameState.winnerName,
            playerCount: playerCount(),
            aliveCount: ap.length
        }
    });
}, GAME.TICK_RATE);

// ── STATE MACHINE ───────────────────────────────────────
function handleStateChange() {
    switch (gameState.phase) {
        case 'LOBBY':    startMatch(); break;
        case 'ROUND':    revealAnswer(); break;
        case 'REVEAL':   afterReveal(); break;
        case 'BETWEEN':  startNextQuestion(); break;
        case 'GAMEOVER': backToLobby(); break;
    }
}

function startMatch() {
    const total = playerCount();
    if (total < GAME.MIN_PLAYERS) {
        gameState.timer = GAME.LOBBY_TIME;
        gameState.question = 'Waiting for players...';
        return;
    }

    gameState.match++;
    gameState.round = 0;
    usedQuestions = [];
    gameState.winner = null;
    gameState.winnerColor = null;
    gameState.winnerName = null;

    for (let id in players) {
        const p = players[id];
        p.inGame = true;
        p.hp = 100;
        p.crawling = false;
        spawnOnArena(p);
        io.to(id).emit('joinGame');
    }

    startNextQuestion();
}

function startNextQuestion() {
    const alive = activePlayers();
    if (alive.length <= 1) {
        endMatch(alive[0] || null);
        return;
    }

    const q = pickQuestion();
    gameState.phase = 'ROUND';
    gameState.timer = GAME.ROUND_TIME;
    gameState.question = q.q;
    gameState.answer = q.a;
    gameState.correctAnswer = null;
    gameState.round++;
}

function revealAnswer() {
    gameState.phase = 'REVEAL';
    gameState.timer = GAME.REVEAL_TIME;
    gameState.correctAnswer = gameState.answer ? 'YES' : 'NO';
    gameState.question = `The answer is: ${gameState.correctAnswer}!`;

    for (let id in players) {
        const p = players[id];
        if (!p.inGame || p.hp <= 0) continue;

        const onYes = inZone(p, ZONES.yes);
        const onNo  = inZone(p, ZONES.no);

        let correct = false;
        if (gameState.answer === true  && onYes) correct = true;
        if (gameState.answer === false && onNo)  correct = true;

        if (!correct) {
            if (p.hp >= 100) {
                p.hp = 60;
                io.to(id).emit('feedback', { type: 'DAMAGED', hp: 60, msg: 'Wrong! HP: 60%' });
            } else if (p.hp >= 60) {
                p.hp = 20;
                p.crawling = true;
                io.to(id).emit('feedback', { type: 'CRITICAL', hp: 20, msg: 'Wrong again! HP: 20% — Crawling!' });
            } else {
                p.hp = 0;
                p.crawling = false;
                p.inGame = false;
                spawnOnLobby(p);
                io.to(id).emit('feedback', { type: 'ELIMINATED', hp: 0, msg: 'Eliminated!' });
                io.to(id).emit('toLobby');
            }
        } else {
            io.to(id).emit('feedback', { type: 'CORRECT', hp: p.hp, msg: 'Correct!' });
        }
    }
}

function afterReveal() {
    const alive = activePlayers();
    if (alive.length <= 1) {
        endMatch(alive[0] || null);
        return;
    }

    for (let id in players) {
        const p = players[id];
        if (p.inGame && p.hp > 0) {
            spawnOnArena(p);
            io.to(id).emit('returnToCenter');
        }
    }

    gameState.phase = 'BETWEEN';
    gameState.timer = GAME.BETWEEN_TIME;
    gameState.question = 'Get ready for the next question...';
    gameState.correctAnswer = null;
}

function endMatch(winner) {
    gameState.phase = 'GAMEOVER';
    gameState.timer = 8;
    if (winner) {
        gameState.winner = winner.id;
        gameState.winnerColor = winner.color;
        gameState.winnerName = winner.name;
        gameState.question = `${winner.name} wins!`;
        io.to(winner.id).emit('feedback', { type: 'WIN', hp: winner.hp, msg: 'You win!' });
    } else {
        gameState.question = 'No winner this round!';
    }
    gameState.correctAnswer = null;
}

function backToLobby() {
    gameState.phase = 'LOBBY';
    gameState.timer = GAME.LOBBY_TIME;
    gameState.question = 'Next match starting soon...';
    gameState.correctAnswer = null;
    gameState.winner = null;
    gameState.winnerColor = null;
    gameState.winnerName = null;

    for (let id in players) {
        const p = players[id];
        p.inGame = false;
        p.hp = 100;
        p.crawling = false;
        spawnOnLobby(p);
        io.to(id).emit('toLobby');
    }
}

// ── NETWORKING ──────────────────────────────────────────
const PLAYER_COLORS = [
    '#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6',
    '#1abc9c','#e67e22','#e91e63','#00bcd4','#8bc34a',
    '#ff6b6b','#4ecdc4','#45b7d1','#96ceb4','#ffeaa7'
];
let colorIndex = 0;

io.on('connection', socket => {
    console.log('+ Player joined:', socket.id);
    const color = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length];
    colorIndex++;

    players[socket.id] = {
        id: socket.id,
        x: 0, y: 2, z: 50,
        ry: 0,
        hp: 100,
        inGame: false,
        crawling: false,
        color,
        name: 'Player'
    };
    spawnOnLobby(players[socket.id]);

    socket.emit('init', { id: socket.id, color });

    // ── Username ──
    socket.on('setName', name => {
        const p = players[socket.id];
        if (!p) return;
        // Sanitize: strip tags, limit length
        let clean = String(name).replace(/<[^>]*>/g, '').trim().substring(0, 16);
        if (!clean) clean = 'Player';
        p.name = clean;
        console.log(`  Player ${socket.id} set name: ${clean}`);
    });

    socket.on('move', d => {
        const p = players[socket.id];
        if (!p) return;
        if (typeof d.x === 'number') p.x = d.x;
        if (typeof d.y === 'number') p.y = d.y;
        if (typeof d.z === 'number') p.z = d.z;
        if (typeof d.ry === 'number') p.ry = d.ry;
    });

    socket.on('disconnect', () => {
        console.log('- Player left:', socket.id);
        delete players[socket.id];
        io.emit('playerLeft', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});