ALTER TABLE "pages" ADD COLUMN "show_tags" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "show_created_date" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "show_updated_date" boolean DEFAULT false NOT NULL;