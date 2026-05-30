-- Migrate guests column from list[str] to list[dict{name, status}]
-- Each existing plain string guest becomes {"name": "...", "status": "pending"}
-- Already-migrated dict entries are left unchanged.

UPDATE video.bookings
SET guests = (
  SELECT COALESCE(
    jsonb_agg(
      CASE
        WHEN jsonb_typeof(elem) = 'object' THEN elem
        ELSE jsonb_build_object('name', elem, 'status', 'pending')
      END
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements(guests) elem
)
WHERE jsonb_typeof(guests) = 'array'
  AND jsonb_array_length(guests) > 0;
