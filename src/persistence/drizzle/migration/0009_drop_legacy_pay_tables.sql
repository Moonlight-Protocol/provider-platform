-- UC4: Drop legacy pay tables from the old two-app architecture
-- (moonlight-pay-self + moonlight-pay-custodial). Replaced by
-- pay-platform's pay_accounts table and the new UC4 transaction model.

DROP TABLE IF EXISTS "pay_escrow" CASCADE;
DROP TABLE IF EXISTS "pay_transactions" CASCADE;
DROP TABLE IF EXISTS "pay_custodial_accounts" CASCADE;
DROP TABLE IF EXISTS "pay_kyc" CASCADE;

-- Drop the enums created in 0006_pay_tables.sql
DROP TYPE IF EXISTS "pay_escrow_status";
DROP TYPE IF EXISTS "pay_transaction_status";
DROP TYPE IF EXISTS "pay_transaction_type";
DROP TYPE IF EXISTS "pay_custodial_status";
DROP TYPE IF EXISTS "pay_kyc_status";
