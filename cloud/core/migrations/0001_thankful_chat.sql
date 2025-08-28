CREATE TABLE "account" (
	"id" varchar(30) NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"email" varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "email" ON "account" USING btree ("email");