# Recovery Control (local Phase 2)

This logically separate local Postgres database stores only deletion tombstones outside an isolated
primary-database restore. It contains surrogate player UUID, deletion UUID, and timestamp—never
Telegram identity or message data.

Phase 2 uses the fixed loopback database `recovery_control` on the local Supabase Postgres server as
a test stand-in for a separately operated recovery-control project. Forward migration 002 exposes
one service-role-only idempotent RPC, used by the Telegram webhook through a separately configured
recovery project URL and service credential. The RPC accepts only surrogate player UUID, deletion
UUID and timestamp. Remote provisioning remains behind the explicit Phase 4T deployment gate.
