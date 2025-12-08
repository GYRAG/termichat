import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: process.env.CLIENT_URL || ["http://localhost:5173", "http://127.0.0.1:5173"],
        methods: ["GET", "POST"]
    }
});

// Production: Serve static files
import path from 'path';
import { fileURLToPath } from 'url';

if (process.env.NODE_ENV === 'production') {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const distPath = path.join(__dirname, '../dist');

    // Serve static assets
    app.use(express.static(distPath));

    // Handle SPA routing - return index.html for any unknown route
    // Express 5 requires specific syntax for wildcards, or regex.
    app.get(/(.*)/, (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
    });
}

interface User {
    id: string;
    alias: string;
    ip: string;
}

const users: Record<string, User> = {};
const messageHistory: any[] = [];
const MAX_HISTORY = 50;

const RATE_LIMIT_WINDOW = 1000; // 1 second
const MAX_MSGS_PER_WINDOW = 5;
const PENALTY_DURATION = 5000;
const MAX_MSG_LENGTH = 500;
const ADMIN_KEY = process.env.ADMIN_KEY || 'force_override';

const rateLimits: Record<string, { count: number, start: number, penaltyUntil: number }> = {};

function checkRateLimit(socketId: string): { allowed: boolean, error?: string } {
    const now = Date.now();
    const limit = rateLimits[socketId] || { count: 0, start: now, penaltyUntil: 0 };
    rateLimits[socketId] = limit;

    if (now < limit.penaltyUntil) {
        const remaining = Math.ceil((limit.penaltyUntil - now) / 1000);
        return { allowed: false, error: `Rate limit violation. Muted for ${remaining}s.` };
    }

    if (now - limit.start > RATE_LIMIT_WINDOW) {
        limit.count = 1;
        limit.start = now;
    } else {
        limit.count++;
    }

    if (limit.count > MAX_MSGS_PER_WINDOW) {
        limit.penaltyUntil = now + PENALTY_DURATION;
        return { allowed: false, error: `Rate limit exceeded. Muted for 5s.` };
    }

    return { allowed: true };
}

function addMessageToHistory(msg: any) {
    messageHistory.push(msg);
    if (messageHistory.length > MAX_HISTORY) {
        messageHistory.shift();
    }
}

io.on('connection', (socket: Socket) => {
    console.log(`Connection attempted: ${socket.id}`);

    socket.on('join', (alias: string) => {
        // Basic alias validation or collision check could go here
        const user: User = {
            id: socket.id,
            alias: alias || `User_${socket.id.substring(0, 4)}`,
            ip: socket.handshake.address // In local dev this might be ::1
        };

        users[socket.id] = user;
        console.log(`User joined: ${user.alias} (${user.id})`);

        // Send existing history to the new user
        socket.emit('history', messageHistory);

        // Broadcast to others
        const joinMsg = {
            id: crypto.randomUUID(),
            type: 'system',
            sender: 'SYSTEM',
            content: `User ${user.alias} has joined the secure channel.`,
            timestamp: Date.now()
        };
        socket.broadcast.emit('message', joinMsg);

        // Add join message to history
        addMessageToHistory(joinMsg);

        // Confirm to user
        socket.emit('joined', user);
    });

    socket.on('message', (message: any) => {
        const user = users[socket.id];
        if (!user) return;

        const limitCheck = checkRateLimit(socket.id);
        if (!limitCheck.allowed) {
            // Only emit error if not already spamming hard (optional, but good UX)
            socket.emit('message', {
                id: crypto.randomUUID(),
                type: 'error',
                sender: 'SYSTEM',
                content: limitCheck.error || 'Rate limit exceeded.',
                timestamp: Date.now()
            });
            return;
        }

        // Validate payload size
        const safeContent = String(message.content || '').substring(0, MAX_MSG_LENGTH);
        if (!safeContent) return;

        // SANITIZATION: Construct trusted message object
        const broadcastMsg = {
            id: crypto.randomUUID(),
            type: 'peer', // Force type to Peer/User
            sender: user.alias, // Force sender to be the trusted user alias
            content: safeContent,
            encrypted: Boolean(message.encrypted),
            timestamp: Date.now()
        };

        addMessageToHistory(broadcastMsg);
        socket.broadcast.emit('message', broadcastMsg);
    });

    // Custom Commands handled by server
    socket.on('cmd_scan', () => {
        if (!checkRateLimit(socket.id).allowed) return;
        const userList = Object.values(users).map(u => ({ alias: u.alias, ip: 'MASKED' }));
        socket.emit('scan_result', userList);
    });

    socket.on('cmd_nuke', (key: string) => {
        // Simple auth check
        if (key !== ADMIN_KEY) {
            socket.emit('message', {
                id: crypto.randomUUID(),
                type: 'error',
                sender: 'SYSTEM',
                content: 'ACCESS DENIED. Admin authorization required.',
                timestamp: Date.now()
            });
            return;
        }

        messageHistory.length = 0;
        io.emit('nuke_event');
        io.emit('message', {
            id: crypto.randomUUID(),
            type: 'system',
            sender: 'SYSTEM',
            content: '*** CHANNEL SANITIZED BY ADMIN ***',
            timestamp: Date.now()
        });
    });

    socket.on('cmd_dm', ({ target, content, encrypted }: { target: string, content: string, encrypted: boolean }) => {
        if (!checkRateLimit(socket.id).allowed) return;
        const sender = users[socket.id];
        if (!sender) return;

        const safeContent = String(content || '').substring(0, MAX_MSG_LENGTH);

        const targetSocketId = Object.keys(users).find(id => users[id].alias === target);

        if (targetSocketId) {
            const dmMsg = {
                id: crypto.randomUUID(),
                type: 'peer',
                sender: `${sender.alias} [PRIVATE]`,
                content: safeContent,
                timestamp: Date.now(),
                encrypted: Boolean(encrypted)
            };
            io.to(targetSocketId).emit('message', dmMsg);
            socket.emit('message', { ...dmMsg, sender: `To: ${target}` });
        } else {
            socket.emit('message', {
                id: crypto.randomUUID(),
                type: 'error',
                sender: 'SYSTEM',
                content: `Target '${target}' not found.`,
                timestamp: Date.now()
            });
        }
    });

    socket.on('disconnect', () => {
        const user = users[socket.id];
        if (user) {
            console.log(`User left: ${user.alias}`);
            const leaveMsg = {
                id: crypto.randomUUID(),
                type: 'system',
                sender: 'SYSTEM',
                content: `Connection lost: ${user.alias}`,
                timestamp: Date.now()
            };
            io.emit('message', leaveMsg);
            addMessageToHistory(leaveMsg);

            delete users[socket.id];
        }
    });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
    console.log(`Secure Uplink established on port ${PORT}`);
});
