ALTER TABLE "cached_scenes" ADD COLUMN "scene_id" text;--> statement-breakpoint
ALTER TABLE "cached_scenes" ADD COLUMN "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL;