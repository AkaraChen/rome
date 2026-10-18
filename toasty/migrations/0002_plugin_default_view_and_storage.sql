-- Hand-edited: Toasty generated this as `ADD COLUMN "default_view" INTEGER NOT
-- NULL` with no default. `#[default(expr)]` is an insert-time value in the ORM,
-- not a column constraint, so nothing is emitted here — and SQLite refuses to
-- add a NOT NULL column without a default as soon as the table has one row.
-- That passes on an empty development database and fails on a real one.
-- 0 is `View::Articles`, which is what a plugin that declares nothing should be.
ALTER TABLE "plugins" ADD COLUMN "default_view" INTEGER NOT NULL DEFAULT 0;
-- #[toasty::breakpoint]
CREATE TABLE "plugin_storages" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "plugin_id" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" BIGINT NOT NULL
);
-- #[toasty::breakpoint]
CREATE INDEX "index_plugin_storages_by_plugin_id" ON "plugin_storages" ("plugin_id");
-- #[toasty::breakpoint]
CREATE UNIQUE INDEX "index_plugin_storages_by_storage_key" ON "plugin_storages" ("storage_key");
