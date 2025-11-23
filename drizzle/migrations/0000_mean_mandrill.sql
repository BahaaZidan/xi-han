CREATE TABLE "collection_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"collection_id" integer NOT NULL,
	"item_id" text NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_items_collection_id_idx" ON "collection_items" USING btree ("collection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_items_collection_item_key" ON "collection_items" USING btree ("collection_id","item_id");--> statement-breakpoint
CREATE INDEX "collections_user_id_idx" ON "collections" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collections_user_name_key" ON "collections" USING btree ("user_id","name");