// Projectradar — PocketBase collecties + toegangsregels aanmaken.
//
// Idempotent: bestaande collecties worden overgeslagen. Herbruikbaar voor zowel
// de lokale PocketBase als die op je VPS.
//
//   PB_URL=http://127.0.0.1:8090 \
//   PB_ADMIN_EMAIL=admin@projectradar.local \
//   PB_ADMIN_PASS='...' \
//   node pocketbase/setup.mjs
//
// Maakt ook (optioneel) een gewone app-gebruiker aan als APP_USER_EMAIL/PASS zijn gezet.

import PocketBase from "pocketbase";

const URL = process.env.PB_URL || "http://127.0.0.1:8090";
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL || "admin@projectradar.local";
const ADMIN_PASS = process.env.PB_ADMIN_PASS;

if (!ADMIN_PASS) {
  console.error("Zet PB_ADMIN_PASS (wachtwoord van de superuser).");
  process.exit(1);
}

const pb = new PocketBase(URL);
pb.autoCancellation(false);

await pb.collection("_superusers").authWithPassword(ADMIN_EMAIL, ADMIN_PASS);
console.log("✓ Ingelogd als superuser op", URL);

const existing = await pb.collections.getFullList();
const byName = new Map(existing.map((c) => [c.name, c]));

function id(name) {
  const c = byName.get(name);
  if (!c) throw new Error(`Collectie ${name} ontbreekt`);
  return c.id;
}

async function ensure(def) {
  const found = byName.get(def.name);
  if (found) {
    // Bestaat al: alleen ontbrekende velden aanvullen. Zonder deze stap sloeg
    // een bestaande installatie de collectie volledig over, en kwamen later
    // toegevoegde velden er nooit in — waarna de app ze bij elke sync
    // stilzwijgend kwijtraakte. Bestaande velden en data blijven ongemoeid.
    const have = new Set((found.fields ?? []).map((f) => f.name));
    const missing = (def.fields ?? []).filter((f) => !have.has(f.name));
    if (!missing.length) {
      console.log("• bestaat al:", def.name);
      return found;
    }
    const updated = await pb.collections.update(found.id, {
      fields: [...found.fields, ...missing],
    });
    byName.set(updated.name, updated);
    console.log(`✓ ${def.name}: veld(en) toegevoegd — ${missing.map((f) => f.name).join(", ")}`);
    return updated;
  }
  const created = await pb.collections.create(def);
  byName.set(created.name, created);
  console.log("✓ aangemaakt:", def.name);
  return created;
}

// users (auth) — meestal al aanwezig na eerste start; anders aanmaken.
if (!byName.has("users")) {
  await ensure({
    name: "users",
    type: "auth",
    fields: [{ name: "name", type: "text" }],
  });
}
const usersId = id("users");

const ownerRule = '@request.auth.id != "" && user = @request.auth.id';

// machines
await ensure({
  name: "machines",
  type: "base",
  listRule: ownerRule,
  viewRule: ownerRule,
  createRule: ownerRule,
  updateRule: ownerRule,
  deleteRule: ownerRule,
  fields: [
    { name: "user", type: "relation", required: true, collectionId: usersId, maxSelect: 1, cascadeDelete: true },
    { name: "hostname", type: "text", required: true },
    { name: "label", type: "text" },
    { name: "os", type: "text" },
    { name: "last_seen", type: "date" },
  ],
  indexes: ["CREATE UNIQUE INDEX idx_machine ON machines (user, hostname)"],
});

// projects (roadmap als JSON-veld)
await ensure({
  name: "projects",
  type: "base",
  listRule: ownerRule,
  viewRule: ownerRule,
  createRule: ownerRule,
  updateRule: ownerRule,
  deleteRule: ownerRule,
  fields: [
    { name: "user", type: "relation", required: true, collectionId: usersId, maxSelect: 1, cascadeDelete: true },
    { name: "key", type: "text", required: true },
    { name: "name", type: "text", required: true },
    { name: "description", type: "text", max: 4000 },
    { name: "status", type: "select", maxSelect: 1, values: ["idee", "actief", "onhold", "afgerond"] },
    { name: "stack", type: "json", maxSize: 20000 },
    { name: "repo_url", type: "text" },
    { name: "deploy_url", type: "text" },
    { name: "remote_url", type: "text" },
    { name: "roadmap", type: "json", maxSize: 200000 },
    // Handmatige volgorde in het dashboard; -1 = nooit gesleept.
    { name: "rank", type: "number" },
    // Horen bij het project en niet bij de machine, dus synchroniseren mee.
    // Stonden eerder alleen in localStorage, waardoor ze met sync aan bij
    // elke scan uit beeld verdwenen.
    { name: "run_command", type: "text" },
    { name: "dev_url", type: "text" },
    { name: "claude_instructions", type: "text", max: 8000 },
    { name: "design_instructions", type: "text", max: 8000 },
    { name: "history", type: "json", maxSize: 60000 },
    { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
  ],
  indexes: ["CREATE UNIQUE INDEX idx_project_key ON projects (user, key)"],
});
const projectsId = id("projects");
const machinesId = id("machines");

// project_states (per-PC git-stand)
const stateRule = '@request.auth.id != "" && project.user = @request.auth.id';
await ensure({
  name: "project_states",
  type: "base",
  listRule: stateRule,
  viewRule: stateRule,
  createRule: stateRule,
  updateRule: stateRule,
  deleteRule: stateRule,
  fields: [
    { name: "project", type: "relation", required: true, collectionId: projectsId, maxSelect: 1, cascadeDelete: true },
    { name: "machine", type: "relation", required: true, collectionId: machinesId, maxSelect: 1, cascadeDelete: true },
    { name: "branch", type: "text" },
    { name: "detached", type: "bool" },
    { name: "last_commit_hash", type: "text" },
    { name: "last_commit_date", type: "date" },
    { name: "total_commits", type: "number" },
    { name: "weekly_commits", type: "number" },
    { name: "has_uncommitted", type: "bool" },
    { name: "ahead", type: "number" },
    { name: "behind", type: "number" },
    { name: "local_path", type: "text" },
    { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
  ],
  indexes: ["CREATE UNIQUE INDEX idx_state ON project_states (project, machine)"],
});

// Optioneel: app-gebruiker aanmaken.
const appEmail = process.env.APP_USER_EMAIL;
const appPass = process.env.APP_USER_PASS;
if (appEmail && appPass) {
  try {
    await pb.collection("users").create({
      email: appEmail,
      password: appPass,
      passwordConfirm: appPass,
      name: appEmail.split("@")[0],
    });
    console.log("✓ app-gebruiker aangemaakt:", appEmail);
  } catch (e) {
    console.log("• app-gebruiker bestaat al of fout:", e?.message ?? e);
  }
}

console.log("\nKlaar. Collecties staan klaar op", URL);
