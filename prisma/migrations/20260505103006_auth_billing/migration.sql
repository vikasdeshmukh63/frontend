-- CreateEnum
CREATE TYPE "CreditLedgerType" AS ENUM ('GRANT', 'CONSUME', 'REFUND_REVERSAL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "RazorpayOrderStatus" AS ENUM ('CREATED', 'PAID', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "email_verified" TIMESTAMP(3),
    "image" TEXT,
    "password_hash" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "session_token" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "CreditBalance" (
    "userId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditBalance_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "CreditLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "type" "CreditLedgerType" NOT NULL,
    "reason" TEXT,
    "razorpay_payment_id" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RazorpayOrder" (
    "id" TEXT NOT NULL,
    "razorpay_order_id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "credits" INTEGER NOT NULL,
    "status" "RazorpayOrderStatus" NOT NULL DEFAULT 'CREATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RazorpayOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RazorpayPayment" (
    "id" TEXT NOT NULL,
    "razorpay_payment_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RazorpayPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundRecord" (
    "id" TEXT NOT NULL,
    "razorpay_refund_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefundRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_provider_account_id_key" ON "Account"("provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "Session_session_token_key" ON "Session"("session_token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "CreditLedger_userId_createdAt_idx" ON "CreditLedger"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RazorpayOrder_razorpay_order_id_key" ON "RazorpayOrder"("razorpay_order_id");

-- CreateIndex
CREATE INDEX "RazorpayOrder_userId_idx" ON "RazorpayOrder"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RazorpayPayment_razorpay_payment_id_key" ON "RazorpayPayment"("razorpay_payment_id");

-- CreateIndex
CREATE INDEX "RazorpayPayment_order_id_idx" ON "RazorpayPayment"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "RefundRecord_razorpay_refund_id_key" ON "RefundRecord"("razorpay_refund_id");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_event_id_key" ON "WebhookEvent"("event_id");

-- Cutover: existing rows reference legacy Clerk user ids; clear app-owned data before FK to User.
DELETE FROM "Fragment";
DELETE FROM "Message";
DELETE FROM "Project";
DELETE FROM "UserAiSettings";

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAiSettings" ADD CONSTRAINT "UserAiSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditBalance" ADD CONSTRAINT "CreditBalance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedger" ADD CONSTRAINT "CreditLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RazorpayOrder" ADD CONSTRAINT "RazorpayOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RazorpayPayment" ADD CONSTRAINT "RazorpayPayment_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "RazorpayOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRecord" ADD CONSTRAINT "RefundRecord_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "RazorpayPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
