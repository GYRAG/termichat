import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
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
        if (!user) return; // Ignore if not joined

        const broadcastMsg = {
            ...message,
            timestamp: Date.now(), // Server-side timestamp authority
            sender: user.alias // Ensure sender is trusted alias
        };

        // Add to history
        addMessageToHistory(broadcastMsg);

        socket.broadcast.emit('message', broadcastMsg);
    });

    // Custom Commands handled by server
    socket.on('cmd_scan', () => {
        const userList = Object.values(users).map(u => ({ alias: u.alias, ip: 'MASKED' }));
        socket.emit('scan_result', userList);
    });

    socket.on('cmd_nuke', () => {
        messageHistory.length = 0; // Clear history
        io.emit('nuke_event'); // Tell everyone to clear
        io.emit('message', {
            id: crypto.randomUUID(),
            type: 'system',
            sender: 'SYSTEM',
            content: '*** CHANNEL SANITIZATION COMPLETE ***',
            timestamp: Date.now()
        });
    });

    socket.on('cmd_dm', ({ target, content, encrypted }: { target: string, content: string, encrypted: boolean }) => {
        const sender = users[socket.id];
        if (!sender) return;

        // Find target socket
        const targetSocketId = Object.keys(users).find(id => users[id].alias === target);

        if (targetSocketId) {
            const dmMsg = {
                id: crypto.randomUUID(),
                type: 'peer', // or 'dm' if we add to types
                sender: `${sender.alias} [PRIVATE]`,
                content,
                timestamp: Date.now(),
                encrypted
            };
            io.to(targetSocketId).emit('message', dmMsg);
            socket.emit('message', { ...dmMsg, sender: `To: ${target}` }); // Echo to sender
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
