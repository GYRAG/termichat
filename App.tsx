import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Message, MessageType, User } from './types';
import { INITIAL_BOOT_SEQUENCE_CONTENT } from './constants';
import { socketService } from './services/socketService';
import TerminalOutput from './components/TerminalOutput';
import InputLine from './components/InputLine';

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [isBooting, setIsBooting] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isEncryptedMode, setIsEncryptedMode] = useState(false);

  // Audio Context Ref
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Initialize Ambient Noise
  const initAudio = useCallback(() => {
    if (audioCtxRef.current) return;

    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;

      // Create Brown Noise buffer (simulates low server hum)
      const bufferSize = ctx.sampleRate * 2; // 2 seconds
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);

      let lastOut = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        data[i] = (lastOut + (0.02 * white)) / 1.02;
        lastOut = data[i];
        data[i] *= 3.5;
      }

      const noiseSource = ctx.createBufferSource();
      noiseSource.buffer = buffer;
      noiseSource.loop = true;

      // Lowpass filter to muffle it - Increased frequency for better audibility
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 600; // Auditable drone

      // Increased gain slightly
      const gainNode = ctx.createGain();
      gainNode.gain.value = 0.12;

      noiseSource.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(ctx.destination);

      noiseSource.start();
    } catch (e) {
      console.error("Audio init failed", e);
    }
  }, []);

  const playChirp = useCallback(() => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'suspended') return;
    const ctx = audioCtxRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.1);

    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  }, []);

  const playKeystroke = useCallback(() => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'suspended') return;
    const ctx = audioCtxRef.current;

    // Simple noise burst for keypress
    const bufferSize = ctx.sampleRate * 0.05; // 50ms
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 0.05;

    // random pitch
    noise.playbackRate.value = 0.8 + Math.random() * 0.4;

    noise.connect(gain);
    gain.connect(ctx.destination);
    noise.start();
  }, []);

  const scrambleText = useCallback((text: string) => {
    const chars = '0123456789!@#$%^&*()_+-=[]{}|;:,.<>?/~';
    // Deterministic scramble based on length to limit flickering speed if re-rendered
    // But we want cool flickering, so random is fine
    return text.split('').map(c => {
      if (c === ' ') return ' ';
      return Math.random() > 0.5 ? chars[Math.floor(Math.random() * chars.length)] : c;
    }).join('');
  }, []);

  const bootRef = useRef(false);

  // Boot sequence effect
  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;

    let delay = 0;
    INITIAL_BOOT_SEQUENCE_CONTENT.forEach((item, index) => {
      delay += 800; // sequential delay
      setTimeout(() => {
        const msg: Message = {
          id: crypto.randomUUID(), // Unique ID every time
          type: item.type,
          sender: item.sender,
          content: item.content,
          timestamp: Date.now()
        };
        setMessages(prev => [...prev, msg]);
        if (index === INITIAL_BOOT_SEQUENCE_CONTENT.length - 1) {
          setIsBooting(false);
          // socketService.preWarm(); 
        }
      }, delay);
    });

    // Interaction listener for audio start
    const handleInteraction = () => {
      initAudio();
      // Force resume if suspended (common browser policy)
      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
      }
      window.removeEventListener('click', handleInteraction);
      window.removeEventListener('keydown', handleInteraction);
    };

    window.addEventListener('click', handleInteraction);
    window.addEventListener('keydown', handleInteraction);

    return () => {
      window.removeEventListener('click', handleInteraction);
      window.removeEventListener('keydown', handleInteraction);
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
      }
    };
  }, [initAudio]);

  const addSystemMessage = (text: string, type: MessageType = MessageType.SYSTEM, sender: string = 'SYSTEM') => {
    const newMsg: Message = {
      id: crypto.randomUUID(),
      type,
      sender,
      content: text,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, newMsg]);
  };

  const handleCommand = (cmd: string, args: string[]) => {
    switch (cmd) {
      case 'help':
        addSystemMessage('AVAILABLE COMMANDS:', MessageType.INFO);
        addSystemMessage('  /help            - Show this menu', MessageType.INFO);
        addSystemMessage('  /clear           - Clear terminal buffer', MessageType.INFO);
        addSystemMessage('  /whoami          - Display session identity', MessageType.INFO);
        addSystemMessage('  /connect <ip>    - Simulate connection to remote host', MessageType.INFO);
        addSystemMessage('  /encrypt         - Toggle outgoing message encryption', MessageType.INFO);
        break;
      case 'clear':
        setMessages([]);
        addSystemMessage('Buffer cleared.', MessageType.INFO);
        break;
      case 'whoami':
        if (user) {
          addSystemMessage(`User: ${user.alias}`, MessageType.INFO);
          addSystemMessage(`IP: ${user.ip} (MASKED via VPN)`, MessageType.INFO);
          addSystemMessage(`Session Active: ${((Date.now() - user.connectedAt) / 1000).toFixed(0)}s`, MessageType.INFO);
          addSystemMessage(`Encryption Mode: ${isEncryptedMode ? 'ENABLED' : 'DISABLED'}`, MessageType.INFO);
        } else {
          addSystemMessage('Unknown entity.', MessageType.ERROR);
        }
        break;
      case 'connect':
        const ip = args[0] || '127.0.0.1';
        addSystemMessage(`Initiating handshake with ${ip}...`, MessageType.INFO);
        setTimeout(() => {
          addSystemMessage(`Connection timed out. Target is ghosted.`, MessageType.ERROR, 'NET_ERR');
        }, 1500);
        break;
      case 'encrypt':
        const newState = !isEncryptedMode;
        setIsEncryptedMode(newState);
        if (newState) {
          addSystemMessage('Encryption protocols ENGAGED. outgoing traffic secured.', MessageType.INFO);
        } else {
          addSystemMessage('Encryption protocols DISABLED. Traffic is plain-text.', MessageType.SYSTEM);
        }
        break;
      case 'scan':
        addSystemMessage('Initiating network scan...', MessageType.INFO);
        socketService.sendCommand('cmd_scan');
        break;
      case 'nuke':
        addSystemMessage('WARNING: INITIATING GLOBAL PURGE...', MessageType.ERROR);
        setTimeout(() => {
          socketService.sendCommand('cmd_nuke');
        }, 1000);
        break;
      case 'dm':
        if (args.length < 2) {
          addSystemMessage('Usage: /dm <target_alias> <message>', MessageType.ERROR);
          return;
        }
        const target = args[0];
        const content = args.slice(1).join(' ');
        socketService.sendCommand('cmd_dm', { target, content, encrypted: isEncryptedMode });
        break;
      default:
        addSystemMessage(`Command not recognized: ${cmd}`, MessageType.ERROR);
    }
  };

  // Initialize Socket on Login
  useEffect(() => {
    if (user) {
      // Callback for processing incoming messages
      const onIncomingMessage = (msg: Message) => {
        setMessages(prev => [...prev, msg]);
        playChirp();
      };

      const onHistory = (historyMsgs: Message[]) => {
        // Prepend history, avoiding duplicates if any
        // We just blindly add them for now assuming history creates base state
        setMessages(prev => {
          // Filter out duplicates based on ID
          const existingIds = new Set(prev.map(m => m.id));
          const newHistory = historyMsgs.filter(m => !existingIds.has(m.id));
          const sorted = [...newHistory, ...prev].sort((a, b) => a.timestamp - b.timestamp);
          return sorted;
        });
      };

      socketService.connect(user.alias, onIncomingMessage, onHistory);

      // Listen for custom command results
      socketService.on('scan_result', (usersList: any[]) => {
        addSystemMessage('Scanning network nodes...', MessageType.INFO);
        setTimeout(() => {
          usersList.forEach(u => {
            addSystemMessage(`[DETECTED] ${u.alias} :: IP [MASKED]`, MessageType.INFO);
          });
          addSystemMessage(`Scan Complete. ${usersList.length} nodes active.`, MessageType.SYSTEM);
        }, 800);
      });

      socketService.on('nuke_event', () => {
        setMessages([]);
        addSystemMessage('*** WARNING: SYSTEM PURGE DETECTED ***', MessageType.ERROR);
      });

    }
    return () => {
      // Cleanup listeners if needed
      socketService.off('scan_result');
      socketService.off('nuke_event');
    };
  }, [user, playChirp]);

  const handleSendMessage = useCallback(async (text: string) => {
    if (!text.trim()) return;

    // Handle Login if not logged in
    if (!user) {
      if (text.length > 15) {
        addSystemMessage('Alias too long. Max 15 chars.', MessageType.ERROR);
        return;
      }
      setUser({
        alias: text.replace(/\s/g, '_'), // Enforce no spaces
        ip: '192.168.0.x',
        connectedAt: Date.now(),
      });
      // Try to start audio on login if not already started
      if (!audioCtxRef.current) {
        initAudio();
      } else if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
      }

      addSystemMessage(`Identity confirmed. Welcome, ${text}.`, MessageType.INFO);
      addSystemMessage('You are now connected to the secure channel.', MessageType.SYSTEM);
      return;
    }

    // Handle Commands
    if (text.startsWith('/')) {
      const parts = text.slice(1).split(' ');
      const cmd = parts[0].toLowerCase();
      const args = parts.slice(1);
      handleCommand(cmd, args);
      return;
    }

    // Handle Chat Message
    const userMsg: Message = {
      id: crypto.randomUUID(),
      type: MessageType.USER,
      sender: user.alias,
      content: text,
      timestamp: Date.now(),
      encrypted: isEncryptedMode
    };
    setMessages(prev => [...prev, userMsg]);
    playKeystroke();

    // Send via Socket
    socketService.sendMessage(text, isEncryptedMode);

  }, [user, isEncryptedMode, initAudio, playKeystroke]);

  return (
    <div className="relative w-full h-screen bg-black text-green-500 overflow-hidden flex flex-col font-mono selection:bg-green-900 selection:text-white">

      {/* Background & Effects */}
      <div className="absolute inset-0 z-0 opacity-10 pointer-events-none">
        {/* Static noise could go here */}
      </div>

      {/* CRT Overlay Effect */}
      <div className="absolute inset-0 z-50 pointer-events-none crt-overlay"></div>
      <div className="absolute inset-0 z-50 pointer-events-none bg-gradient-to-b from-transparent via-[rgba(0,255,0,0.02)] to-[rgba(0,255,0,0.05)] animate-flicker"></div>

      {/* Main Container */}
      <div className="relative z-10 flex flex-col h-full w-full border-green-900/30 shadow-[0_0_50px_rgba(0,50,0,0.3)]">

        {/* Header */}
        <header className="flex items-center justify-between p-3 border-b border-green-800/50 bg-black/80 backdrop-blur">
          <div className="flex items-center space-x-2">
            <div className={`w-3 h-3 rounded-full ${isProcessing ? 'bg-amber-500 animate-ping' : 'bg-green-500'}`}></div>
            <h1 className="text-xl font-bold tracking-widest text-glow">0xTERMINAL</h1>
          </div>
          <div className="text-xs text-gray-400">
            STATUS: <span className={user ? 'text-green-400' : 'text-amber-500'}>{user ? 'CONNECTED' : 'WAITING FOR AUTH'}</span>
          </div>
        </header>

        {/* Terminal Output */}
        <TerminalOutput messages={messages.map(m => {
          // Apply visual encryption
          const shouldScramble = m.encrypted && !isEncryptedMode;
          return {
            ...m,
            content: shouldScramble ? scrambleText(m.content) : m.content
          };
        })} />

        {/* Interaction Area */}
        <div className="p-0">
          {!user && !isBooting && (
            <div className="px-4 py-2 text-hacker-amber animate-pulse">
              &gt; PLEASE ENTER YOUR ALIAS TO JOIN SECURE CHANNEL...
            </div>
          )}
          <InputLine
            userAlias={user ? user.alias : 'guest'}
            onSendMessage={handleSendMessage}
            disabled={isBooting}
          />
        </div>

      </div>
    </div>
  );
};

export default App;