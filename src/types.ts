export type Source = "documents" | "web" | "general";

export interface Doc {
  id: string;
  name: string;
  path: string;
  /** removed from the input box but kept as a source for this chat */
  archived?: boolean;
}

export interface Session {
  id: string;
  title: string;
  pinned?: boolean;
  messages: Message[];
  docs: Doc[];
}


export interface Ref {
  title: string;
  url: string; // "" for document sources
  kind?: "web" | "doc"; // default "web"
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
  web: boolean; // a web search for this question is running right now
  /** the automatic web search failed: key missing/invalid or limit reached */
  webFailed?: boolean;
}