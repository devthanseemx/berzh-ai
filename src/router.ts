import type { DocHit } from "./rag";

export type Route = "docs" | "web" | "general";

const EXPLICIT =
  /\b(search (the )?(web|internet|online)|search for|google|look ?up|find (it |this )?online|on the (web|internet)|web search|browse the web)\b/i;

// clearly time-sensitive
const STRONG: RegExp[] = [
  /\b(today|tonight|tomorrow|yesterday|right now|breaking|news)\b/i,
  /\b(price|prices|exchange rate|stock|stocks|share price|crypto|bitcoin|btc|ethereum|gold|silver|forex)\b/i,
  /\b(weather|forecast|temperature|score|scores|standings|fixtures?)\b/i,
  /\bwho is the (current |new )?(president|prime minister|ceo|leader|governor)\b/i,
  /\b(release date|came out)\b/i,
  /\b(202[5-9]|20[3-9]\d)\b/,
];

// could be time-sensitive, but also common in personal questions
const WEAK: RegExp[] = [
  /\b(currently|at the moment|latest|recent(ly)?|newest|this (week|month|year))\b/i,
];

export function decideRoute(
  text: string,
  hit: DocHit | null,
  webAvailable: boolean,
  asMe: boolean
): Route {
  if (webAvailable && EXPLICIT.test(text)) return "web";
  if (hit?.relevant) return "docs";
  if (
    webAvailable &&
    (STRONG.some((r) => r.test(text)) || (!asMe && WEAK.some((r) => r.test(text))))
  ) {
    return "web";
  }
  return "general";
}