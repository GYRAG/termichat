export enum MessageType {
  USER = 'USER',
  SYSTEM = 'SYSTEM',
  PEER = 'PEER',
  ERROR = 'ERROR',
  INFO = 'INFO'
}

export interface Message {
  id: string;
  type: MessageType;
  sender: string;
  content: string;
  timestamp: number;
  encrypted?: boolean;
}

export interface User {
  alias: string;
  ip: string;
  connectedAt: number;
}

export interface Command {
  command: string;
  description: string;
  action: (args: string[]) => void;
}
