-- CreateTable
CREATE TABLE "links" (
    "id" BIGSERIAL NOT NULL,
    "slug" VARCHAR(10) NOT NULL,
    "url" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMP(3),
    "max_clicks" INTEGER,
    "click_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_logs" (
    "id" BIGSERIAL NOT NULL,
    "link_id" BIGINT NOT NULL,
    "accessed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "referer" TEXT,
    "user_agent" TEXT,
    "ip" VARCHAR(45),

    CONSTRAINT "access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "links_slug_key" ON "links"("slug");

-- CreateIndex
CREATE INDEX "links_active_idx" ON "links"("active");

-- CreateIndex
CREATE INDEX "links_created_at_idx" ON "links"("created_at");

-- CreateIndex
CREATE INDEX "access_logs_link_id_accessed_at_idx" ON "access_logs"("link_id", "accessed_at");

-- CreateIndex
CREATE INDEX "access_logs_accessed_at_idx" ON "access_logs"("accessed_at");

-- AddForeignKey
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "links"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

