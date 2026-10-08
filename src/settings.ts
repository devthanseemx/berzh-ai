export interface Settings {
  omniBaseUrl: string;
  omniKey: string;
  omniModel: string; // answer model (can be a reasoning model)
  omniFallbackModel: string;
  liveDraft: boolean;
  liveModel: string; // fast model for the live preview ("" = same as answer model)
  liveFallbackModel: string;
  humanTone: boolean; // answer like a real person
  answerAsMe: boolean; // answer in the first person as the user
  aboutMe: string;
  instructions: string;
}

export const DEFAULT_SETTINGS: Settings = {
  omniBaseUrl: "http://localhost:20128/v1",
  omniKey: "",
  omniModel: "",
  omniFallbackModel: "",
  liveDraft: true,
  liveModel: "",
  liveFallbackModel: "",
  humanTone: false,
  answerAsMe: false,
  aboutMe: "",
  instructions: "",
};