-- CreateTable
CREATE TABLE "PlayerInjury" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "teamExternalId" TEXT,
    "fixtureExternalId" TEXT,
    "type" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerInjury_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlayerInjury_playerId_idx" ON "PlayerInjury"("playerId");

-- CreateIndex
CREATE INDEX "PlayerInjury_status_idx" ON "PlayerInjury"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerInjury_playerId_fixtureExternalId_key" ON "PlayerInjury"("playerId", "fixtureExternalId");

-- AddForeignKey
ALTER TABLE "PlayerInjury" ADD CONSTRAINT "PlayerInjury_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
