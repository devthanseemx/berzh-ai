export type ProviderId = "gemini" | "omniroute";

export interface Settings {
  provider: ProviderId;
  geminiKey: string;
  geminiModel: string;
  geminiFallbackModel: string;
  omniBaseUrl: string;
  omniKey: string;
  omniModel: string;
  omniFallbackModel: string;
}

export const DEFAULT_SETTINGS: Settings = {
  provider: "gemini",
  geminiKey: "",
  geminiModel: "gemini-3.5-flash-lite",
  geminiFallbackModel: "gemini-3.1-flash-lite",
  omniBaseUrl: "http://localhost:20128/v1",
  omniKey: "",
  omniModel: "",
  omniFallbackModel: "",
};