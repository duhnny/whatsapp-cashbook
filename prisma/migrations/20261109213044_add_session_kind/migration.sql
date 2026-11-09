-- CreateEnum
CREATE TYPE "SessionKind" AS ENUM ('whatsapp_confirmation', 'transaction');

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "kind" "SessionKind" NOT NULL DEFAULT 'transaction';
