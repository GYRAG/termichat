import React, { useEffect, useRef } from 'react';
import { Message, MessageType } from '../types';

interface TerminalOutputProps {
  messages: Message[];
}

const TerminalOutput: React.FC<TerminalOutputProps> = ({ messages }) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const renderMessageContent = (msg: Message) => {
    if (msg.encrypted) {
      return (
        <span className="text-gray-400 flex items-center gap-2">
          <span className="text-xs border border-gray-600 px-1 rounded text-hacker-green/70">AES-256</span>
          <span className="font-mono text-hacker-green/50">{msg.content}</span>
          <span className="text-[10px] text-gray-600 animate-pulse">🔒</span>
        </span>
      );
    }
    
    // Highlight mentions or specific keywords
    const parts = msg.content.split(' ');
    return parts.map((part, index) => {
      if (part.startsWith('http')) {
        return <a key={index} href={part} target="_blank" rel="noopener noreferrer" className="underline text-blue-400 hover:text-blue-300">{part} </a>;
      }
      return <span key={index}>{part} </span>;
    });
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-sm md:text-base scrollbar-hide">
      {messages.map((msg) => (
        <div 
          key={msg.id} 
          className={`flex flex-col md:flex-row break-words p-1 rounded ${
            msg.type === MessageType.SYSTEM ? 'opacity-75' : 'opacity-100'
          } ${
            msg.type === MessageType.ERROR ? 'bg-red-900/10' : ''
          }`}
        >
          <div className="mr-3 min-w-[140px] shrink-0">
            <span className="text-xs text-gray-500 mr-2">
              {new Date(msg.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
            {msg.type === MessageType.USER && (
              <span className="text-hacker-green font-bold text-glow">&lt;{msg.sender}&gt;</span>
            )}
            {msg.type === MessageType.PEER && (
              <span className="text-cyan-400 font-bold">&lt;{msg.sender}&gt;</span>
            )}
            {msg.type === MessageType.SYSTEM && (
              <span className="text-hacker-amber font-bold text-glow-amber">[{msg.sender}]</span>
            )}
            {msg.type === MessageType.ERROR && (
              <span className="text-red-500 font-bold text-glow-red animate-flicker-red">[{msg.sender}]</span>
            )}
             {msg.type === MessageType.INFO && (
              <span className="text-blue-400 font-bold">[{msg.sender}]</span>
            )}
          </div>
          <div className={`flex-1 ${msg.type === MessageType.SYSTEM ? 'italic text-hacker-amber' : 'text-gray-100'} ${msg.type === MessageType.ERROR ? 'animate-flicker-red text-red-400' : ''}`}>
            {renderMessageContent(msg)}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
};

export default TerminalOutput;