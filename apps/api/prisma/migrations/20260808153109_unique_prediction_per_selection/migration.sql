/*
  Warnings:

  - A unique constraint covering the columns `[matchId,market,selection,modelName]` on the table `Prediction` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `updatedAt` to the `Prediction` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Prediction" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Prediction_matchId_market_selection_modelName_key" ON "Prediction"("matchId", "market", "selection", "modelName");
