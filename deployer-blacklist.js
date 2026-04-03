/**
 * Deployer blacklist — wallet addresses that should be avoided.
 * If any top holder of a token matches a blacklisted deployer,
 * the agent will skip that pool during screening.
 */

import fs from "fs";
import { log } from "./logger.js";

const BLACKLIST_FILE = "./deployer-blacklist.json";

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

export function isDeployerBlacklisted(address) {
  if (!address) return false;
  const db = load();
  return !!db[address];
}

/**
 * Check if ANY of the given addresses match a blacklisted deployer.
 * Used during screening to check top holders against the blacklist.
 */
export function checkDeployerBlacklist(addresses) {
  if (!addresses || !addresses.length) return { match: false };
  const db = load();
  for (const addr of addresses) {
    if (db[addr]) {
      return {
        match: true,
        address: addr,
        name: db[addr].name,
        reason: db[addr].reason,
      };
    }
  }
  return { match: false };
}

export function addDeployer({ address, name, reason }) {
  if (!address) return { error: "address required" };
  const db = load();
  if (db[address]) {
    return { already_blacklisted: true, address, name: db[address].name, reason: db[address].reason };
  }
  db[address] = {
    name: name || "Unknown",
    reason: reason || "no reason provided",
    added_at: new Date().toISOString(),
  };
  save(db);
  log("deployer_blacklist", `Blacklisted deployer: ${name || address} — ${reason}`);
  return { blacklisted: true, address, name, reason };
}

export function removeDeployer({ address }) {
  if (!address) return { error: "address required" };
  const db = load();
  if (!db[address]) return { error: `Address ${address} not found on deployer blacklist` };
  const entry = db[address];
  delete db[address];
  save(db);
  log("deployer_blacklist", `Removed deployer: ${entry.name || address}`);
  return { removed: true, address, was: entry };
}

export function listDeployerBlacklist() {
  const db = load();
  const entries = Object.entries(db).map(([address, info]) => ({ address, ...info }));
  return { count: entries.length, blacklist: entries };
}
