export interface Settings {
  llmProvider: "omni" | "gemini"; // who writes the answers: OmniRoute (local) or the Gemini API
  geminiKey: string;
  geminiModel: string; // answer model (free-tier Gemini model)
  geminiLiveModel: string; // fast model for the live preview ("" = same as answer model)
  omniBaseUrl: string;
  omniKey: string;
  omniModel: string; // answer model (can be a reasoning model)
  omniFallbackModel: string;
  liveDraft: boolean;
  liveModel: string; // fast model for the live preview ("" = same as answer model)
  liveFallbackModel: string;
  humanTone: boolean;
  answerAsMe: boolean;
  interviewCoach: boolean;
  webSearch: boolean;
  tavilyKey: string;
  tavilyTopic: "general" | "news" | "finance";
  aboutMe: string;
  instructions: string;
  deepgramKey: string;
  deepgramManagementKey: string;
  deepgramProjectId: string;
  voiceLang: string; // "en" or "multi"
  omniAutoStart: boolean;
  omniCommand: string;
  theme: "light" | "dark";
}

export const DEFAULT_SETTINGS: Settings = {
  llmProvider: "omni",
  geminiKey: "",
  geminiModel: "gemini-3.8-flash",
  geminiLiveModel: "gemini-3.5-flash-lite",
  omniBaseUrl: "http://localhost:20128/v1",
  omniKey: "",
  omniModel: "",
  omniFallbackModel: "",
  liveDraft: true,
  liveModel: "",
  liveFallbackModel: "",
  humanTone: false,
  answerAsMe: false,
  interviewCoach: false,
  webSearch: true,
  tavilyKey: "",
  tavilyTopic: "general",
  aboutMe: "",
  instructions: "",
  deepgramKey: "",
  deepgramManagementKey: "",
  deepgramProjectId: "",
  voiceLang: "en",
  omniAutoStart: true,
  omniCommand: "omniroute --no-open",
  theme: "light",
};