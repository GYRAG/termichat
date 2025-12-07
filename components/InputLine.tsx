import React, { useState, KeyboardEvent, useRef, useEffect } from 'react';

interface InputLineProps {
  userAlias: string;
  onSendMessage: (text: string) => void;
  disabled?: boolean;
}

const InputLine: React.FC<InputLineProps> = ({ userAlias, onSendMessage, disabled }) => {
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep focus on input
  useEffect(() => {
    const handleClick = () => inputRef.current?.focus();
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && inputValue.trim()) {
      onSendMessage(inputValue);
      setInputValue('');
    }
  };

  return (
    <div className="w-full bg-hacker-dark/90 p-4 border-t border-hacker-green/30 flex items-center shadow-[0_-5px_15px_rgba(0,255,0,0.1)]">
      <span className="text-hacker-green font-bold mr-2 whitespace-nowrap text-glow">
        {userAlias}@term:~${" "}
      </span>
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        className="flex-1 bg-transparent border-none outline-none text-gray-100 font-mono text-lg caret-hacker-green"
        autoFocus
        autoComplete="off"
        spellCheck={false}
      />
      <div className="w-2.5 h-5 bg-hacker-green animate-blink ml-1 opacity-75"></div>
    </div>
  );
};

export default InputLine;
