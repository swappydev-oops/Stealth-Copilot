
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: Date;
}

export interface Suggestion {
  id: string;
  title: string;
  content: string;
  type: 'answer' | 'tip' | 'fact' | 'follow-up';
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
