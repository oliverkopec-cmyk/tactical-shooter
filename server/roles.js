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
