CREATE TYPE "public"."page_mode" AS ENUM('manual', 'auto');--> statement-breakpoint
CREATE TYPE "public"."page_sort_key" AS ENUM('created_desc', 'created_asc', 'title_asc', 'title_desc');--> statement-breakpoint
CREATE TYPE "public"."page_visibility" AS ENUM('private', 'public');--> statement-breakpoint
CREATE TABLE "pages" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"visibility" "page_visibility" DEFAULT 'private' NOT NULL,
	"mode" "page_mode" DEFAULT 'manual' NOT NULL,
	"article_ids" bigint[] DEFAULT '{}' NOT NULL,
	"category_id" bigint,
	"tag_id" bigint,
	"sort_key" "page_sort_key" DEFAULT 'created_desc' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_category_id_article_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."article_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_tag_id_article_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."article_tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pages_slug_unique" ON "pages" USING btree ("slug");