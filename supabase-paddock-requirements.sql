-- Paddock Requirements: default requirements per paddock
-- Run this after supabase-schema-v2.sql

CREATE TABLE IF NOT EXISTS paddock_requirements (
  paddock_name TEXT NOT NULL REFERENCES paddocks(name) ON DELETE CASCADE,
  requirement_type_id UUID NOT NULL REFERENCES requirement_types(id) ON DELETE CASCADE,
  notes TEXT,
  PRIMARY KEY (paddock_name, requirement_type_id)
);

ALTER TABLE paddock_requirements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Property members can view paddock requirements"
  ON paddock_requirements FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM paddocks
    WHERE paddocks.name = paddock_requirements.paddock_name
      AND user_belongs_to_property(paddocks.property_id)
  ));

CREATE POLICY "Property members can create paddock requirements"
  ON paddock_requirements FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM paddocks
    WHERE paddocks.name = paddock_requirements.paddock_name
      AND user_belongs_to_property(paddocks.property_id)
  ));

CREATE POLICY "Property members can update paddock requirements"
  ON paddock_requirements FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM paddocks
    WHERE paddocks.name = paddock_requirements.paddock_name
      AND user_belongs_to_property(paddocks.property_id)
  ));

CREATE POLICY "Property members can delete paddock requirements"
  ON paddock_requirements FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM paddocks
    WHERE paddocks.name = paddock_requirements.paddock_name
      AND user_belongs_to_property(paddocks.property_id)
  ));

CREATE INDEX IF NOT EXISTS paddock_requirements_paddock_name_idx
  ON paddock_requirements(paddock_name);

NOTIFY pgrst, 'reload schema';
