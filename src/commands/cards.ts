/**
 * Papyrus CLI - Card Management Commands
 */

import { readFileSync } from "fs";
import {
  createCard,
  deleteCard,
  getCard,
  importCards,
  listCards,
  searchCards,
  updateCard,
} from "../api.js";
import type { Card } from "../types.js";
import { formatRelativeTime, parseTags, truncate } from "../utils.js";

/**
 * Display card in formatted output
 */
function displayCard(card: Card, detailed = false): void {
  console.log(`\n  ID: ${card.id}`);
  console.log(`  Q: ${card.q}`);
  console.log(`  A: ${card.a}`);

  if (card.tags && card.tags.length > 0) {
    console.log(`  Tags: ${card.tags.join(", ")}`);
  }

  if (detailed) {
    console.log(`  Next Review: ${formatRelativeTime(card.next_review)}`);
    console.log(`  Interval: ${Math.round((card.interval || 0) / 86400)} days`);
    console.log(`  EF: ${(card.ef || 2.5).toFixed(2)}`);
    console.log(`  Repetitions: ${card.repetitions || 0}`);
  }
}

/**
 * List all cards command
 */
export async function listCardsCommand(options: {
  limit?: number;
  tags?: string;
  detailed?: boolean;
}): Promise<void> {
  const cards = await listCards();

  if (cards.length === 0) {
    console.log("No cards found.");
    return;
  }

  // Filter by tags if specified
  let filtered = cards;
  if (options.tags) {
    const tags = parseTags(options.tags);
    filtered = cards.filter((c) => tags.some((t) => c.tags?.includes(t)));
  }

  // Limit if specified
  const limit = options.limit ?? filtered.length;
  const display = filtered.slice(0, limit);

  console.log(`\nFound ${filtered.length} cards (showing ${display.length}):\n`);

  for (const card of display) {
    console.log(`  [${card.id}] ${truncate(card.q, 50)}`);
    if (options.detailed) {
      console.log(`      A: ${truncate(card.a, 50)}`);
      if (card.tags?.length) {
        console.log(`      Tags: ${card.tags.join(", ")}`);
      }
      console.log(`      Next: ${formatRelativeTime(card.next_review)}`);
    }
  }

  if (filtered.length > limit) {
    console.log(`\n  ... and ${filtered.length - limit} more`);
  }
}

/**
 * Show card details command
 */
export async function showCardCommand(id: string): Promise<void> {
  try {
    const card = await getCard(id);
    console.log("\n📄 Card Details");
    displayCard(card, true);
  } catch {
    // Try searching if exact ID fails
    const results = await searchCards(id);
    if (results.count > 0) {
      console.log(`\nFound ${results.count} matching card(s):`);
      for (const result of results.results.slice(0, 5)) {
        displayCard(result.card, true);
      }
    } else {
      console.error(`Card not found: ${id}`);
      process.exit(1);
    }
  }
}

/**
 * Add card command
 */
export async function addCardCommand(
  question: string,
  answer: string,
  options: { tags?: string }
): Promise<void> {
  const tags = parseTags(options.tags);

  const card = await createCard({
    q: question,
    a: answer,
    tags,
  });

  console.log("\n✅ Card created successfully!");
  displayCard(card, true);
}

/**
 * Edit card command
 */
export async function editCardCommand(
  id: string,
  options: {
    question?: string;
    answer?: string;
    tags?: string;
  }
): Promise<void> {
  const update: { q?: string; a?: string; tags?: string[] } = {};

  if (options.question) {
    update.q = options.question;
  }
  if (options.answer) {
    update.a = options.answer;
  }
  if (options.tags !== undefined) {
    update.tags = parseTags(options.tags);
  }

  const card = await updateCard(id, update);

  console.log("\n✅ Card updated successfully!");
  displayCard(card, true);
}

/**
 * Delete card command
 */
export async function deleteCardCommand(id: string, force = false): Promise<void> {
  const card = await getCard(id);

  if (!force) {
    const { confirm } = await import("../utils.js");
    const confirmed = await confirm(`Delete card "${truncate(card.q, 40)}"?`);
    if (!confirmed) {
      console.log("Cancelled.");
      return;
    }
  }

  await deleteCard(id);
  console.log("\n✅ Card deleted successfully!");
}

/**
 * Search cards command
 */
export async function searchCardsCommand(query: string): Promise<void> {
  const results = await searchCards(query);

  if (results.count === 0) {
    console.log("No cards found matching your query.");
    return;
  }

  console.log(`\nFound ${results.count} matching card(s):\n`);

  for (const result of results.results) {
    displayCard(result.card);
  }
}

/**
 * Import cards from file command
 */
export async function importCardsCommand(filePath: string): Promise<void> {
  const { isReadableFile } = await import("../utils.js");

  if (!isReadableFile(filePath)) {
    console.error(`File not found or not readable: ${filePath}`);
    process.exit(1);
  }

  const content = readFileSync(filePath, "utf-8");
  const count = await importCards(content);

  console.log(`\n✅ Successfully imported ${count} card(s)!`);
}

/**
 * Export cards command
 */
export async function exportCardsCommand(options: { output?: string }): Promise<void> {
  const cards = await listCards();

  const output = {
    cards,
    exported_at: new Date().toISOString(),
    count: cards.length,
  };

  const json = JSON.stringify(output, null, 2);

  if (options.output) {
    const { writeFileSync } = await import("fs");
    writeFileSync(options.output, json, "utf-8");
    console.log(`\n✅ Exported ${cards.length} cards to ${options.output}`);
  } else {
    console.log(json);
  }
}

/**
 * Get due cards command
 */
export async function dueCardsCommand(): Promise<void> {
  const cards = await listCards();
  const now = Date.now() / 1000;
  const dueCards = cards.filter((c) => c.next_review <= now);

  if (dueCards.length === 0) {
    console.log("\n🎉 No cards are due for review!");
    return;
  }

  console.log(`\n📚 ${dueCards.length} card(s) due for review:\n`);

  for (const card of dueCards) {
    console.log(`  [${card.id}] ${truncate(card.q, 50)}`);
    console.log(`      Due: ${formatRelativeTime(card.next_review)}`);
  }
}
