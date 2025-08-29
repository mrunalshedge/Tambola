const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files from public directory
app.use(express.static('public'));

// Serve home page as default route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Game state
let gameState = {
    isActive: false,
    calledNumbers: [],
    availableNumbers: Array.from({length: 90}, (_, i) => i + 1),
    players: {},
    winners: {
        earlyFive: null,
        topLine: [],
        middleLine: [],
        bottomLine: [],
        corners: null,
        fullHouse: null
    }
};

// Shuffle array utility
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// Generate proper tambola ticket
function generateTicket() {
    const ticket = Array(3).fill().map(() => Array(9).fill(0));
    const ranges = [
        [1, 9], [10, 19], [20, 29], [30, 39], [40, 49],
        [50, 59], [60, 69], [70, 79], [80, 90]
    ];
    
    const usedNumbers = new Set();

    // Step 1: Fill each row with exactly 5 numbers
    for (let row = 0; row < 3; row++) {
        // Select 5 random columns for this row
        const selectedCols = [];
        while (selectedCols.length < 5) {
            const col = Math.floor(Math.random() * 9);
            if (!selectedCols.includes(col)) {
                selectedCols.push(col);
            }
        }

        // Fill selected columns with random numbers from respective ranges
        selectedCols.forEach(col => {
            const [min, max] = ranges[col];
            let number;
            let attempts = 0;
            
            do {
                number = Math.floor(Math.random() * (max - min + 1)) + min;
                attempts++;
                
                // Prevent infinite loop - if too many attempts, find any unused number in range
                if (attempts > 50) {
                    for (let n = min; n <= max; n++) {
                        if (!usedNumbers.has(n)) {
                            number = n;
                            break;
                        }
                    }
                    break;
                }
            } while (usedNumbers.has(number));
            
            usedNumbers.add(number);
            ticket[row][col] = number;
        });
    }

    // Step 2: Sort numbers in each column (ascending order)
    for (let col = 0; col < 9; col++) {
        const colNumbers = [];
        
        // Collect all non-zero numbers from this column
        for (let row = 0; row < 3; row++) {
            if (ticket[row][col] !== 0) {
                colNumbers.push({ value: ticket[row][col], row: row });
            }
        }
        
        // Sort by value
        colNumbers.sort((a, b) => a.value - b.value);
        
        // Clear column and refill with sorted numbers in their original positions
        for (let row = 0; row < 3; row++) {
            ticket[row][col] = 0;
        }
        
        colNumbers.forEach((num) => {
            ticket[num.row][col] = num.value;
        });
    }

    return ticket;
}

// Improved win checking logic
function checkWin(ticket, markedNumbers, pattern) {
    console.log(`Checking win for pattern: ${pattern}`);
    console.log('Ticket:', ticket);
    console.log('Marked numbers:', markedNumbers);
    
    switch (pattern) {
        case 'earlyFive':
            // Count marked numbers that exist on the ticket
            let ticketMarkedCount = 0;
            for (let row = 0; row < 3; row++) {
                for (let col = 0; col < 9; col++) {
                    const num = ticket[row][col];
                    if (num !== 0 && markedNumbers.includes(num)) {
                        ticketMarkedCount++;
                    }
                }
            }
            console.log(`Early Five: ${ticketMarkedCount} numbers marked on ticket`);
            return ticketMarkedCount >= 5;
            
        case 'topLine':
            const topLineResult = ticket[0].every(num => num === 0 || markedNumbers.includes(num));
            console.log('Top Line result:', topLineResult);
            return topLineResult;
            
        case 'middleLine':
            const middleLineResult = ticket[1].every(num => num === 0 || markedNumbers.includes(num));
            console.log('Middle Line result:', middleLineResult);
            return middleLineResult;
            
        case 'bottomLine':
            const bottomLineResult = ticket[2].every(num => num === 0 || markedNumbers.includes(num));
            console.log('Bottom Line result:', bottomLineResult);
            return bottomLineResult;
            
        case 'corners':
            // Get all four corner positions
            const corners = [
                ticket[0][0], // top-left
                ticket[0][8], // top-right  
                ticket[2][0], // bottom-left
                ticket[2][8]  // bottom-right
            ].filter(num => num !== 0); // Only consider non-zero corners
            
            console.log('Corner numbers:', corners);
            const cornersResult = corners.length > 0 && corners.every(num => markedNumbers.includes(num));
            console.log('Corners result:', cornersResult);
            return cornersResult;
            
        case 'fullHouse':
            const fullHouseResult = ticket.flat().every(num => num === 0 || markedNumbers.includes(num));
            console.log('Full House result:', fullHouseResult);
            return fullHouseResult;
            
        default:
            return false;
    }
}

// Validate that number exists on player's ticket
function validateNumberOnTicket(ticket, number) {
    return ticket.flat().includes(number);
}

