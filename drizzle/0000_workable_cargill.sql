CREATE TYPE "public"."article_visibility" AS ENUM('private', 'public');--> statement-breakpoint
CREATE TYPE "public"."home_tile_kind" AS ENUM('photo', 'quote');--> statement-breakpoint
CREATE TYPE "public"."photo_tag_visibility" AS ENUM('private', 'public');--> statement-breakpoint
CREATE TABLE "apps" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "apps_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"url" text NOT NULL,
	"icon_key" text,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "article_categories" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "article_categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "article_tags" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "article_tags_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "article_tags_map" (
	"article_id" bigint NOT NULL,
	"tag_id" bigint NOT NULL,
	CONSTRAINT "article_tags_map_article_id_tag_id_pk" PRIMARY KEY("article_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "articles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"public_id" text NOT NULL,
	"title" text NOT NULL,
	"content" jsonb NOT NULL,
	"category_id" bigint,
	"featured_photo_key" text,
	"visibility" "article_visibility" DEFAULT 'private' NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"featured_position" integer,
	"legacy_wp_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "home_tiles" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "home_tiles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kind" "home_tile_kind" NOT NULL,
	"image_key" text,
	"text_content" text,
	"cite" text,
	"x" numeric NOT NULL,
	"y" numeric NOT NULL,
	"width" numeric NOT NULL,
	"height" numeric NOT NULL,
	"rotation" numeric DEFAULT 0 NOT NULL,
	"border" jsonb,
	"hover_effect" text,
	"z_index" integer NOT NULL,
	"cycle_group" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photo_albums" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "photo_albums_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"google_photos_url" text NOT NULL,
	"cover_image_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photo_albums_tags_map" (
	"album_id" bigint NOT NULL,
	"tag_id" bigint NOT NULL,
	CONSTRAINT "photo_albums_tags_map_album_id_tag_id_pk" PRIMARY KEY("album_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "photo_tags" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "photo_tags_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"visibility" "photo_tag_visibility" DEFAULT 'private' NOT NULL,
	"public_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"google_sub" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "article_tags_map" ADD CONSTRAINT "article_tags_map_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_tags_map" ADD CONSTRAINT "article_tags_map_tag_id_article_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."article_tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_category_id_article_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."article_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_albums_tags_map" ADD CONSTRAINT "photo_albums_tags_map_album_id_photo_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."photo_albums"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_albums_tags_map" ADD CONSTRAINT "photo_albums_tags_map_tag_id_photo_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."photo_tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "article_tags_map_article_id_idx" ON "article_tags_map" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "article_tags_map_tag_id_idx" ON "article_tags_map" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "articles_public_id_unique" ON "articles" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "articles_category_id_idx" ON "articles" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "photo_albums_tags_map_album_id_idx" ON "photo_albums_tags_map" USING btree ("album_id");--> statement-breakpoint
CREATE INDEX "photo_albums_tags_map_tag_id_idx" ON "photo_albums_tags_map" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "photo_tags_public_id_unique" ON "photo_tags" USING btree ("public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_google_sub_unique" ON "users" USING btree ("google_sub");