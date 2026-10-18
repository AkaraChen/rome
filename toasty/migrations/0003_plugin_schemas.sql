-- Hand-edited: Toasty emits `ADD COLUMN ... NOT NULL` with no default, which
-- SQLite refuses as soon as the table has a row. `#[default(expr)]` is an
-- insert-time value in the ORM rather than a column constraint, so nothing is
-- emitted for it. `'{}'` is the empty form schema, which every consumer already
-- treats as "a plugin that declared no fields".
ALTER TABLE "plugins" ADD COLUMN "params_schema" TEXT NOT NULL DEFAULT '{}';
-- #[toasty::breakpoint]
ALTER TABLE "plugins" ADD COLUMN "settings_schema" TEXT NOT NULL DEFAULT '{}';
