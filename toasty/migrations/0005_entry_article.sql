ALTER TABLE "entries" ADD COLUMN "article_at" BIGINT;
-- #[toasty::breakpoint]
ALTER TABLE "entries" ADD COLUMN "article" TEXT;
