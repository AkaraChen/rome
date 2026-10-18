CREATE TABLE "entries" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source_id" INTEGER NOT NULL,
    "dedup_key" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "author" TEXT,
    "published_at" BIGINT,
    "inserted_at" BIGINT NOT NULL,
    "content" TEXT,
    "summary" TEXT,
    "image" TEXT,
    "read" BOOLEAN NOT NULL,
    "starred" BOOLEAN NOT NULL
);
-- #[toasty::breakpoint]
CREATE INDEX "index_entries_by_source_id" ON "entries" ("source_id");
-- #[toasty::breakpoint]
CREATE UNIQUE INDEX "index_entries_by_dedup_key" ON "entries" ("dedup_key");
-- #[toasty::breakpoint]
CREATE TABLE "lists" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL
);
-- #[toasty::breakpoint]
CREATE UNIQUE INDEX "index_lists_by_name" ON "lists" ("name");
-- #[toasty::breakpoint]
CREATE TABLE "sources" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "plugin_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "params" TEXT NOT NULL,
    "view" INTEGER NOT NULL,
    "category" TEXT,
    "enabled" BOOLEAN NOT NULL,
    "refresh_interval_secs" BIGINT NOT NULL,
    "cursor" TEXT,
    "last_fetched_at" BIGINT,
    "last_error" TEXT,
    "last_error_at" BIGINT,
    "created_at" BIGINT NOT NULL
);
-- #[toasty::breakpoint]
CREATE INDEX "index_sources_by_plugin_id" ON "sources" ("plugin_id");
-- #[toasty::breakpoint]
CREATE TABLE "plugins" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "plugin_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "api_version" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "enabled" BOOLEAN NOT NULL,
    "source_code" TEXT NOT NULL,
    "settings" TEXT NOT NULL,
    "installed_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "last_run_at" BIGINT,
    "last_error" TEXT,
    "last_error_at" BIGINT
);
-- #[toasty::breakpoint]
CREATE UNIQUE INDEX "index_plugins_by_plugin_id" ON "plugins" ("plugin_id");
-- #[toasty::breakpoint]
CREATE TABLE "list_entries" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "list_id" INTEGER NOT NULL,
    "entry_id" INTEGER NOT NULL,
    "added_at" BIGINT NOT NULL
);
-- #[toasty::breakpoint]
CREATE INDEX "index_list_entries_by_list_id" ON "list_entries" ("list_id");
-- #[toasty::breakpoint]
CREATE INDEX "index_list_entries_by_entry_id" ON "list_entries" ("entry_id");
