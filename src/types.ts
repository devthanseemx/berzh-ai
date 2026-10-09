export type Source = "documents" | "web" | "general";

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


export interface Ref {
  title: string;
  url: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  source?: Source;
  error?: boolean;
  ms?: number;
  live?: boolean;
  status?: string; // e.g. "Searching the web..."
  refs?: Ref[]; // web sources used
}

export interface Preview {
  predicted: string;
  answer: string;
  done: boolean;
  error: boolean;
  stale: boolean;
  docs: boolean; // the draft is using uploaded documents
  web: boolean; // this question needs a web search (done on Enter)
}