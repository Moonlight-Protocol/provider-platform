-- Add FAILED status to transaction_status enum
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'transaction_status'
      AND e.enumlabel = 'FAILED'
  ) THEN
    ALTER TYPE "public"."transaction_status" ADD VALUE 'FAILED';
  END IF;
END $$;

