export type Source = "documents" | "web" | "general";

export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  source?: Source;
}

export interface Session {
  id: string;
  title: string;
  messages: Message[];
}

export interface Doc {
  id: string;
  name: string;
  path: string;
}

export interface Session {
  id: string;
  title: string;
  messages: Message[];
  docs: Doc[];
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  source?: Source;
  error?: boolean;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  source?: Source;
  error?: boolean;
  ms?: number;
  live?: boolean;
}

export interface Preview {
  predicted: string;
  answer: string;
  done: boolean;
  error: boolean;
  stale: boolean; // user kept typing, so a newer draft is coming
}