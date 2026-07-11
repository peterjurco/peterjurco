ALTER TABLE "home_tiles" ADD COLUMN "image_keys" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "home_tiles" ADD COLUMN "cycle_interval_ms" integer;--> statement-breakpoint
UPDATE "home_tiles" SET "image_keys" = ARRAY["image_key"] WHERE "image_key" IS NOT NULL AND "image_key" <> '';--> statement-breakpoint
ALTER TABLE "home_tiles" DROP COLUMN "image_key";--> statement-breakpoint
ALTER TABLE "home_tiles" DROP COLUMN "cycle_group";
