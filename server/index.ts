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

        // Broadcast to others
        socket.broadcast.emit('message', {
            id: crypto.randomUUID(),
            type: 'system',
            sender: 'SYSTEM',
            content: `User ${user.alias} has joined the secure channel.`,
            timestamp: Date.now()
        });

        // Confirm to user
        socket.emit('joined', user);
    });

    socket.on('message', (message: any) => {
        const user = users[socket.id];
        if (!user) return; // Ignore if not joined

        // Broadcast the message to everyone (including sender, or exclude sender if handled optimistic UI)
        // Usually convenient to broadcast to everyone for sync, or broadcast to others and let sender handle own.
        // App.tsx logic adds its own message locally, so we broadcast to others.
        // wait, if we want strict ordering, we should emit to all. 
        // But the current UI adds immediately. Let's broadcast to list exclude sender.

        const broadcastMsg = {
            ...message,
            timestamp: Date.now(), // Server-side timestamp authority
            sender: user.alias // Ensure sender is trusted alias
        };

        socket.broadcast.emit('message', broadcastMsg);
    });

    socket.on('disconnect', () => {
        const user = users[socket.id];
        if (user) {
            console.log(`User left: ${user.alias}`);
            io.emit('message', {
                id: crypto.randomUUID(),
                type: 'system',
                sender: 'SYSTEM',
                content: `Connection lost: ${user.alias}`,
                timestamp: Date.now()
            });
            delete users[socket.id];
        }
    });
});

const PORT = 3001;
httpServer.listen(PORT, () => {
    console.log(`Secure Uplink established on port ${PORT}`);
});
