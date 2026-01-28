-- Supabase Schema for Graze App
-- Run this SQL in your Supabase SQL Editor (Dashboard > SQL Editor)

-- Create paddocks table
CREATE TABLE IF NOT EXISTS paddocks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  acres DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Enable Row Level Security (RLS)
ALTER TABLE paddocks ENABLE ROW LEVEL SECURITY;

-- Create policies so users can only access their own paddocks
CREATE POLICY "Users can view their own paddocks"
  ON paddocks
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own paddocks"
  ON paddocks
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own paddocks"
  ON paddocks
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own paddocks"
  ON paddocks
  FOR DELETE
  USING (auth.uid() = user_id);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_paddocks_updated_at
  BEFORE UPDATE ON paddocks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Create index for faster queries by user
CREATE INDEX IF NOT EXISTS paddocks_user_id_idx ON paddocks(user_id);
