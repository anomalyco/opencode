CREATE TABLE "billing" (
	"id" varchar(30) NOT NULL,
	"workspace_id" varchar(30) NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"customer_id" varchar(255),
	"payment_method_id" varchar(255),
	"payment_method_last4" varchar(4),
	"balance" bigint NOT NULL,
	"reload" boolean,
	CONSTRAINT "billing_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" varchar(30) NOT NULL,
	"workspace_id" varchar(30) NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"customer_id" varchar(255),
	"payment_id" varchar(255),
	"amount" bigint NOT NULL,
	CONSTRAINT "payment_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "usage" (
	"id" varchar(30) NOT NULL,
	"workspace_id" varchar(30) NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"request_id" varchar(255),
	"model" varchar(255) NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"reasoning_tokens" integer,
	"cache_read_tokens" integer,
	"cache_write_tokens" integer,
	"cost" bigint NOT NULL,
	CONSTRAINT "usage_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" varchar(30) NOT NULL,
	"workspace_id" varchar(30) NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"email" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"time_seen" timestamp with time zone,
	"color" integer,
	CONSTRAINT "user_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"slug" varchar(255),
	"name" varchar(255),
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "billing" ADD CONSTRAINT "billing_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage" ADD CONSTRAINT "usage_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_email" ON "user" USING btree ("workspace_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "slug" ON "workspace" USING btree ("slug");