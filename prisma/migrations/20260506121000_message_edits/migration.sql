-- AlterTable
ALTER TABLE "Message" ADD COLUMN "edited_from_id" TEXT;

-- AddForeignKey
ALTER TABLE "Message"
ADD CONSTRAINT "Message_edited_from_id_fkey"
FOREIGN KEY ("edited_from_id") REFERENCES "Message"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- Index for faster traversal
CREATE INDEX "Message_edited_from_id_idx" ON "Message"("edited_from_id");