// Socket connection handling
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    // Send current game state to new connections
    socket.emit('gameState', gameState);
    
    // Send current player list
    const playerList = Object.values(gameState.players).map(player => player.name);
    socket.emit('playerList', playerList);
    socket.emit('playerCount', Object.keys(gameState.players).length);

    // Player joins game
    socket.on('joinGame', (playerName) => {
        if (!playerName || playerName.trim() === '') {
            socket.emit('error', 'Please enter a valid name');
            return;
        }

        gameState.players[socket.id] = {
            name: playerName.trim(),
            ticket: generateTicket(),
            markedNumbers: []
        };
        
        socket.emit('ticketGenerated', gameState.players[socket.id].ticket);
        
        // Broadcast updated player list to all clients
        const playerList = Object.values(gameState.players).map(player => player.name);
        io.emit('playerList', playerList);
        io.emit('playerCount', Object.keys(gameState.players).length);
        
        console.log(`${playerName} joined the game`);
    });

    // Host starts game
    socket.on('startGame', () => {
        gameState.isActive = true;
        gameState.calledNumbers = [];
        gameState.availableNumbers = Array.from({length: 90}, (_, i) => i + 1);
        shuffle(gameState.availableNumbers);
        
        gameState.winners = {
            earlyFive: null,
            topLine: [],
            middleLine: [],
            bottomLine: [],
            corners: null,
            fullHouse: null
        };

        // Reset all player marked numbers
        Object.keys(gameState.players).forEach(playerId => {
            if (gameState.players[playerId]) {
                gameState.players[playerId].markedNumbers = [];
            }
        });

        io.emit('gameStarted');
        io.emit('winnersUpdate', gameState.winners);
        console.log('Game started');
    });

    // Host calls next number
    socket.on('callNumber', () => {
        if (gameState.isActive && gameState.availableNumbers.length > 0) {
            const number = gameState.availableNumbers.pop();
            gameState.calledNumbers.push(number);
            
            io.emit('numberCalled', {
                number: number,
                calledNumbers: gameState.calledNumbers
            });
            
            console.log(`Number called: ${number}`);
        }
    });

    // Player marks number
    socket.on('markNumber', (number) => {
        if (!gameState.players[socket.id]) {
            socket.emit('error', 'Player not found');
            return;
        }

        if (!gameState.calledNumbers.includes(number)) {
            socket.emit('error', 'Number has not been called yet');
            return;
        }

        const player = gameState.players[socket.id];
        
        // Validate that number exists on player's ticket
        if (!validateNumberOnTicket(player.ticket, number)) {
            socket.emit('error', `Number ${number} is not on your ticket`);
            return;
        }

        // Add number to marked numbers if not already marked
        if (!player.markedNumbers.includes(number)) {
            player.markedNumbers.push(number);
            socket.emit('numberMarked', number);
            console.log(`${player.name} marked number ${number}`);
        }
    });

    // Player claims win
    socket.on('claimWin', (pattern) => {
        if (!gameState.players[socket.id]) {
            socket.emit('error', 'Player not found');
            return;
        }

        if (!gameState.isActive && pattern !== 'fullHouse') {
            socket.emit('error', 'Game is not active');
            return;
        }

        const player = gameState.players[socket.id];
        const isValid = checkWin(player.ticket, player.markedNumbers, pattern);
        
        console.log(`${player.name} claiming ${pattern}, valid: ${isValid}`);
        
        if (isValid) {
            let winnerAnnounced = false;
            
            if (pattern === 'earlyFive' && !gameState.winners.earlyFive) {
                gameState.winners.earlyFive = player.name;
                io.emit('winnerAnnounced', { pattern: 'Early Five', winner: player.name });
                winnerAnnounced = true;
                
            } else if (pattern === 'corners' && !gameState.winners.corners) {
                gameState.winners.corners = player.name;
                io.emit('winnerAnnounced', { pattern: 'Four Corners', winner: player.name });
                winnerAnnounced = true;
                
            } else if (pattern === 'fullHouse' && !gameState.winners.fullHouse) {
                gameState.winners.fullHouse = player.name;
                gameState.isActive = false;
                io.emit('winnerAnnounced', { pattern: 'Full House', winner: player.name });
                io.emit('gameEnded');
                winnerAnnounced = true;
                
            } else if (['topLine', 'middleLine', 'bottomLine'].includes(pattern)) {
                if (!gameState.winners[pattern].includes(player.name)) {
                    gameState.winners[pattern].push(player.name);
                    const lineName = pattern.replace('middleLine', 'Middle Line')
                                          .replace('topLine', 'Top Line')
                                          .replace('bottomLine', 'Bottom Line');
                    io.emit('winnerAnnounced', { pattern: lineName, winner: player.name });
                    winnerAnnounced = true;
                }
            }
            
            if (winnerAnnounced) {
                io.emit('winnersUpdate', gameState.winners);
                socket.emit('winConfirmed', pattern);
            } else {
                socket.emit('error', `${pattern} has already been won`);
            }
            
        } else {
            socket.emit('error', `Invalid claim for ${pattern}. Please verify your numbers.`);
        }
    });

    // Host resets game
    socket.on('resetGame', () => {
        gameState.isActive = false;
        gameState.calledNumbers = [];
        gameState.availableNumbers = Array.from({length: 90}, (_, i) => i + 1);
        
        gameState.winners = {
            earlyFive: null,
            topLine: [],
            middleLine: [],
            bottomLine: [],
            corners: null,
            fullHouse: null
        };

        // Generate new tickets for all players
        Object.keys(gameState.players).forEach(playerId => {
            if (gameState.players[playerId]) {
                gameState.players[playerId].ticket = generateTicket();
                gameState.players[playerId].markedNumbers = [];
            }
        });

        io.emit('gameReset');

        // Send new tickets to all players
        Object.keys(gameState.players).forEach(playerId => {
            if (gameState.players[playerId]) {
                io.to(playerId).emit('ticketGenerated', gameState.players[playerId].ticket);
            }
        });

        console.log('Game reset');
    });

    // Handle player disconnection
    socket.on('disconnect', () => {
        if (gameState.players[socket.id]) {
            console.log(`${gameState.players[socket.id].name} disconnected`);
            delete gameState.players[socket.id];
            
            // Broadcast updated player list
            const playerList = Object.values(gameState.players).map(player => player.name);
            io.emit('playerList', playerList);
            io.emit('playerCount', Object.keys(gameState.players).length);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Tambola game server running on port ${PORT}`);
});