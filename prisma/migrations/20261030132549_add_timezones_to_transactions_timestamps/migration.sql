-- AlterTable
ALTER TABLE "OutboxTransaction" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Transaction" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3);
