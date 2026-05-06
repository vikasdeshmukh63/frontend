-- AlterTable
ALTER TABLE "CreditLedger" ADD COLUMN "correlation_id" TEXT;

-- CreateIndex (nullable column: multiple NULLs are allowed in PostgreSQL unique indexes)
CREATE UNIQUE INDEX "CreditLedger_correlation_id_key" ON "CreditLedger"("correlation_id");
