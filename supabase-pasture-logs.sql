-- Pasture Logs: track pasture condition over time per paddock
-- Run this after supabase-schema-v2.sql

CREATE TABLE IF NOT EXISTS pasture_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  paddock_name TEXT NOT NULL REFERENCES paddocks(name) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  condition TEXT NOT NULL CHECK (condition IN ('Poor', 'Fair', 'Good', 'Excellent')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE pasture_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Property members can view pasture logs"
  ON pasture_logs FOR SELECT
  USING (user_belongs_to_property(property_id));

CREATE POLICY "Property members can create pasture logs"
  ON pasture_logs FOR INSERT
  WITH CHECK (user_belongs_to_property(property_id));

CREATE POLICY "Property members can update pasture logs"
  ON pasture_logs FOR UPDATE
  USING (user_belongs_to_property(property_id));

CREATE POLICY "Property members can delete pasture logs"
  ON pasture_logs FOR DELETE
  USING (user_belongs_to_property(property_id));

CREATE INDEX IF NOT EXISTS pasture_logs_paddock_name_idx
  ON pasture_logs(paddock_name);

CREATE INDEX IF NOT EXISTS pasture_logs_property_id_idx
  ON pasture_logs(property_id);

NOTIFY pgrst, 'reload schema';
