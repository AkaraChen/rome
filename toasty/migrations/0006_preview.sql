ALTER TABLE "plugins" ADD COLUMN "has_preview" BOOLEAN NOT NULL DEFAULT 0;
-- #[toasty::breakpoint]
ALTER TABLE "entries" ADD COLUMN "preview" TEXT;
-- #[toasty::breakpoint]
ALTER TABLE "entries" ADD COLUMN "preview_at" BIGINT;
-- #[toasty::breakpoint]
ALTER TABLE "entries" ADD COLUMN "params" TEXT;
