-- PostGIS provides the `geometry` column type plus `ST_*` functions used by the
-- `fields` table (column type, generated `area_hectares`, validity / SRID
-- CHECK constraints, GIST index). pgcrypto provides `gen_random_uuid()` used
-- as the default for every UUID primary key. Both must exist before any of
-- the table DDL below runs.
CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE TABLE "cached_ndvi_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"field_id" uuid NOT NULL,
	"view_id" text NOT NULL,
	"index_name" varchar(20) DEFAULT 'NDVI' NOT NULL,
	"scene_date" date NOT NULL,
	"cloud_percent" numeric(5, 2),
	"data_coverage_percent" numeric(5, 2),
	"mean" numeric(6, 4),
	"min" numeric(6, 4),
	"max" numeric(6, 4),
	"p10" numeric(6, 4),
	"p90" numeric(6, 4),
	"median" numeric(6, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cached_ndvi_stats_field_view_index_unique" UNIQUE("field_id","view_id","index_name")
);
--> statement-breakpoint
CREATE TABLE "cached_scenes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"field_id" uuid NOT NULL,
	"view_id" text NOT NULL,
	"source" varchar(20) DEFAULT 'sentinel-2' NOT NULL,
	"scene_date" date NOT NULL,
	"cloud_percent" numeric(5, 2),
	"data_coverage_percent" numeric(5, 2),
	"tms_template" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cached_scenes_field_view_unique" UNIQUE("field_id","view_id")
);
--> statement-breakpoint
CREATE TABLE "fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" varchar(120) NOT NULL,
	"crop_type" varchar(40) NOT NULL,
	"season" varchar(20) NOT NULL,
	"farmer_name" varchar(120),
	"village" varchar(120),
	"district" varchar(120),
	"state" varchar(120),
	"geometry" geometry(Polygon,4326) NOT NULL,
	"area_hectares" numeric(10, 2) GENERATED ALWAYS AS (ST_Area(geometry::geography) / 10000) STORED,
	"eosda_cropper_ref" text,
	"sowing_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fields_geometry_valid" CHECK (ST_IsValid("fields"."geometry")),
	CONSTRAINT "fields_geometry_srid" CHECK (ST_SRID("fields"."geometry") = 4326)
);
--> statement-breakpoint
ALTER TABLE "cached_ndvi_stats" ADD CONSTRAINT "cached_ndvi_stats_field_id_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cached_scenes" ADD CONSTRAINT "cached_scenes_field_id_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cached_scenes_field_date_idx" ON "cached_scenes" USING btree ("field_id","scene_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "fields_user_idx" ON "fields" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "fields_geom_gix" ON "fields" USING gist ("geometry");