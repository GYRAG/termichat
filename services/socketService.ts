/// <reference types="vite/client" />
import { io, Socket } from "socket.io-client";
import { Message, MessageType } from "../types";

// In production, we connect to the same origin. In dev, we might need localhost:3001.
// If served from the same backend, we can just use undefined or window.location.origin
// However, Vite proxy or hardcoded dev URL is safer for decoupled dev.
const SERVER_URL = import.meta.env.PROD
    ? undefined // Socket.io will default to window.location
    : "http://localhost:3001";

class SocketService {
    public socket: Socket | null = null;
    private messageHandler: ((msg: Message) => void) | null = null;

    public connect(alias: string, onMessage: (msg: Message) => void) {
        if (this.socket) return;

        this.socket = io(SERVER_URL);
        this.messageHandler = onMessage;

        this.socket.on("connect", () => {
            console.log("Connected to Uplink");
            this.socket?.emit("join", alias);
        });

        this.socket.on("message", (rawMsg: any) => {
            // Map server message format to app Message type if needed
            // Currently server sends mostly compatible format
            const msg: Message = {
                id: rawMsg.id || crypto.randomUUID(),
                type: rawMsg.type === 'system' ? MessageType.SYSTEM : MessageType.PEER,
                sender: rawMsg.sender || 'Unknown',
                content: rawMsg.content,
                timestamp: rawMsg.timestamp || Date.now(),
                encrypted: rawMsg.encrypted || false
            };

            if (this.messageHandler) {
                this.messageHandler(msg);
            }
        });

        this.socket.on("connect_error", (err) => {
            console.error("Connection failed", err);
            if (this.messageHandler) {
                this.messageHandler({
                    id: crypto.randomUUID(),
                    type: MessageType.ERROR,
                    sender: 'SYSTEM',
                    content: 'Uplink connection failed. Server offline?',
                    timestamp: Date.now()
                });
            }
        });
    }

    public sendMessage(content: string, encrypted: boolean = false) {
        if (!this.socket) return;
        this.socket.emit("message", {
            content,
            encrypted,
            type: 'user' // generic type for server to broadcast
        });
    }

    public disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
    }
}

export const socketService = new SocketService();
