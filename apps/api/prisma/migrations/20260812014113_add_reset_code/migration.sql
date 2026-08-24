-- AlterTable
ALTER TABLE "User" ADD COLUMN     "resetCode" TEXT,
ADD COLUMN     "resetCodeExp" TIMESTAMP(3);
