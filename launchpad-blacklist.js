/**
 * Launchpad blacklist — launchpad platforms to avoid.
 * Tokens launched from a blacklisted launchpad will be skipped during screening.
 * Launchpad names are matched case-insensitively against the `launchpad` field
 * returned by getTokenInfo().
 */

import fs from "fs";
import { log } from "./logger.js";

const BLACKLIST_FILE = "./launchpad-blacklist.json";

function load() {
  if (!fs.existsSync(BLACKLIST_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(BLACKLIST_FILE, "utf8"));
  } catch {
    return {};
  }
}

function save(data) {
  fs.writeFileSync(BLACKLIST_FILE, JSON.stringify(data, null, 2));
}

/**
 * Check if a launchpad name is blacklisted (case-insensitive).
 */
export function isLaunchpadBlacklisted(launchpadName) {
  if (!launchpadName) return false;
  const db = load();
  const lower = launchpadName.toLowerCase();
  return Object.keys(db).some((k) => k.toLowerCase() === lower);
}

export function addLaunchpad({ name, reason }) {
  if (!name) return { error: "launchpad name required" };
  const db = load();
  const key = name.toLowerCase();
  if (db[key]) {
    return { already_blacklisted: true, name: db[key].name, reason: db[key].reason };
  }
  db[key] = {
    name,
    reason: reason || "no reason provided",
    added_at: new Date().toISOString(),
  };
  save(db);
  log("launchpad_blacklist", `Blacklisted launchpad: ${name} — ${reason}`);
  return { blacklisted: true, name, reason };
}

export function removeLaunchpad({ name }) {
  if (!name) return { error: "launchpad name required" };
  const db = load();
  const key = name.toLowerCase();
  if (!db[key]) return { error: `Launchpad "${name}" not found on blacklist` };
  const entry = db[key];
  delete db[key];
  save(db);
  log("launchpad_blacklist", `Removed launchpad: ${entry.name}`);
  return { removed: true, name: entry.name, was: entry };
}

export function listLaunchpadBlacklist() {
  const db = load();
  const entries = Object.values(db);
  return { count: entries.length, blacklist: entries };
}
