// Who is the owner and who is an admin. Both come from environment variables set on the
// server (see "Owner and admins" in the README), so nobody can gain a role from inside the game.
// Roles are looked up from the username the server itself stored when the player logged in,
// never from anything the client says, and every admin action checks again.

const names = (value) => new Set(String(value || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
const norm = (username) => String(username || '').trim().toLowerCase();

/** OWNER_USERNAME: the one owner. */
export function isOwner(username) {
  const owner = norm(process.env.OWNER_USERNAME);
  return !!owner && norm(username) === owner;
}

/** ADMIN_USERNAMES (comma-separated) plus the owner, who is always an admin. */
export function isAdmin(username) {
  return isOwner(username) || names(process.env.ADMIN_USERNAMES).has(norm(username));
}

/**
 * TESTER_USERNAMES (comma-separated): testers. A tester gets a TESTER badge and can open the Admin tab, but only
 * to see who is online, see and join or spectate matches, and send announcements. Nothing else there is theirs:
 * reports, chat logs, gifts, Money and warning, suspending or banning are refused by the server for testers.
 * (An owner or admin who is also listed as a tester keeps their larger role.)
 */
export function isTester(username) {
  return names(process.env.TESTER_USERNAMES).has(norm(username));
}

/** May open the Admin tab and use its safe parts (online list, matches, join / spectate, announcements). */
export function isStaff(username) {
  return isAdmin(username) || isTester(username);
}

/** The badge flags sent with a name: { owner, tester }. An owner or admin never shows as a tester. */
export function badgeFlags(username) {
  return { owner: isOwner(username), tester: isTester(username) && !isAdmin(username) };
}
