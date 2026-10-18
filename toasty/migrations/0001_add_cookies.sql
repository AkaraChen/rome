CREATE TABLE "cookies" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "domain" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "host_only" BOOLEAN NOT NULL,
    "expires_at" BIGINT,
    "secure" BOOLEAN NOT NULL,
    "http_only" BOOLEAN NOT NULL,
    "created_at" BIGINT NOT NULL
);
-- #[toasty::breakpoint]
CREATE INDEX "index_cookies_by_domain" ON "cookies" ("domain");
