-- Market price cache table
-- Stores the last fetched MLA Statistics API response to avoid rate-limiting.
-- The Supabase Edge Function (market-prices) reads/writes this table.
-- To force a refresh: DELETE FROM market_cache WHERE key = 'market_prices';

create table if not exists market_cache (
  key        text        primary key,
  data       jsonb       not null,
  fetched_at timestamptz not null default now()
);
