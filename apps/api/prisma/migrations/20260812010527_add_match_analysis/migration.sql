-- CreateTable
CREATE TABLE "MatchAnalysis" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MatchAnalysis_matchId_idx" ON "MatchAnalysis"("matchId");

-- CreateIndex
CREATE INDEX "MatchAnalysis_type_idx" ON "MatchAnalysis"("type");

-- CreateIndex
CREATE UNIQUE INDEX "MatchAnalysis_matchId_type_key" ON "MatchAnalysis"("matchId", "type");

-- AddForeignKey
ALTER TABLE "MatchAnalysis" ADD CONSTRAINT "MatchAnalysis_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
